import { describe, expect, it } from 'vitest';

import envelopeVectors from '../../../spec/fixtures/v0.1/envelope-vectors.json';
import proofVectors from '../../../spec/fixtures/v0.1/proof-vectors.json';
import settlementVectors from '../../../spec/fixtures/v0.1/settlement-vectors.json';
import { buildSettlementEnvelope } from './envelope.ts';
import { settleChallenge } from './settlement.ts';
import { verifyMerkleProof } from './proof.ts';

describe('v0.1 conformance fixtures', () => {
  it('proof vectors match expected validity', () => {
    for (const v of proofVectors.vectors) {
      expect(verifyMerkleProof(v.leafHash, v.proof, v.expectedRoot), v.name).toBe(v.expected);
    }
  });

  it('settlement vectors produce expected order/totals/exclusions', () => {
    const out = settleChallenge(settlementVectors.input, settlementVectors.reveals);

    expect(out.winners.map((w) => w.responder)).toEqual(settlementVectors.expectedOrder);
    expect(out.winners.map((w) => w.totalMsats)).toEqual(settlementVectors.expectedTotalsMsats);
    expect(out.excluded).toEqual(settlementVectors.expectedExcluded);
  });

  it('envelope vectors are canonical-equivalent', () => {
    const env1 = buildSettlementEnvelope(
      envelopeVectors.programA,
      envelopeVectors.inputA,
      envelopeVectors.outputA,
    );
    const env2 = buildSettlementEnvelope(
      envelopeVectors.programB,
      envelopeVectors.inputB,
      envelopeVectors.outputB,
    );

    expect(env1.programHash).toBe(env2.programHash);
    expect(env1.inputHash).toBe(env2.inputHash);
    expect(env1.outputHash).toBe(env2.outputHash);
  });
});
