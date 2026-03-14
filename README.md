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

## Next Steps

1. Add relay event ingestion/publishing layer for real challenge rounds.
2. Add payout execution adapter (LN).
3. Connect UI forms to live relay + blossom actions.
4. Extend fraud/dispute workflow with resolver quorum semantics.
5. Add demo walkthrough script (challenge -> settlement -> marketplace transfer).
