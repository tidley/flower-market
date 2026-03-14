# Flower Market Protocol v0.1 (Draft)

Status: Draft  
Version: 0.1.0

## 1. Scope

Flower Market defines a relay-native, blossom-backed retrieval market with deterministic settlement.

This spec standardizes:
- challenge/commit/reveal/settlement events,
- Merkle proof verification inputs,
- deterministic ranking and payout computation,
- replayable settlement envelope hashes.

## 2. Normative language

The key words **MUST**, **MUST NOT**, **SHOULD**, **MAY** are to be interpreted as in RFC 2119.

## 3. Architecture constraints

1. Protocol state MUST be represented as signed relay events.
2. Data blobs/chunks MUST be addressed and fetched from Blossom-compatible storage.
3. Settlement logic MUST be deterministic and re-runnable from public inputs.
4. SHA-256 MUST be used for hashing in v0.1.

## 4. Canonical data rules

1. Event payloads used for hashing MUST be canonical JSON with lexicographically sorted object keys.
2. Hash outputs MUST be lowercase hex strings.
3. Branch positions in Merkle proofs MUST be explicit: `left` or `right`.

## 5. Event schemas

## 5.1 Challenge

```json
{
  "type": "challenge",
  "challengeId": "ch_2026_0001",
  "epoch": 1,
  "blobId": "<blossom-id>",
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
- `commitDeadline` MUST be < `revealDeadline`.
- `payoutSchedule` SHOULD include at least 3 entries.

## 5.2 Commit

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
- Commit MUST be published before `commitDeadline`.
- `commitHash` MUST commit to reveal payload and nonce.

## 5.3 Reveal

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
- Reveal MUST be published before `revealDeadline`.
- `proof` nodes MUST be evaluated in listed order.
- `leafHash + proof` MUST reconstruct `expectedRoot`.

## 5.4 Settlement

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
- A settlement publisher SHOULD include payment references once paid.

## 6. Deterministic ranking and payout

1. Exclude reveals with invalid proofs.
2. Sort valid reveals by:
   1) `commitTs` ascending
   2) `revealTs` ascending
   3) `latencyMs` ascending
3. Select top 3.
4. Base payouts default to [15,10,5] sats unless challenge overrides.
5. Bonus multiplier:
   - reliability >= 0.95 => 1.0x
   - reliability >= 0.90 => 0.5x
   - else => 0x
6. `totalMsats = baseSats * 1000 + bonusMsats`.

## 7. Security requirements

1. Implementations MUST validate signatures on all events.
2. Implementations MUST reject late commits/reveals.
3. Implementations SHOULD enforce replay protection using `challengeId` and unique commit/reveal tuples.
4. Implementations SHOULD use commit-reveal to reduce front-running.

## 8. Conformance

An implementation is v0.1-conformant if it:
- passes Merkle proof vectors (valid + invalid),
- reproduces deterministic winner order,
- reproduces settlement envelope hashes for equivalent canonical input.
