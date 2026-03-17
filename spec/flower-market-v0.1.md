# Flower Market Protocol v0.1 (Draft)

Status: Draft  
Version: 0.1.2

## 1. Scope

Flower Market defines a relay-native retrieval market with deterministic settlement.

This spec standardizes:
- challenge / commit / reveal / settlement events,
- Merkle proof verification inputs,
- deterministic ranking and payout computation,
- replayable settlement envelope hashes,
- storage-agnostic content addressing.

## 2. Normative language

The key words **MUST**, **MUST NOT**, **SHOULD**, **MAY** are to be interpreted as in RFC 2119.

## 3. Roles and terminology

- **Storage Provider (SP):** participant offering retrievable data for challenges.
- **Data Owner (DO):** participant funding or requesting retrievability.
- **Verifier:** participant re-running deterministic validation and settlement.
- **Settlement Publisher:** actor that publishes settlement event(s); MAY be any verifier.

## 4. Architecture constraints

1. Protocol state MUST be represented as signed relay events.
2. Settlement logic MUST be deterministic and re-runnable from public inputs.
3. SHA-256 MUST be used for hashing in v0.1.
4. Storage backends MUST be treated as interchangeable implementations behind a common content reference + proof interface.

## 5. Storage-agnostic compatibility model

### 5.1 Backend neutrality

Storage Providers MAY use any internal storage implementation (filesystem, DB, object store, IPFS, Blossom, etc.) if they satisfy protocol outputs.

### 5.2 Required interoperability surface

For each challenged datum, an implementation MUST be able to provide:

1. `contentRef` (string): backend-specific locator (CID, Blossom id, URL, key, etc.)
2. `leafHash` (sha256 hex)
3. `proof[]` where each node is `{ hash, position }`
4. `expectedRoot` (sha256 hex)

A verifier MUST NOT depend on backend-specific internals. Verification MUST be performed from `leafHash + proof + expectedRoot` only.

### 5.3 Recommended locator scheme

Use explicit URI-like prefixes for `contentRef`:
- `blossom:<id>`
- `ipfs:<cid>`
- `https://...`
- `db:<opaque-key>`

### 5.4 Provider-bound encrypted replicas (anti-cross-provider replay)

To prevent one Storage Provider from reusing another provider's challenge material, each provider SHOULD store a provider-specific encrypted replica.

Recommended model:
1. For provider `sp_i`, data owner derives unique encryption context using provider identity and challenge namespace.
2. Encrypted dataset yields provider-specific Merkle root `R_i`.
3. Challenger/verifier tracks mapping `sp_i -> R_i`.
4. A challenge to `sp_i` MUST be verified against `R_i` (not a shared global root).

Implications:
- proofs are provider-bound by root,
- cross-provider answer replay fails verification,
- challenge verification remains backend-agnostic.

## 6. Canonical data and hashing rules

1. Event payloads used for hashing MUST be canonical JSON with lexicographically sorted object keys.
2. Hash outputs MUST be lowercase hex strings.
3. Branch positions in Merkle proofs MUST be explicit: `left` or `right`.
4. Pair hashing MUST be order-sensitive: `H(left || right)`.

## 7. Locked event schemas

## 7.1 Challenge

```json
{
  "type": "challenge",
  "challengeId": "ch_2026_0001",
  "epoch": 1,
  "contentRef": "blossom:<id>",
  "merkleRoot": "<sha256-hex>",
  "leafIndex": 42,
  "nonce": "<hex-or-string>",
  "commitDeadline": 1710000000,
  "revealDeadline": 1710000300,
  "payoutSchedule": [15, 10, 5],
  "reliabilityBonusMsats": 1000
}
```

Rules:
- `challengeId` MUST be globally unique.
- `epoch` MUST be integer >= 0.
- `leafIndex` MUST be integer >= 0.
- `commitDeadline` MUST be < `revealDeadline`.
- `payoutSchedule` MUST contain at least 3 non-negative integers.
- `reliabilityBonusMsats` MUST be integer >= 0.

## 7.2 Commit

```json
{
  "type": "commit",
  "challengeId": "ch_2026_0001",
  "responder": "<npub-or-hex-pubkey>",
  "commitHash": "<sha256-hex>",
  "commitTs": 1710000010
}
```

Rules:
- Commit MUST be published at or before `commitDeadline`.
- `commitHash` MUST commit to reveal payload and nonce.

## 7.3 Reveal

```json
{
  "type": "reveal",
  "challengeId": "ch_2026_0001",
  "responder": "<npub-or-hex-pubkey>",
  "commitTs": 1710000010,
  "revealTs": 1710000100,
  "latencyMs": 420,
  "leafHash": "<sha256-hex>",
  "proof": [
    { "hash": "<sha256-hex>", "position": "right" },
    { "hash": "<sha256-hex>", "position": "left" }
  ],
  "expectedRoot": "<sha256-hex>",
  "revealNonce": "<nonce>"
}
```

