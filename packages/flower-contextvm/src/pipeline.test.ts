import { describe, expect, it } from 'vitest';

import { hashLeaf, hashPair } from './proof.ts';
import { settleChallengeFromProofs } from './pipeline.ts';

function buildTree() {
  const l0 = hashLeaf('l0');
  const l1 = hashLeaf('l1');
  const l2 = hashLeaf('l2');
  const l3 = hashLeaf('l3');
  const n01 = hashPair(l0, l1);
  const n23 = hashPair(l2, l3);
  const root = hashPair(n01, n23);
  return { l0, l1, l2, l3, n01, n23, root };
}

describe('settleChallengeFromProofs', () => {
  it('excludes invalid proofs before ranking', () => {
    const t = buildTree();
    const out = settleChallengeFromProofs(
      {
        challengeId: 'ch1',
        epoch: 1,
        payoutSchedule: [15, 10, 5],
        reliabilityBonusMsats: 1000,
        merkleRoot: t.root,
        commitDeadline: 100,
        revealDeadline: 200,
      },
      [
        {
          responder: 'bad-fast',
          commitTs: 1,
          revealTs: 2,
          latencyMs: 1,
          reliabilityScore: 1,
          leafHash: hashLeaf('tampered'),
          proof: [
            { hash: t.l3, position: 'right' as const },
            { hash: t.n01, position: 'left' as const },
          ],
          expectedRoot: t.root,
        },
        {
          responder: 'good',
          commitTs: 2,
          revealTs: 10,
          latencyMs: 40,
          reliabilityScore: 0.95,
          leafHash: t.l2,
          proof: [
            { hash: t.l3, position: 'right' as const },
            { hash: t.n01, position: 'left' as const },
          ],
          expectedRoot: t.root,
        },
      ],
    );

    expect(out.winners.map((w) => w.responder)).toEqual(['good']);
    expect(out.excluded).toContain('bad-fast');
  });

  it('rejects late commits/reveals', () => {
    const t = buildTree();
    const out = settleChallengeFromProofs(
      {
        challengeId: 'ch2',
        epoch: 1,
        payoutSchedule: [15, 10, 5],
        reliabilityBonusMsats: 1000,
        merkleRoot: t.root,
        commitDeadline: 5,
        revealDeadline: 10,
      },
      [
        {
          responder: 'late-commit',
          commitTs: 6,
          revealTs: 7,
          latencyMs: 10,
          reliabilityScore: 1,
          leafHash: t.l2,
          proof: [
            { hash: t.l3, position: 'right' as const },
            { hash: t.n01, position: 'left' as const },
          ],
          expectedRoot: t.root,
        },
        {
          responder: 'late-reveal',
          commitTs: 4,
          revealTs: 11,
          latencyMs: 10,
          reliabilityScore: 1,
          leafHash: t.l2,
          proof: [
            { hash: t.l3, position: 'right' as const },
            { hash: t.n01, position: 'left' as const },
          ],
          expectedRoot: t.root,
        },
      ],
    );

    expect(out.winners).toHaveLength(0);
    expect(out.excluded).toEqual(['late-commit', 'late-reveal']);
  });

  it('rejects expectedRoot mismatch', () => {
    const t = buildTree();
    const out = settleChallengeFromProofs(
      {
        challengeId: 'ch3',
        epoch: 1,
        payoutSchedule: [15, 10, 5],
        reliabilityBonusMsats: 1000,
        merkleRoot: t.root,
        commitDeadline: 100,
        revealDeadline: 100,
      },
      [
        {
          responder: 'wrong-root-claim',
          commitTs: 1,
          revealTs: 2,
          latencyMs: 10,
          reliabilityScore: 1,
          leafHash: t.l2,
          proof: [
            { hash: t.l3, position: 'right' as const },
            { hash: t.n01, position: 'left' as const },
          ],
          expectedRoot: hashLeaf('other-root'),
        },
      ],
    );

    expect(out.winners).toHaveLength(0);
    expect(out.excluded).toEqual(['wrong-root-claim']);
  });
});
