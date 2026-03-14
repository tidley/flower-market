export { buildSettlementEnvelope, stableStringify } from './envelope.ts';
export { deriveEligibilityState, rejectDuplicateSettlement, verifyTransferProof } from './marketplace.ts';
export type { EligibilityState, TransferProofInput } from './marketplace.ts';
export { settleChallengeFromProofs } from './pipeline.ts';
export type { ChallengeExecutionInput, ProofRevealInput } from './pipeline.ts';
export { hashLeaf, hashPair, verifyMerkleProof } from './proof.ts';
export type { MerkleProofNode, ProofPosition } from './proof.ts';
export { settleChallenge } from './settlement.ts';
export type {
  ChallengeInput,
  RevealResult,
  SettlementLine,
  SettlementOutput,
  Sats,
  Msats,
} from './types.ts';
