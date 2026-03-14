import { useMemo, useState } from 'react';
import {
  buildSettlementEnvelope,
  deriveEligibilityState,
  settleChallengeFromProofs,
  verifyTransferProof,
} from '../../../packages/flower-contextvm/src/index.ts';

const sampleProof = [
  { hash: '10dacdccfe877dc064d57442e6fa7a4e3085dc94e11a29819c2290fc3d788724', position: 'right' as const },
  { hash: '4723df9b2662cc29752873901fe455a877ed4b6d62dfc83539be19ca2005895b', position: 'left' as const },
];

export function App() {
  const [merkleRoot, setMerkleRoot] = useState('6d4202e491db6f2cd035eefb749748adc8ecf785504869b2d04331b34b1498dc');
  const [contentRef, setContentRef] = useState('blossom:abc123');
  const [commitDeadline, setCommitDeadline] = useState(100);
  const [revealDeadline, setRevealDeadline] = useState(200);
  const [cooldownUntil, setCooldownUntil] = useState(1710003900);
  const [nowTs, setNowTs] = useState(1710003899);

  const settlement = useMemo(() => {
    return settleChallengeFromProofs(
      {
        challengeId: 'ch_ui_1',
        epoch: 1,
        payoutSchedule: [15, 10, 5],
        reliabilityBonusMsats: 1000,
        merkleRoot,
        commitDeadline,
        revealDeadline,
      },
      [
        {
          responder: 'valid-sp',
          commitTs: 10,
          revealTs: 20,
          latencyMs: 50,
          reliabilityScore: 0.95,
          leafHash: '8a1cee436cbac1489a1883c9d886fcfc46f302c55ed4106ae31729e4f4eb9041',
          proof: sampleProof,
          expectedRoot: merkleRoot,
        },
        {
          responder: 'late-sp',
          commitTs: 300,
          revealTs: 301,
          latencyMs: 1,
          reliabilityScore: 1,
          leafHash: '8a1cee436cbac1489a1883c9d886fcfc46f302c55ed4106ae31729e4f4eb9041',
          proof: sampleProof,
          expectedRoot: merkleRoot,
        },
      ],
    );
  }, [commitDeadline, merkleRoot, revealDeadline]);

  const envelope = useMemo(
    () => buildSettlementEnvelope({ name: 'flower-contextvm', version: '0.1.0' }, { contentRef, merkleRoot }, settlement),
    [contentRef, merkleRoot, settlement],
  );

  const transferValid = verifyTransferProof({
    sampleLeafHash: '8a1cee436cbac1489a1883c9d886fcfc46f302c55ed4106ae31729e4f4eb9041',
    sampleProof,
    merkleRoot,
  });

  const eligibility = deriveEligibilityState(true, true, nowTs, cooldownUntil);

  return (
    <div className="container">
      <h1>Flower Market — Minimal UI Scaffold</h1>
      <p className="small">Owner + SP simulation using current protocol runtime.</p>

      <div className="grid">
        <div className="card">
          <h2>Owner Console</h2>
          <label>contentRef</label>
          <input value={contentRef} onChange={(e) => setContentRef(e.target.value)} />
          <label>merkleRoot</label>
          <input value={merkleRoot} onChange={(e) => setMerkleRoot(e.target.value)} />
          <div className="row">
            <div>
              <label>commitDeadline</label>
              <input type="number" value={commitDeadline} onChange={(e) => setCommitDeadline(Number(e.target.value))} />
            </div>
            <div>
              <label>revealDeadline</label>
              <input type="number" value={revealDeadline} onChange={(e) => setRevealDeadline(Number(e.target.value))} />
            </div>
          </div>
        </div>

        <div className="card">
          <h2>SP Marketplace Status</h2>
          <div className="row">
            <div>
              <label>nowTs</label>
              <input type="number" value={nowTs} onChange={(e) => setNowTs(Number(e.target.value))} />
            </div>
            <div>
              <label>cooldownUntil</label>
              <input type="number" value={cooldownUntil} onChange={(e) => setCooldownUntil(Number(e.target.value))} />
            </div>
          </div>
          <p>
            Transfer proof valid: <span className="badge">{String(transferValid)}</span>
          </p>
          <p>
            Eligibility: <span className="badge">{eligibility}</span>
          </p>
        </div>
      </div>

      <div className="card">
        <h2>Settlement Preview</h2>
        <pre>{JSON.stringify(settlement, null, 2)}</pre>
      </div>

      <div className="card">
        <h2>Deterministic Envelope</h2>
        <pre>{JSON.stringify(envelope, null, 2)}</pre>
      </div>
    </div>
  );
}
