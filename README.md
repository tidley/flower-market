# Flower Market

**ngit repo:** nostr://npub1z5jf78uhd68znuwwwu926th55rzd0wy8nd9clkr03cx22mwme0jqazk56h/relay.ngit.dev/flower-market  
**ngit web:** https://gitworkshop.dev/npub1z5jf78uhd68znuwwwu926th55rzd0wy8nd9clkr03cx22mwme0jqazk56h/relay.ngit.dev/flower-market

Flower Market is a retrieval-bounty marketplace for verifiable data availability.

It builds on Merkle proofs and challenge-response rounds to reward storage nodes that are:

- online,
- fast to respond, and
- consistently reliable.

## Why Flower Market

Traditional storage claims are hard to verify in real time. Flower Market adds an open market mechanism where nodes prove retrievability and get paid based on objective verification.

What is novel here:

- **Relay-native control plane (Nostr):** challenge/commit/reveal/settlement can run as signed relay events.
- **Storage-agnostic compatibility:** providers can use Blossom, IPFS, DB, filesystems, etc., as long as they produce standard proof outputs.
- **Deterministic ContextVM settlement:** anyone can re-run and verify winner ranking and payout outputs from public inputs.
- **Fast retrieval bounty incentives:** ranked rewards (15/10/5 sats) plus reliability bonus.
- **Peer replication marketplace:** participants can buy/sell data transfer and join retrieval competition after verification.

## Core Concept

1. A challenger posts a retrieval challenge for a blob/chunk.
2. Responders submit a commit (anti-front-running).
3. Responders reveal proof + data fragment.
4. Verifiers validate Merkle inclusion + timing.
5. Top responders receive payouts.

Initial payout target:

- 1st: 15 sats
- 2nd: 10 sats
- 3rd: 5 sats
- plus reliability bonus (msat-scale)

## Current Status

This repository currently contains:

- baseline code imported from treelike,
- Flower Market design draft (`design/flower-market/v0.1.md`),
- initial repository setup on GitHub + ngit.

## Repository Mirrors

- GitHub: https://github.com/tidley/flower-market
- ngit (Nostr): nostr://npub1z5jf78uhd68znuwwwu926th55rzd0wy8nd9clkr03cx22mwme0jqazk56h/relay.ngit.dev/flower-market
- ngit web: https://gitworkshop.dev/npub1z5jf78uhd68znuwwwu926th55rzd0wy8nd9clkr03cx22mwme0jqazk56h/relay.ngit.dev/flower-market

## ContextVM Blocks (started)

- Spec: `design/flower-market/contextvm-v0.md`
- Prototype package: `packages/flower-contextvm/`
- Exported function: `settleChallenge(input, reveals)`

This is the first deterministic settlement block: same input -> same ranked winners + payout output.

## Minimal UI Scaffold

A minimal owner/SP simulation UI is now included:

- App path: `apps/flower-ui`
- UX spec: `design/ui-ux-spec-v0.md`
- Run locally: `npm run ui:dev`
- Build: `npm run ui:build`

## Autonomous Runtime Demo

A first live runtime scaffold is now included for autonomous challenge rounds over Nostr-style events:

- Runtime package: `packages/flower-runtime`
- Root test command: `npm test`
- Local autonomous demo: `npm run runtime:demo -- --blob-id demo_blob --content "relay demo payload"`
- Long-running daemon: `npm run runtime:daemon`

What the demo does:

1. Starts a dummy Blossom HTTP server with a deterministic blob fixture.
2. Creates owner, responder, and settler identities.
3. Publishes `challenge`, `commit`, `reveal`, and `settlement` events through the runtime transport.
4. Computes deterministic settlement hashes and prints a replayable summary.

To target real relays instead of the in-memory transport, pass one or more relay URLs:

```bash
npm run runtime:demo -- \
  --relay wss://relay.damus.io \
  --relay wss://nos.lol \
  --blob-id demo_blob \
  --content "relay demo payload"
```

