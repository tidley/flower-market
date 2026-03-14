import { describe, expect, it } from 'vitest';

import { settleChallenge } from './settlement.ts';
import type { ChallengeInput, RevealResult } from './types.ts';

const baseInput: ChallengeInput = {
  challengeId: 'ch_001',
  epoch: 1,
  payoutSchedule: [15, 10, 5],
  reliabilityBonusMsats: 1000,
};

function makeReveal(overrides: Partial<RevealResult>): RevealResult {
  return {
    responder: 'npub_test',
    commitTs: 100,
    revealTs: 200,
    valid: true,
    latencyMs: 1000,
    reliabilityScore: 0.95,
    ...overrides,
  };
}

describe('settleChallenge', () => {
  it('selects top 3 by deterministic ordering (commitTs, revealTs, latencyMs)', () => {
    const reveals: RevealResult[] = [
      makeReveal({ responder: 'C', commitTs: 3, revealTs: 30, latencyMs: 300 }),
      makeReveal({ responder: 'A', commitTs: 1, revealTs: 40, latencyMs: 500 }),
      makeReveal({ responder: 'B', commitTs: 2, revealTs: 20, latencyMs: 100 }),
      makeReveal({ responder: 'D', commitTs: 4, revealTs: 10, latencyMs: 50 }),
    ];

    const out = settleChallenge(baseInput, reveals);

    expect(out.winners).toHaveLength(3);
    expect(out.winners[0].responder).toBe('A');
    expect(out.winners[1].responder).toBe('B');
    expect(out.winners[2].responder).toBe('C');
  });

  it('excludes invalid reveals', () => {
    const reveals: RevealResult[] = [
      makeReveal({ responder: 'valid-1', commitTs: 1 }),
      makeReveal({ responder: 'invalid-1', commitTs: 2, valid: false }),
      makeReveal({ responder: 'valid-2', commitTs: 3 }),
    ];

    const out = settleChallenge(baseInput, reveals);

    expect(out.winners.map((w) => w.responder)).toEqual(['valid-1', 'valid-2']);
    expect(out.excluded).toContain('invalid-1');
  });

  it('applies base payout schedule 15/10/5 sats', () => {
    const reveals: RevealResult[] = [
      makeReveal({ responder: 'r1', commitTs: 1 }),
      makeReveal({ responder: 'r2', commitTs: 2 }),
      makeReveal({ responder: 'r3', commitTs: 3 }),
    ];

    const out = settleChallenge(baseInput, reveals);

    expect(out.winners.map((w) => w.baseSats)).toEqual([15, 10, 5]);
  });

  it('applies reliability bonus tiers deterministically', () => {
    const reveals: RevealResult[] = [
      makeReveal({ responder: 'high', commitTs: 1, reliabilityScore: 0.95 }),
      makeReveal({ responder: 'mid', commitTs: 2, reliabilityScore: 0.9 }),
      makeReveal({ responder: 'low', commitTs: 3, reliabilityScore: 0.89 }),
    ];

    const out = settleChallenge(baseInput, reveals);

    const byResponder = Object.fromEntries(out.winners.map((w) => [w.responder, w]));

    expect(byResponder.high.bonusMsats).toBe(1000);
    expect(byResponder.mid.bonusMsats).toBe(500);
    expect(byResponder.low.bonusMsats).toBe(0);
  });

  it('computes total as base*1000 + bonus', () => {
    const reveals: RevealResult[] = [
      makeReveal({ responder: 'r1', commitTs: 1, reliabilityScore: 0.95 }), // 15_000 + 1_000
      makeReveal({ responder: 'r2', commitTs: 2, reliabilityScore: 0.9 }), // 10_000 + 500
      makeReveal({ responder: 'r3', commitTs: 3, reliabilityScore: 0.5 }), // 5_000 + 0
    ];

    const out = settleChallenge(baseInput, reveals);

    expect(out.winners[0].totalMsats).toBe(16000);
    expect(out.winners[1].totalMsats).toBe(10500);
    expect(out.winners[2].totalMsats).toBe(5000);
  });
});
