# Flower Market

**ngit repo:** nostr://npub1z5jf78uhd68znuwwwu926th55rzd0wy8nd9clkr03cx22mwme0jqazk56h/relay.ngit.dev/flower-market  
**ngit web:** https://gitworkshop.dev/npub1z5jf78uhd68znuwwwu926th55rzd0wy8nd9clkr03cx22mwme0jqazk56h/relay.ngit.dev/flower-market

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

## ContextVM Blocks (started)

- Spec: `design/flower-market/contextvm-v0.md`
- Prototype package: `packages/flower-contextvm/`
- Exported function: `settleChallenge(input, reveals)`

This is the first deterministic settlement block: same input -> same ranked winners + payout output.

## Next Steps

1. Wire `settleChallenge` into challenge/reveal event ingestion.
2. Define canonical Merkle leaf/proof format.
3. Implement verifier module for full proof checks.
4. Add payout execution adapter (LN).
5. Add replication market flow (pay-to-copy, delayed eligibility).
