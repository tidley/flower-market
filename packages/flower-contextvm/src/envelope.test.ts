import { describe, expect, it } from 'vitest';

import { buildSettlementEnvelope, stableStringify } from './envelope.ts';

describe('stableStringify', () => {
  it('serializes object keys in stable sorted order', () => {
    const a = { b: 2, a: 1, z: { y: 2, x: 1 } };
    const b = { z: { x: 1, y: 2 }, a: 1, b: 2 };

    expect(stableStringify(a)).toBe(stableStringify(b));
  });
});

describe('buildSettlementEnvelope', () => {
  it('returns deterministic hashes for same logical input', () => {
    const program = { name: 'flower-contextvm', version: '0.1.0' };
    const inputA = { challengeId: 'c1', epoch: 1, payout: [15, 10, 5] };
    const inputB = { payout: [15, 10, 5], epoch: 1, challengeId: 'c1' };
    const outputA = { winners: [{ responder: 'npub1', totalMsats: 16000 }] };
    const outputB = { winners: [{ totalMsats: 16000, responder: 'npub1' }] };

    const env1 = buildSettlementEnvelope(program, inputA, outputA);
    const env2 = buildSettlementEnvelope(program, inputB, outputB);

    expect(env1.programHash).toBe(env2.programHash);
    expect(env1.inputHash).toBe(env2.inputHash);
    expect(env1.outputHash).toBe(env2.outputHash);
  });

  it('changes hash when output changes', () => {
    const program = { name: 'flower-contextvm', version: '0.1.0' };
    const input = { challengeId: 'c1', epoch: 1 };
    const out1 = { winners: [{ responder: 'npub1', totalMsats: 16000 }] };
    const out2 = { winners: [{ responder: 'npub1', totalMsats: 15000 }] };

    const env1 = buildSettlementEnvelope(program, input, out1);
    const env2 = buildSettlementEnvelope(program, input, out2);

    expect(env1.outputHash).not.toBe(env2.outputHash);
  });
});
