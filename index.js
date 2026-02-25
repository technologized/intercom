/**
 * TracPoll — Decentralized P2P Polling on Intercom
 *
 * Built on the Intercom stack (Trac Network / Pear runtime).
 * Run with: pear run . --peer-store-name <name> --msb-store-name <msb> [flags]
 *
 * Adds poll:create / poll:vote / poll:result message handling
 * on top of the core Intercom sidechannel + contract machinery.
 */

'use strict'

import Intercom from './features/intercom.js'
import b4a from 'b4a'

// ─── CLI args ────────────────────────────────────────────────────────────────
const args = Pear.config.args || []

function getArg (name) {
  const idx = args.indexOf('--' + name)
  return idx !== -1 ? args[idx + 1] : null
}

const peerStoreName   = getArg('peer-store-name')   || 'tracpoll-admin'
const msbStoreName    = getArg('msb-store-name')    || 'tracpoll-admin-msb'
const subnetChannel   = getArg('subnet-channel')    || 'tracpoll'
const subnetBootstrap = getArg('subnet-bootstrap')  || null
const sidechannels    = (getArg('sidechannels') || 'polls').split(',').map(s => s.trim())
const scBridgePort    = parseInt(getArg('sc-bridge-port') || '8765', 10)

console.log('[TracPoll] starting...')
console.log('[TracPoll] peer-store-name  :', peerStoreName)
console.log('[TracPoll] subnet-channel   :', subnetChannel)
console.log('[TracPoll] sidechannels     :', sidechannels)
console.log('[TracPoll] sc-bridge-port   :', scBridgePort)
if (subnetBootstrap) console.log('[TracPoll] subnet-bootstrap :', subnetBootstrap)

// ─── Intercom setup ──────────────────────────────────────────────────────────
const ic = new Intercom({
  peerStoreName,
  msbStoreName,
  subnetChannel,
  subnetBootstrap,
  sidechannels,
  scBridgePort
})

// ─── Poll helpers ────────────────────────────────────────────────────────────

/**
 * Write a new poll into the contract (Hyperbee).
 * Key layout:
 *   polls:index                  → [ { id, question }, ... ]
 *   poll:<id>                    → { id, question, options, created_at, creator_key }
 *   tally:<id>                   → { [option]: 0, ... }
 */
async function contractCreatePoll (id, question, options, creatorKey) {
  const db = ic.contractDb  // Hyperbee instance exposed by Intercom

  // Guard: don't overwrite an existing poll
  const existing = await db.get('poll:' + id)
  if (existing) {
    console.warn('[TracPoll] poll already exists:', id)
    return false
  }

  const pollObj = {
    id,
    question,
    options,
    created_at: Date.now(),
    creator_key: creatorKey
  }

  // Initialise zero tally
  const tally = {}
  for (const opt of options) tally[opt] = 0

  // Update the poll index
  const indexEntry = await db.get('polls:index')
  const index = indexEntry ? JSON.parse(b4a.toString(indexEntry.value)) : []
  index.push({ id, question })

  const batch = db.batch()
  await batch.put('poll:' + id,     b4a.from(JSON.stringify(pollObj)))
  await batch.put('tally:' + id,    b4a.from(JSON.stringify(tally)))
  await batch.put('polls:index',    b4a.from(JSON.stringify(index)))
  await batch.flush()

  console.log('[TracPoll] poll created:', id, '-', question)
  return true
}

/**
 * Record a vote. Returns updated tally or null if rejected.
 * Enforces one vote per (poll_id, voter_key).
 */
