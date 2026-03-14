# Flower Market Marketplace Protocol v0.1 (Draft)

Status: Draft  
Version: 0.1.1

## 1. Scope

Defines peer buy/sell replication flow so participants can acquire data and become eligible Storage Providers.

Flow:
1. Listing
2. Offer
3. Accept
4. Transfer Proof
5. Settlement Receipt

## 2. Normative requirements

- Events MUST be signed relay events.
- `listingId`, `offerId`, `transferId` MUST be unique.
- Eligibility for retrieval payouts MUST remain disabled until transfer verification succeeds and cooldown expires.

## 3. Event schemas

## 3.1 Listing

```json
{
  "type": "market.listing",
  "listingId": "lst_001",
  "seller": "<npub>",
  "contentRef": "blossom:<id>",
  "merkleRoot": "<sha256-hex>",
  "priceSats": 5,
  "terms": {
    "deliveryDeadline": 1710003600,
    "cooldownSeconds": 3600
  }
}
```

Rules:
- `priceSats` MUST be integer >= 0.
- `cooldownSeconds` MUST be integer >= 0.

## 3.2 Offer

```json
{
  "type": "market.offer",
  "offerId": "off_001",
  "listingId": "lst_001",
  "buyer": "<npub>",
  "paymentRef": "<invoice-or-tx-ref>",
  "offerTs": 1710000100
}
```

Rules:
- Offer MUST reference an active listing.
- Buyer SHOULD include payment capability metadata.

## 3.3 Accept

```json
{
  "type": "market.accept",
  "offerId": "off_001",
  "listingId": "lst_001",
  "seller": "<npub>",
  "acceptTs": 1710000200,
  "transferId": "tr_001"
}
```

Rules:
- Only listing seller MAY publish accept for that listing.
- An accepted offer MUST bind one `transferId`.

## 3.4 Transfer Proof

```json
{
  "type": "market.transfer_proof",
  "transferId": "tr_001",
  "listingId": "lst_001",
  "seller": "<npub>",
  "buyer": "<npub>",
  "contentRef": "blossom:<id-or-new-ref>",
  "merkleRoot": "<sha256-hex>",
  "sampleLeafHash": "<sha256-hex>",
  "sampleProof": [
    { "hash": "<sha256-hex>", "position": "right" }
  ],
  "proofTs": 1710000300
}
```

Rules:
- Buyer/verifier MUST validate sample proof against `merkleRoot`.
- Transfer proof MUST be rejected if root mismatch or proof invalid.

## 3.5 Settlement Receipt

```json
{
  "type": "market.settlement",
  "transferId": "tr_001",
  "listingId": "lst_001",
  "offerId": "off_001",
  "seller": "<npub>",
  "buyer": "<npub>",
  "priceSats": 5,
  "paymentSettled": true,
  "verified": true,
  "cooldownUntil": 1710003900,
  "eligibility": "pending"
}
```

Rules:
- `verified` MUST be true only when transfer proof check passes.
- `eligibility` MUST be `pending` when `paymentSettled=true`, `verified=true`, and `nowTs < cooldownUntil`.
- `eligibility` MUST be `active` when `paymentSettled=true`, `verified=true`, and `nowTs >= cooldownUntil`.
- `eligibility` MUST be `none` otherwise.

## 4. Eligibility state machine

States:
- `none` -> `pending` -> `active`

Transitions:
1. On valid settlement receipt with payment + verification: `none -> pending`
2. When cooldown elapsed and no fraud event: `pending -> active`
3. On fraud proof: `pending|active -> none`

## 5. Fraud and dispute hooks (v0.1)

### 5.1 Fraud Proof event

```json
{
  "type": "market.fraud_proof",
  "fraudId": "fr_001",
  "transferId": "tr_001",
  "listingId": "lst_001",
  "reporter": "<npub>",
  "reason": "invalid_transfer_proof",
  "evidence": {
    "sampleLeafHash": "<sha256-hex>",
    "sampleProof": [
      { "hash": "<sha256-hex>", "position": "left" }
    ],
    "merkleRoot": "<sha256-hex>"
  }
}
```

Rules:
- Fraud proof MUST include sufficient evidence to recompute invalidity.
- Fraud proof is valid when evidence demonstrates transfer proof invalidity.
- Valid fraud proof MUST force eligibility rollback to `none`.

## 6. Security requirements

- Implementations MUST verify event signatures and identity binding for seller/buyer roles.
- Implementations MUST reject duplicate settlement for same `transferId`.
- Implementations SHOULD verify fraud proof evidence before rollback.

## 7. Conformance vectors

Implemented fixture path:
- `spec/fixtures/v0.1/marketplace-vectors.json`

Implemented runtime tests:
- `packages/flower-contextvm/src/marketplace.test.ts`

Required vectors:
1. valid listing/offer/accept/transfer/settlement chain
2. invalid transfer proof
3. cooldown enforcement
4. duplicate settlement rejection
5. valid fraud proof -> rollback to `none`
6. invalid fraud proof -> no rollback
