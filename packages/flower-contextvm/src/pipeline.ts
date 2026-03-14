import { verifyMerkleProof } from './proof.ts';
import { settleChallenge } from './settlement.ts';
import type { ChallengeInput, RevealResult, SettlementOutput } from './types.ts';
import type { MerkleProofNode } from './proof.ts';

export interface ChallengeExecutionInput extends ChallengeInput {
  merkleRoot: string;
  commitDeadline: number;
  revealDeadline: number;
}

export interface ProofRevealInput {
  responder: string;
  commitTs: number;
  revealTs: number;
  latencyMs: number;
  reliabilityScore: number;
  leafHash: string;
  proof: MerkleProofNode[];
  expectedRoot: string;
}

function isWithinWindows(challenge: ChallengeExecutionInput, reveal: ProofRevealInput): boolean {
  return reveal.commitTs <= challenge.commitDeadline && reveal.revealTs <= challenge.revealDeadline;
}

function isProofValid(challenge: ChallengeExecutionInput, reveal: ProofRevealInput): boolean {
  if (reveal.expectedRoot !== challenge.merkleRoot) return false;
  return verifyMerkleProof(reveal.leafHash, reveal.proof, challenge.merkleRoot);
}

export function settleChallengeFromProofs(
  challenge: ChallengeExecutionInput,
  reveals: ProofRevealInput[],
): SettlementOutput {
  const materialized: RevealResult[] = reveals.map((r) => ({
    responder: r.responder,
    commitTs: r.commitTs,
    revealTs: r.revealTs,
    latencyMs: r.latencyMs,
    reliabilityScore: r.reliabilityScore,
    valid: isWithinWindows(challenge, r) && isProofValid(challenge, r),
  }));

  return settleChallenge(challenge, materialized);
}
