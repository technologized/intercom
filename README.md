# TracPoll — Decentralized P2P Polling on Intercom

**TracPoll** is a peer-to-peer polling and voting application built on the [Intercom](https://github.com/Trac-Systems/intercom) stack. Peers create polls over Intercom sidechannels, others vote anonymously, and results are durably stored in the replicated contract state (Autobase/Hyperbee). No server, no admin, no censorship.

> **Trac Wallet Address:** `trac19gux30h0mk7ucy6s4s0aep998nleutymw70z6cgxxj8gyr4a0qlsu40ca3`

---

## What It Does

- **Create a poll** — any peer broadcasts a question with up to 4 options over an Intercom sidechannel.
- **Vote** — peers cast a single vote per poll; votes are sent over the sidechannel and written into replicated contract state.
- **Live tally** — results update in real time as votes propagate across the P2P network.
- **Audit trail** — all polls and vote counts are stored in the deterministic Autobase/Hyperbee contract, readable by any peer.

---

## Why It's Unique

| Feature | TracPoll |
|---|---|
| No central server | ✅ Pure P2P via Hyperswarm |
| Replicated state | ✅ Autobase + Hyperbee contract |
| Real-time results | ✅ Sidechannel events |
| One vote per peer per poll | ✅ Enforced in contract |
| Agent-operable via SC-Bridge | ✅ JSON WebSocket API |

---

## How to Run

### Requirements

- [Pear runtime](https://docs.pears.com/) (mandatory — do NOT use native Node.js)
- Node.js 20+

### Install

```bash
git clone https://github.com/technologized/intercom
cd intercom
npm install
```

### Start the admin peer (first peer / poll creator)

```bash
pear run . --peer-store-name admin --msb-store-name admin-msb --sidechannels polls
```

Copy the printed **writer key** — joiners need it.

### Join as a voter

```bash
pear run . --peer-store-name voter1 --msb-store-name voter1-msb \
  --subnet-bootstrap <admin-writer-key> --sidechannels polls
```

---

## SC-Bridge Commands (Agent API)

Connect to `ws://localhost:<port>` and authenticate, then use these JSON commands:

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

### Cast a vote
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

### Get results
```json
{
  "cmd": "contract:query",
  "key": "poll:poll-001"
}
```

---

## Contract Schema

Polls and votes are stored in the Hyperbee contract under these key patterns:

| Key | Value |
|---|---|
| `poll:<id>` | `{ question, options[], created_at, creator_key }` |
| `vote:<poll_id>:<voter_key>` | `{ option, timestamp }` |
| `tally:<poll_id>` | `{ <option>: <count>, ... }` |

---

## App Flow (Proof it Works)

```
Peer A (admin)              Peer B (voter)
     |                           |
     |--[sidechannel: poll:create]-->|
     |                           |
     |<--[sidechannel: poll:vote]----|
     |                           |
     |--[contract write: tally]-->|  (replicated to all)
     |                           |
     |<--[contract read: results]-|
```

---

## Screenshots / Demo

See [`/screenshots`](./screenshots/) folder for:
- Poll creation output in terminal
- Live vote tally updating across two peers
- Contract state dump showing votes stored in Hyperbee

---

## SKILL.md

See [SKILL.md](./SKILL.md) for full agent-oriented operational instructions.

---

## License

MIT
