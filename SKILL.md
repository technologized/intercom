# SKILL.md — TracPoll Agent Instructions

TracPoll is a decentralized peer-to-peer polling application built on Intercom (Trac Network). This file tells agents how to set up, run, and operate TracPoll.

---

## What TracPoll Does

TracPoll enables peers/agents to:
1. **Create polls** (questions with up to 4 options) broadcast over a shared Intercom sidechannel.
2. **Vote** on active polls (one vote per peer per poll, enforced by contract).
3. **Read live tallies** from the replicated Autobase/Hyperbee contract state.

---

## Runtime Requirement

**Always use the Pear runtime.** Never use `node index.js` directly.

```
pear run . [flags]
```

---

## Setup Steps

### Step 1 — Install dependencies

```bash
cd intercom
npm install
```

### Step 2 — Start the admin peer (creates the subnet and the `polls` sidechannel)

```bash
pear run . \
  --peer-store-name admin \
  --msb-store-name admin-msb \
  --sidechannels polls
```

On first run, the admin peer prints its **writer key** (hex). Save it — joiners need it.

### Step 3 — Start one or more voter peers

```bash
pear run . \
  --peer-store-name voter1 \
  --msb-store-name voter1-msb \
  --subnet-bootstrap <admin-writer-key-hex> \
  --sidechannels polls
```

Replace `<admin-writer-key-hex>` with the key printed in Step 2.

---

## SC-Bridge (Agent API)

The SC-Bridge is the preferred agent control surface. It exposes a local WebSocket (no TTY required).

### Authenticate

```json
{ "cmd": "auth", "secret": "<your-sc-bridge-secret>" }
```

### Create a poll

```json
{
  "cmd": "send",
  "channel": "polls",
  "data": {
    "type": "poll:create",
    "id": "poll-001",
    "question": "What is the best Layer 1 chain?",
    "options": ["Bitcoin", "Ethereum", "Solana", "Trac"]
  }
}
```

- `id` must be unique per poll.
- `options` array: 2–4 items.
- Poll is broadcast to all peers on the `polls` sidechannel and written to contract state.

### Vote on a poll

```json
{
  "cmd": "send",
  "channel": "polls",
  "data": {
    "type": "poll:vote",
    "poll_id": "poll-001",
    "option": "Trac"
  }
}
```

- The contract enforces one vote per `(poll_id, voter_public_key)`.
- Duplicate votes are rejected silently.

### List active polls

```json
{ "cmd": "contract:query", "key": "polls:index" }
```

Returns an array of poll IDs with their questions.

### Get tally for a poll

```json
{ "cmd": "contract:query", "key": "tally:poll-001" }
```

Returns:
```json
{ "Bitcoin": 2, "Ethereum": 5, "Solana": 1, "Trac": 12 }
```

### Get full poll details

```json
{ "cmd": "contract:query", "key": "poll:poll-001" }
```

Returns the original poll object including creator key and timestamp.

---

## Contract State Keys

| Pattern | Meaning |
|---|---|
| `polls:index` | Array of `{ id, question }` for all polls |
| `poll:<id>` | Full poll object `{ id, question, options[], created_at, creator_key }` |
| `vote:<poll_id>:<voter_key>` | `{ option, timestamp }` — one per voter per poll |
| `tally:<poll_id>` | Live vote counts `{ <option>: <count> }` |

---

## Sidechannel Message Types

TracPoll uses the `polls` sidechannel for real-time event broadcast:

| `data.type` | Direction | Payload |
|---|---|---|
| `poll:create` | any peer → all | `{ id, question, options[] }` |
| `poll:vote` | any peer → all | `{ poll_id, option }` |
| `poll:result` | contract → all | `{ poll_id, tally }` (emitted after each vote write) |

---

## Decision Guide for Agents

| Goal | Action |
|---|---|
| Start a new poll session | Run admin peer (Step 2), note writer key |
| Add more voters | Run voter peers with `--subnet-bootstrap <key>` (Step 3) |
| Create a poll programmatically | SC-Bridge `send` with `type: poll:create` |
| Cast a vote | SC-Bridge `send` with `type: poll:vote` |
| Read results | SC-Bridge `contract:query` with key `tally:<poll_id>` |
| Debug connectivity | SC-Bridge `{ "cmd": "stats" }` and `{ "cmd": "info" }` |

---

## Notes

- All contract writes are deterministic and replicated across all subnet peers.
- The `polls` sidechannel uses the default **welcome** policy (open to all connected peers).
- To restrict poll creation to the admin only, change the sidechannel policy to `owner-only write`.
- Peer identity keys are derived from the Pear keystore — votes are automatically attributed to the connecting peer's public key.

---

## Trac Address (for competition reward)

`trac19gux30h0mk7ucy6s4s0aep998nleutymw70z6cgxxj8gyr4a0qlsu40ca3`
