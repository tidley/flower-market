# Flower Market UI/UX Spec v0

## Goals

- Let a **Data Owner** publish/fund retrieval challenges quickly.
- Let a **Storage Provider (SP)** acquire data and compete for payouts.
- Make settlement and eligibility state transparent.

## Personas

1. **Data Owner (DO)**
   - Wants retrievability guarantees and simple budget control.
2. **Storage Provider (SP)**
   - Wants to earn sats by proving fast reliable retrieval.
3. **Verifier (advanced)**
   - Wants deterministic replay and auditability.

## Information architecture

- Owner Console
- SP Console
- Challenge Feed
- Marketplace Feed
- Settlement/Audit View

## Screen flows

### 1) Owner: Save + Fund + Publish

1. Input `contentRef` (or upload later integration)
2. Input `merkleRoot`
3. Set challenge parameters:
   - payout schedule (default 15/10/5)
   - reliability bonus msats
   - commit/reveal deadlines
4. Preview deterministic fields
5. Publish challenge event

### 2) SP: Acquire + Compete

1. View marketplace listings
2. Buy listing (offer -> accept -> transfer proof -> settlement)
3. Wait cooldown (`pending`)
4. Become `active`
5. Submit challenge commit/reveal when rounds open

### 3) Settlement + audit

- Show winner ranks, payouts, excluded responders
- Show deterministic replay envelope:
  - programHash
  - inputHash
  - outputHash
- Show reason codes for invalidation:
  - late commit
  - late reveal
  - root mismatch
  - invalid proof

## UX requirements

- One-line reason for every rejection
- Explicit eligibility badge: `none | pending | active`
- Human-readable sats/msats display
- Copy buttons for IDs/hashes

## Minimal v0 UI scaffold scope

- Mock/local-only state (no relay wiring yet)
- Owner challenge form
- SP transfer proof validator
- Eligibility simulator (cooldown)
- Settlement simulator using current runtime package

## Out of scope (next)

- Real relay subscriptions/publishing
- Real LN payment execution
- Auth/session key management