async function contractCastVote (pollId, option, voterKey) {
  const db = ic.contractDb

  // Check poll exists
  const pollEntry = await db.get('poll:' + pollId)
  if (!pollEntry) {
    console.warn('[TracPoll] vote rejected — unknown poll:', pollId)
    return null
  }
  const poll = JSON.parse(b4a.toString(pollEntry.value))

  // Validate option
  if (!poll.options.includes(option)) {
    console.warn('[TracPoll] vote rejected — invalid option:', option)
    return null
  }

  // One-vote guard
  const voteKey = 'vote:' + pollId + ':' + voterKey
  const already = await db.get(voteKey)
  if (already) {
    console.warn('[TracPoll] duplicate vote rejected for voter:', voterKey)
    return null
  }

  // Read and update tally
  const tallyEntry = await db.get('tally:' + pollId)
  const tally = JSON.parse(b4a.toString(tallyEntry.value))
  tally[option] = (tally[option] || 0) + 1

  const batch = db.batch()
  await batch.put(voteKey,            b4a.from(JSON.stringify({ option, timestamp: Date.now() })))
  await batch.put('tally:' + pollId,  b4a.from(JSON.stringify(tally)))
  await batch.flush()

  console.log('[TracPoll] vote recorded — poll:', pollId, '| option:', option, '| tally:', tally)
  return tally
}

/**
 * Read the current tally for a poll.
 */
async function contractGetTally (pollId) {
  const db = ic.contractDb
  const entry = await db.get('tally:' + pollId)
  if (!entry) return null
  return JSON.parse(b4a.toString(entry.value))
}

/**
 * Read the poll index.
 */
async function contractGetIndex () {
  const db = ic.contractDb
  const entry = await db.get('polls:index')
  if (!entry) return []
  return JSON.parse(b4a.toString(entry.value))
}

// ─── Sidechannel message handler ─────────────────────────────────────────────
ic.on('sidechannel:message', async ({ channel, from, data }) => {
  if (channel !== 'polls') return
  if (!data || !data.type) return

  const fromKey = from ? b4a.toString(from, 'hex') : 'unknown'

  switch (data.type) {
    case 'poll:create': {
      const { id, question, options } = data
      if (!id || !question || !Array.isArray(options) || options.length < 2) break
      await contractCreatePoll(id, question, options, fromKey)
      break
    }

    case 'poll:vote': {
      const { poll_id: pollId, option } = data
      if (!pollId || !option) break
      const tally = await contractCastVote(pollId, option, fromKey)
      if (tally) {
        // Broadcast updated result to all peers
        ic.sendToChannel('polls', {
          type: 'poll:result',
          poll_id: pollId,
          tally
        })
      }
      break
    }

    case 'poll:result': {
      // Another peer emitted results — print to stdout for visibility
      console.log('[TracPoll] live result update — poll:', data.poll_id, '| tally:', data.tally)
      break
    }

    default:
      break
  }
})

// ─── SC-Bridge extension: contract:query ─────────────────────────────────────
/**
 * Extends the SC-Bridge command set so agents can query contract state directly.
 * Handled before passing to the default Intercom SC-Bridge dispatcher.
 */
ic.on('scbridge:command', async ({ cmd, payload, reply }) => {
  if (cmd !== 'contract:query') return  // let Intercom handle the rest

  const key = payload.key
  if (!key) return reply({ error: 'missing key' })

  const db = ic.contractDb
  const entry = await db.get(key)
  if (!entry) return reply({ result: null })

  try {
    reply({ result: JSON.parse(b4a.toString(entry.value)) })
  } catch {
    reply({ result: b4a.toString(entry.value) })
  }
})

// ─── Boot ────────────────────────────────────────────────────────────────────
await ic.start()

console.log('[TracPoll] ready.')
console.log('[TracPoll] SC-Bridge listening on ws://localhost:' + scBridgePort)
console.log('')
console.log('  Create a poll:')
console.log('  {"cmd":"send","channel":"polls","data":{"type":"poll:create","id":"poll-001","question":"Best L1?","options":["Bitcoin","Ethereum","Solana","Trac"]}}')
console.log('')
console.log('  Cast a vote:')
console.log('  {"cmd":"send","channel":"polls","data":{"type":"poll:vote","poll_id":"poll-001","option":"Trac"}}')
console.log('')
console.log('  Get tally:')
console.log('  {"cmd":"contract:query","key":"tally:poll-001"}')
