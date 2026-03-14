import type { ChallengeInput, RevealResult, SettlementLine, SettlementOutput } from './types.ts';

function bonusMultiplier(reliabilityScore: number): number {
  if (reliabilityScore >= 0.95) return 1;
  if (reliabilityScore >= 0.9) return 0.5;
  return 0;
}

function toMsats(sats: number): number {
  return sats * 1000;
}

export function settleChallenge(input: ChallengeInput, reveals: RevealResult[]): SettlementOutput {
  const valid = reveals
    .filter((r) => r.valid)
    .sort((a, b) => a.commitTs - b.commitTs || a.revealTs - b.revealTs || a.latencyMs - b.latencyMs);

  const winnersRaw = valid.slice(0, 3);

  const winners: SettlementLine[] = winnersRaw.map((r, idx) => {
    const rank = (idx + 1) as 1 | 2 | 3;
    const baseSats = input.payoutSchedule[idx] ?? 0;
    const bonusMsats = Math.floor(input.reliabilityBonusMsats * bonusMultiplier(r.reliabilityScore));

    return {
      responder: r.responder,
      rank,
      baseSats,
      bonusMsats,
      totalMsats: toMsats(baseSats) + bonusMsats,
    };
  });

  const excluded = reveals.filter((r) => !r.valid).map((r) => r.responder);

  return {
    challengeId: input.challengeId,
    epoch: input.epoch,
    winners,
    excluded,
  };
}