Current limitation:

- The runtime publishes to real relays when `--relay` is provided, but still uses the local dummy Blossom server for content/proof fixtures.
- LN payout execution is still not implemented.

## Owner / Provider Web UI

The UI in `apps/flower-ui` now talks to the runtime daemon over `/api` and exposes simple owner/SP flows:

- Owner side:
  - upload text/file payloads into the dummy Blossom service
  - configure payout schedule + deadlines
  - publish retrieval challenges
  - publish marketplace listings
  - accept offers and publish transfer proofs
- Provider side:
  - see open challenges
  - publish commit + reveal responses
  - place offers on listings
  - watch eligibility and transfer settlement

Run it locally with two terminals:

```bash
# terminal 1
npm run runtime:daemon

# terminal 2
npm run ui:dev
```

By default, the daemon now uses these relays for challenge notes/events:
- `wss://nos.lol`
- `wss://relay.damus.io`

If you want local-only mode (no relay connections), start daemon with:

```bash
npm run runtime:daemon -- --memory
# or: FLOWER_RELAY_MODE=memory npm run runtime:daemon
```

To override relay set:

```bash
npm run runtime:daemon -- \
  --relay wss://relay.damus.io \
  --relay wss://nos.lol
# or via env:
# FLOWER_RELAYS=wss://nos.lol,wss://relay.damus.io npm run runtime:daemon
```

The Vite dev server proxies `/api` to `http://127.0.0.1:${FLOWER_API_PORT}` (default `8787`).

Example using port `8788`:

```bash
FLOWER_API_PORT=8788 npm run ui:dev
```

## VPS Deployment

Minimal VPS deployment files are in `deploy/flower-runtime/`:

- `flower-runtime.service`
- `flower-runtime.env.example`
- `Caddyfile`

Expected shape:

1. Clone repo to `/opt/flower-market`
2. Install dependencies
3. Build UI with `npm run ui:build`
4. Copy `deploy/flower-runtime/flower-runtime.env.example` to `deploy/flower-runtime/flower-runtime.env`
5. Install the systemd unit and start it
6. Use Caddy to serve `apps/flower-ui/dist` and reverse proxy `/api` to the daemon

## Next Steps

1. Replace polling with long-lived relay subscriptions for lower-latency settlement.
2. Add LN payout execution adapter and signed payment receipts.
3. Persist daemon state and Blossom fixtures to disk.
4. Extend fraud/dispute workflow with resolver quorum semantics.
5. Split provider automation into a separately deployable worker process.

## 3-4 Window Demo Layout (current)

Detailed runbook: `demo/DEMO-RUNBOOK.md`

One-shot timeline script: `node demo/run-demo-timeline.mjs`

Open the Flower UI in separate windows:

- Challenger view: `http://127.0.0.1:5173/?view=challenger`
- SP1 view: `http://127.0.0.1:5173/?view=sp1`
- SP2 view: `http://127.0.0.1:5173/?view=sp2`
- Optional combined view: `http://127.0.0.1:5173/?view=all`

Also open a separate Nostr feed window (jumble.social) for the owner npub link shown in the challenger panel.

What the current demo shows:
1. Challenger can post retrieval challenges manually or every 30s.
2. Challenger sees tracked file/content refs, responders, and last checked times.
3. SP1 view shows tracked files, open challenges, and response action.
4. SP2 view is currently a demo placeholder dashboard (next step: wire real second provider identity).

## `jmcorgan/fips` tie-in plan

Target split:
- Flower Market runtime + NIP-17/bootstrap control flow here.
- Secure post-bootstrap session/data plane delegated to `jmcorgan/fips`.

Planned integration deliverables:
- bootstrap transcript schema (session id, peers, selected path, proof context)
- adapter interface from runtime challenge flow into FIPS session setup
- integration tests validating bootstrap -> FIPS handoff success/failure/replay paths
