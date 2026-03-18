import type { MerkleProofNode } from '../../flower-contextvm/src/proof.ts';

export const FLOWER_EVENT_KINDS = {
  challenge: 33001,
  commit: 33002,
  reveal: 33003,
  settlement: 33004,
  marketListing: 33101,
  marketOffer: 33102,
  marketAccept: 33103,
  marketTransferProof: 33104,
  marketSettlement: 33105,
} as const;

export type FlowerEventType = keyof typeof FLOWER_EVENT_KINDS;

export interface ChallengeEventPayload {
  type: 'challenge';
  challengeId: string;
  epoch: number;
  contentRef: string;
  merkleRoot: string;
  leafIndex: number;
  nonce: string;
  commitDeadline: number;
  revealDeadline: number;
  payoutSchedule: [number, number, number];
  reliabilityBonusMsats: number;
}

export interface CommitEventPayload {
  type: 'commit';
  challengeId: string;
  responder: string;
  commitHash: string;
  commitTs: number;
}

export interface RevealEventPayload {
  type: 'reveal';
  challengeId: string;
  responder: string;
  commitTs: number;
  revealTs: number;
  latencyMs: number;
  reliabilityScore: number;
  leafHash: string;
  proof: MerkleProofNode[];
  expectedRoot: string;
  revealNonce: string;
}

export interface SettlementWinner {
  responder: string;
  rank: number;
  baseSats: number;
  bonusMsats: number;
  totalMsats: number;
}

export interface SettlementPayoutReceipt {
  responder: string;
  amountMsats: number;
  mintUrl: string;
  tokenRef: string;
  payoutId: string;
}

export interface SettlementEventPayload {
  type: 'settlement';
  challengeId: string;
  epoch: number;
  programHash: string;
  inputHash: string;
  outputHash: string;
  winners: SettlementWinner[];
  excluded: string[];
  payoutReceipts?: SettlementPayoutReceipt[];
}

export interface MarketListingEventPayload {
  type: 'market.listing';
  listingId: string;
  seller: string;
  contentRef: string;
  merkleRoot: string;
  priceSats: number;
  terms: {
    deliveryDeadline: number;
    cooldownSeconds: number;
  };
}

export interface MarketOfferEventPayload {
  type: 'market.offer';
  offerId: string;
  listingId: string;
  buyer: string;
  paymentRef: string;
  offerTs: number;
}

export interface MarketAcceptEventPayload {
  type: 'market.accept';
  offerId: string;
  listingId: string;
  seller: string;
  acceptTs: number;
  transferId: string;
}

export interface MarketTransferProofEventPayload {
  type: 'market.transfer_proof';
  transferId: string;
  listingId: string;
  seller: string;
  buyer: string;
  contentRef: string;
  merkleRoot: string;
  sampleLeafHash: string;
  sampleProof: MerkleProofNode[];
  proofTs: number;
}

export interface MarketSettlementEventPayload {
  type: 'market.settlement';
  transferId: string;
  listingId: string;
  offerId: string;
  seller: string;
  buyer: string;
  priceSats: number;
  paymentSettled: boolean;
  verified: boolean;
  cooldownUntil: number;
  eligibility: 'none' | 'pending' | 'active';
}

export type FlowerPayload =
  | ChallengeEventPayload
  | CommitEventPayload
  | RevealEventPayload
  | SettlementEventPayload
  | MarketListingEventPayload
  | MarketOfferEventPayload
  | MarketAcceptEventPayload
  | MarketTransferProofEventPayload
  | MarketSettlementEventPayload;

export interface RelayFilter {
  kinds?: number[];
  authors?: string[];
  challengeId?: string;
  type?: FlowerPayload['type'];
}

export interface PublishedFlowerEvent<T extends FlowerPayload = FlowerPayload> {
  id: string;
  kind: number;
  pubkey: string;
  createdAt: number;
  payload: T;
  raw?: unknown;
}

export interface RuntimeSigner {
  secretKey: Uint8Array;
  publicKey: string;
  npub: string;
}

export interface BlossomFixture {
  blobId: string;
  content: string;
  contentRef: string;
  leafHash: string;
  merkleRoot: string;
  sampleLeafHash: string;
  sampleProof: MerkleProofNode[];
}

export interface RetrievedBlossomObject extends BlossomFixture {
  sourceUrl: string;
}

export interface AutonomousRoundConfig {
  challengeId?: string;
  blobId?: string;
  epoch?: number;
  commitLeadSeconds?: number;
  revealLeadSeconds?: number;
  payoutSchedule?: [number, number, number];
  reliabilityBonusMsats?: number;
  responderReliability?: number;
  responderLatencyMs?: number;
}

export interface AutonomousRoundResult {
  challenge: PublishedFlowerEvent<ChallengeEventPayload>;
  commit: PublishedFlowerEvent<CommitEventPayload>;
  reveal: PublishedFlowerEvent<RevealEventPayload>;
  settlement: PublishedFlowerEvent<SettlementEventPayload>;
  blossom: RetrievedBlossomObject;
}

export interface ChallengeRuntimeView {
  challenge: PublishedFlowerEvent<ChallengeEventPayload>;
  commits: PublishedFlowerEvent<CommitEventPayload>[];
  reveals: PublishedFlowerEvent<RevealEventPayload>[];
  settlement?: PublishedFlowerEvent<SettlementEventPayload>;
  status: 'open' | 'settled';
}

export interface MarketplaceRuntimeView {
  listing: PublishedFlowerEvent<MarketListingEventPayload>;
  offers: PublishedFlowerEvent<MarketOfferEventPayload>[];
  accept?: PublishedFlowerEvent<MarketAcceptEventPayload>;
  transferProof?: PublishedFlowerEvent<MarketTransferProofEventPayload>;
  settlement?: PublishedFlowerEvent<MarketSettlementEventPayload>;
}

export interface RuntimeIdentityView {
  role: 'owner' | 'provider' | 'provider2' | 'settler';
  npub: string;
  pubkey: string;
  cashuTestMnemonic?: string;
}

export interface RuntimeSnapshot {
  updatedAt: number;
  relayMode: 'memory' | 'nostr';
  relayUrls: string[];
  blossomBaseUrl: string;
  identities: RuntimeIdentityView[];
  blobs: BlossomFixture[];
  challenges: ChallengeRuntimeView[];
  listings: MarketplaceRuntimeView[];
}
