# Flower Market

Flower Market is a retrieval-bounty marketplace for verifiable data availability.

It builds on Merkle proofs and challenge-response rounds to reward storage nodes that are:

- online,
- fast to respond, and
- consistently reliable.

## Why

Traditional storage claims are hard to verify in real time. Flower Market adds an open market mechanism where nodes prove retrievability and get paid based on objective verification.

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

## Next Steps

1. Define canonical Merkle leaf/proof format.
2. Implement verifier module.
3. Implement payout engine.
4. Add replication market flow (pay-to-copy, delayed eligibility).
5. Add metrics dashboard for latency/reliability leaderboards.
