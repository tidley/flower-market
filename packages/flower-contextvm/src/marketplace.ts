import { verifyMerkleProof } from './proof.ts';
import type { MerkleProofNode } from './proof.ts';

export interface TransferProofInput {
  sampleLeafHash: string;
  sampleProof: MerkleProofNode[];
  merkleRoot: string;
}

export type EligibilityState = 'none' | 'pending' | 'active';

export function verifyTransferProof(input: TransferProofInput): boolean {
  return verifyMerkleProof(input.sampleLeafHash, input.sampleProof, input.merkleRoot);
}

export function deriveEligibilityState(
  settlementVerified: boolean,
  paymentSettled: boolean,
  nowTs: number,
  cooldownUntil: number,
): EligibilityState {
  if (!settlementVerified || !paymentSettled) return 'none';
  if (nowTs < cooldownUntil) return 'pending';
  return 'active';
}

export function rejectDuplicateSettlement(seenTransferIds: Set<string>, transferId: string): boolean {
  if (seenTransferIds.has(transferId)) return true;
  seenTransferIds.add(transferId);
  return false;
}
