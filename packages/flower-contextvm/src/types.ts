export type Sats = number;
export type Msats = number;

export interface ChallengeInput {
  challengeId: string;
  epoch: number;
  payoutSchedule: [Sats, Sats, Sats];
  reliabilityBonusMsats: Msats;
}

export interface RevealResult {
  responder: string;
  commitTs: number;
  revealTs: number;
  valid: boolean;
  latencyMs: number;
  reliabilityScore: number; // 0..1 rolling value from external tracker
}

export interface SettlementLine {
  responder: string;
  rank: 1 | 2 | 3;
  baseSats: Sats;
  bonusMsats: Msats;
  totalMsats: Msats;
}

export interface SettlementOutput {
  challengeId: string;
  epoch: number;
  winners: SettlementLine[];
  excluded: string[];
}
