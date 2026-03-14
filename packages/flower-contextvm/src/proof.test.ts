import { describe, expect, it } from 'vitest';

import { hashLeaf, hashPair, verifyMerkleProof } from './proof.ts';

describe('proof hashing primitives', () => {
  it('hashLeaf is deterministic for same input', () => {
    const a = hashLeaf('hello');
    const b = hashLeaf('hello');
    expect(a).toBe(b);
  });

  it('hashPair is order-sensitive', () => {
    const a = hashLeaf('a');
    const b = hashLeaf('b');
    expect(hashPair(a, b)).not.toBe(hashPair(b, a));
  });

  it('hashLeaf supports Uint8Array input', () => {
    const bytes = new TextEncoder().encode('hello');
    expect(hashLeaf(bytes)).toBe(hashLeaf('hello'));
  });

  it('hashPair throws on invalid hex length', () => {
    expect(() => hashPair('abc', '00')).toThrow('Invalid hex length');
  });
});

describe('verifyMerkleProof', () => {
  // Build a tiny binary tree with 4 leaves:
  //        root
  //      /      \
  //    n01      n23
  //   /  \      /  \
  //  l0  l1    l2  l3
  const l0 = hashLeaf('l0');
  const l1 = hashLeaf('l1');
  const l2 = hashLeaf('l2');
  const l3 = hashLeaf('l3');

  const n01 = hashPair(l0, l1);
  const n23 = hashPair(l2, l3);
  const root = hashPair(n01, n23);

  it('valid proof passes', () => {
    const proofForL2 = [
      { hash: l3, position: 'right' as const },
      { hash: n01, position: 'left' as const },
    ];

    expect(verifyMerkleProof(l2, proofForL2, root)).toBe(true);
  });

  it('wrong sibling order fails', () => {
    const badProof = [
      { hash: l3, position: 'left' as const }, // wrong side
      { hash: n01, position: 'left' as const },
    ];

    expect(verifyMerkleProof(l2, badProof, root)).toBe(false);
  });

  it('tampered leaf fails', () => {
    const proofForL2 = [
      { hash: l3, position: 'right' as const },
      { hash: n01, position: 'left' as const },
    ];

    const tamperedLeaf = hashLeaf('l2-tampered');
    expect(verifyMerkleProof(tamperedLeaf, proofForL2, root)).toBe(false);
  });

  it('wrong root fails', () => {
    const proofForL2 = [
      { hash: l3, position: 'right' as const },
      { hash: n01, position: 'left' as const },
    ];

    const wrongRoot = hashLeaf('wrong-root');
    expect(verifyMerkleProof(l2, proofForL2, wrongRoot)).toBe(false);
  });
});