Rules:
- Reveal MUST be published at or before `revealDeadline`.
- `latencyMs` MUST be integer >= 0.
- `proof` nodes MUST be evaluated in listed order.
- `expectedRoot` MUST equal challenge `merkleRoot`.
- `leafHash + proof` MUST reconstruct challenge `merkleRoot`.

## 7.4 Settlement

```json
{
  "type": "settlement",
  "challengeId": "ch_2026_0001",
  "epoch": 1,
  "programHash": "<sha256-hex>",
  "inputHash": "<sha256-hex>",
  "outputHash": "<sha256-hex>",
  "winners": [
    { "responder": "npub...", "rank": 1, "baseSats": 15, "bonusMsats": 1000, "totalMsats": 16000 },
    { "responder": "npub...", "rank": 2, "baseSats": 10, "bonusMsats": 500, "totalMsats": 10500 },
    { "responder": "npub...", "rank": 3, "baseSats": 5, "bonusMsats": 0, "totalMsats": 5000 }
  ],
  "excluded": ["npub..."]
}
```

Rules:
- Settlement MUST be reproducible from challenge + reveals + deterministic program version.
- `rank` MUST be unique and in [1,2,3].
- `totalMsats` MUST equal `baseSats * 1000 + bonusMsats`.

## 8. Deterministic ranking and payout

1. Exclude reveals with invalid proofs.
2. A reveal MUST be marked invalid if commit/reveal deadlines fail, proof fails, or expectedRoot mismatches challenge merkleRoot.
3. Sort valid reveals by:
   1) `commitTs` ascending
   2) `revealTs` ascending
   3) `latencyMs` ascending
4. Select top 3.
5. Base payouts default to [15,10,5] sats unless challenge overrides.
6. Reputation score MUST be computed per responder using a rolling window of the latest `W=100` challenge opportunities:
   - `successRate = validResponses / max(1, responded)`
   - `availability = responded / max(1, eligible)`
   - `latencyScore = min(1, LATENCY_REF_MS / max(1, medianValidLatencyMs))` where `LATENCY_REF_MS = 300`
   - `rawScore = 0.60 * successRate + 0.30 * latencyScore + 0.10 * availability`
   - cold-start smoothing: `reputationScore = (n / (n + K)) * rawScore + (K / (n + K)) * PRIOR` where:
     - `n = min(W, eligible)`
     - `K = 20`
     - `PRIOR = 0.50`
7. Reputation score MUST be clamped to `[0,1]` and rounded to 4 decimal places before payout math.
8. Reliability bonus distribution MUST be proportional across selected winners:
   - `bonusMsats_i = floor(reliabilityBonusMsats * reputationScore_i / sum(reputationScore_winners))`
   - if all winner scores are 0, `bonusMsats_i = 0` for all winners.
9. `totalMsats = baseSats * 1000 + bonusMsats`.

## 9. Security requirements

1. Implementations MUST validate signatures on all events.
2. Implementations MUST reject late commits/reveals.
3. Implementations MUST enforce replay protection using `challengeId` and unique commit/reveal tuples.
4. Implementations SHOULD use commit-reveal to reduce front-running.

## 10. Reference compatibility tests

Participants SHOULD run reference tests before joining production rounds.

Minimum required vectors:
1. valid proof -> verification true
2. wrong sibling order -> false
3. tampered leaf -> false
4. wrong root -> false
5. deterministic envelope equality for semantically identical canonical input
6. deterministic ranking tie-break (commitTs, revealTs, latency)
7. pipeline deadline rejection (late commit/reveal -> invalid)
8. expectedRoot mismatch rejection

Reference implementation path:
- `packages/flower-contextvm/src/proof.test.ts`
- `packages/flower-contextvm/src/envelope.test.ts`
- `packages/flower-contextvm/src/settlement.test.ts`
- `packages/flower-contextvm/src/pipeline.test.ts`
- `packages/flower-contextvm/src/conformance.test.ts`

Reference fixture path:
- `spec/fixtures/v0.1/proof-vectors.json`
- `spec/fixtures/v0.1/settlement-vectors.json`
- `spec/fixtures/v0.1/envelope-vectors.json`

Conformance requirement:
- test coverage MUST be >=95%; target is 100%.

## 11. Conformance

An implementation is v0.1-conformant if it:
- passes reference proof vectors,
- reproduces deterministic winner order,
- reproduces settlement envelope hashes for equivalent canonical input,
- satisfies schema and rule constraints in sections 5-10.
