import { describe, expect, it } from 'vitest';

import vectors from '../../../spec/fixtures/v0.1/marketplace-vectors.json';
import { deriveEligibilityState, rejectDuplicateSettlement, verifyTransferProof } from './marketplace.ts';

describe('marketplace conformance', () => {
  it('valid transfer proof passes', () => {
    const v = vectors.validChain.transferProof;
    expect(
      verifyTransferProof({
        sampleLeafHash: v.sampleLeafHash,
        sampleProof: v.sampleProof,
        merkleRoot: v.merkleRoot,
      }),
    ).toBe(true);
  });

  it('invalid transfer proof fails', () => {
    const v = vectors.invalidTransferProof;
    expect(
      verifyTransferProof({
        sampleLeafHash: v.sampleLeafHash,
        sampleProof: v.sampleProof,
        merkleRoot: v.merkleRoot,
      }),
    ).toBe(false);
  });

  it('cooldown enforcement returns pending before, active after', () => {
    expect(
      deriveEligibilityState(true, true, vectors.cooldown.beforeTs, vectors.cooldown.cooldownUntil),
    ).toBe('pending');
    expect(
      deriveEligibilityState(true, true, vectors.cooldown.afterTs, vectors.cooldown.cooldownUntil),
    ).toBe('active');
  });

  it('requires payment+verification before any eligibility', () => {
    expect(deriveEligibilityState(false, true, 1, 0)).toBe('none');
    expect(deriveEligibilityState(true, false, 1, 0)).toBe('none');
  });

  it('duplicate settlement transferId is rejected', () => {
    const seen = new Set<string>();
    const id = vectors.duplicateSettlement.transferId;
    expect(rejectDuplicateSettlement(seen, id)).toBe(false);
    expect(rejectDuplicateSettlement(seen, id)).toBe(true);
  });
});
