# Flower Market Status

Last updated: 2026-03-17

## Objective
Build Flower Market using TDD: deterministic settlement + verifiable proofs + payout pipeline.

## Current phase
Phase 2 — deterministic core + demo orchestration (without dropping core roadmap items).

Protocol updates in progress:
- Exact reputationScore formula drafted into `spec/flower-market-v0.1.md`.
- Provider-bound encrypted replica guidance added for anti-cross-provider replay.

## Implemented
- ContextVM settlement scaffold (`packages/flower-contextvm`)
- Deterministic settlement kernel (`settleChallenge`)
- Deterministic envelope hashing (`buildSettlementEnvelope`)
- Initial tests passing (8 total)
- Multi-window UI modes for demo (`challenger`, `sp1`, `sp2`, `all`)
- Challenger controls for manual + 30s recurring challenges

## Planned phases (high level)
- P0 Foundations ✅
- P1 Proof Core (in progress)
- P2 Protocol Spec v0.1
- P3 Settlement Integration
- P4 Payout Engine Interface
- P5 Marketplace (peer buy/sell replication)
- P6 Simulation + Hardening

## Next checkpoint
Integrate proof validity into settlement flow and formalize protocol spec v0.1 while validating the multi-window demo flow.
