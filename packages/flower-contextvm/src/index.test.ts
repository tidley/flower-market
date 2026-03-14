import { describe, expect, it } from 'vitest';

import { buildSettlementEnvelope, hashLeaf, hashPair, settleChallenge, verifyMerkleProof } from './index.ts';

describe('index exports smoke', () => {
  it('exports core functions', () => {
    const leaf = hashLeaf('x');
    const sibling = hashLeaf('y');
    const root = hashPair(leaf, sibling);

    expect(typeof buildSettlementEnvelope).toBe('function');
    expect(typeof settleChallenge).toBe('function');
    expect(verifyMerkleProof(leaf, [{ hash: sibling, position: 'right' }], root)).toBe(true);
  });
});
