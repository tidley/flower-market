# Flower Market ContextVM Blocks (v0)

This document defines the first executable blocks to move Flower Market toward deterministic settlement.

## Block 1: Deterministic Settlement Kernel

**Goal:** Given a challenge and reveal results, produce deterministic winners + payout outputs.

### Inputs

- `challengeId`
- `epoch`
- `payoutSchedule`: `[15, 10, 5]` sats
- `reliabilityBonusMsats`: integer (e.g. `1000`)
- `reveals[]` with:
  - responder id
  - commit timestamp
  - reveal timestamp
  - validity flag
  - latency
  - rolling reliability score (0..1)

### Rules

1. Filter to valid reveals.
2. Sort by:
   1. earliest `commitTs`
   2. then earliest `revealTs`
   3. then lowest latency
3. Select top 3.
4. Apply base payout by rank: 15/10/5 sats.
5. Apply reliability bonus multiplier:
   - >= 0.95 => 1.0x
   - >= 0.90 => 0.5x
   - else => 0x

### Outputs

- Winner set with rank, base sats, bonus msats, total msats
- Excluded responders list

## Block 2: ContextVM Envelope

To make this re-runnable by any verifier, package the settlement as:

- `programHash`
- `inputHash`
- `outputHash`
- optional `witness` data (e.g. signatures or relay references)

This allows independent validation that the exact same code + input gave the payout result.

## Block 3: Replay-Ready Event Format (next)

Emit settlement records with:

- deterministic IDs (`challengeId`, `epoch`)
- resolver metadata (`programHash`, version)
- payment pointers (LN tx / invoice settlement reference)

## Current Implementation

Prototype package added at:

- `packages/flower-contextvm/`

Exports:

- `settleChallenge(input, reveals)`

This is intentionally small and deterministic so it can be embedded in a future ContextVM runtime or mirrored by off-chain verifier workers.
