import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import type { RuntimeSnapshot } from '../../../packages/flower-runtime/src/index.ts';
import { createChallenge, fetchPublishedMessages, fetchRuntimeState, requestStallTransfer, respondToChallenge, uploadBlob, type PublishedMessage } from './api';

function emptySnapshot(): RuntimeSnapshot {
  return {
    updatedAt: Date.now(),
    relayMode: 'memory',
    relayUrls: [],
    blossomBaseUrl: '',
    identities: [],
    balances: [],
    blobs: [],
    challenges: [],
    listings: [],
    replicaRegistry: [],
    stallTransfers: [],
  };
}

type DemoView = 'all' | 'challenger' | 'sp1' | 'sp2' | 'sp3' | 'stall';

function parseView(): DemoView {
  const raw = new URLSearchParams(window.location.search).get('view');
  if (raw === 'challenger' || raw === 'sp1' || raw === 'sp2' || raw === 'sp3' || raw === 'stall') return raw;
  return 'all';
}

function fmtTs(ts: number | null): string {
  if (!ts) return 'never';
  return new Date(ts * 1000).toISOString();
}

function roleLabel(role: 'provider' | 'provider2' | 'provider3'): string {
  if (role === 'provider') return 'SP1';
  if (role === 'provider2') return 'SP2';
  return 'SP3';
}

function participantLabel(role: string): string {
  if (role === 'owner') return 'DO (Owner)';
  if (role === 'provider') return 'SP1';
  if (role === 'provider2') return 'SP2';
  if (role === 'provider3') return 'SP3';
  if (role === 'settler') return 'Stall';
  return role;
}

export function App() {
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>(emptySnapshot);
  const [status, setStatus] = useState('Connecting to daemon...');
  const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<DemoView>(parseView());
  const [autoMode, setAutoMode] = useState(false);
  const autoTimer = useRef<number | null>(null);
  const [challengeBlobId, setChallengeBlobId] = useState('');
  const [seedBlobId, setSeedBlobId] = useState('demo_blob');
  const [seedBlobContent, setSeedBlobContent] = useState('flower market demo payload');
  const [publishedEvents, setPublishedEvents] = useState<PublishedMessage[]>([]);
  const [stallBlobId, setStallBlobId] = useState('demo_blob');
  const [stallFromRole, setStallFromRole] = useState<'provider' | 'provider2' | 'provider3'>('provider');
  const [stallToRole, setStallToRole] = useState<'provider' | 'provider2' | 'provider3'>('provider3');
  const [supplierFeeSats, setSupplierFeeSats] = useState(5);
  const [stallFeeSats, setStallFeeSats] = useState(1);


  async function refreshState() {
    const [next, events] = await Promise.all([fetchRuntimeState(), fetchPublishedMessages()]);
    startTransition(() => {
      setSnapshot(next);
      setPublishedEvents(events.slice().sort((a, b) => b.createdAt - a.createdAt));
      setStatus(`Connected to ${next.relayMode} runtime`);
      if (!challengeBlobId && next.blobs.length > 0) {
        setChallengeBlobId(next.blobs[0].blobId);
      }
    });
  }

  useEffect(() => {
    refreshState().catch((error) => {
      setStatus(error instanceof Error ? error.message : 'Failed to connect');
    });
    const timer = setInterval(() => {
      refreshState().catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!autoMode) {
      if (autoTimer.current) window.clearInterval(autoTimer.current);
      autoTimer.current = null;
      return;
    }
    autoTimer.current = window.setInterval(() => {
      if (!challengeBlobId) return;
      void run('auto challenge', async () => {
        await createChallenge({
          blobId: challengeBlobId,
          payoutSchedule: [15, 12, 9],
          reliabilityBonusMsats: 1000,
          commitLeadSeconds: 20,
          revealLeadSeconds: 40,
        });
      });
    }, 30_000);

    return () => {
      if (autoTimer.current) window.clearInterval(autoTimer.current);
      autoTimer.current = null;
    };
  }, [autoMode, challengeBlobId]);

  async function run(label: string, task: () => Promise<unknown>) {
    setBusy(label);
    try {
      await task();
      await refreshState();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `Failed: ${label}`);
    } finally {
      setBusy(null);
    }
  }

  const owner = snapshot.identities.find((identity) => identity.role === 'owner');

  const openChallenges = useMemo(() => snapshot.challenges.filter((c) => c.status === 'open'), [snapshot.challenges]);
  const provider = snapshot.identities.find((identity) => identity.role === 'provider');
  const provider2 = snapshot.identities.find((identity) => identity.role === 'provider2');
  const provider3 = snapshot.identities.find((identity) => identity.role === 'provider3');

  const challengesByBlob = useMemo(() => {
    const out = new Map<string, { lastChecked: number | null; responders: Set<string> }>();
    for (const ch of snapshot.challenges) {
      const blob = ch.challenge.payload.contentRef;
      const current = out.get(blob) ?? { lastChecked: null, responders: new Set<string>() };
      current.lastChecked = Math.max(current.lastChecked ?? 0, ch.challenge.createdAt);
      ch.reveals.forEach((r) => current.responders.add(r.payload.responder));
      out.set(blob, current);
    }
    return out;
  }, [snapshot]);

  const providerLastPaid = useMemo(() => {
    const byResponder = new Map<string, number>();
    for (const ch of snapshot.challenges) {
      if (!ch.settlement) continue;
      for (const w of ch.settlement.payload.winners) {
        byResponder.set(w.responder, Math.max(byResponder.get(w.responder) ?? 0, ch.settlement.createdAt));
      }
    }
    return byResponder;
  }, [snapshot]);

  const recentSettlements = useMemo(() => {
    return snapshot.challenges
      .filter((c) => Boolean(c.settlement))
      .slice()
      .sort((a, b) => (b.settlement?.createdAt ?? 0) - (a.settlement?.createdAt ?? 0))
      .slice(0, 6);
  }, [snapshot.challenges]);

  const latestRound = recentSettlements[0] ?? null;

  const spRows = useMemo(() => {
    const providerNpub = provider?.npub ?? 'unknown-provider';
    const provider2Npub = provider2?.npub ?? 'unknown-provider2';
    const provider3Npub = provider3?.npub ?? 'unknown-provider3';

    const filesForRole = (role: 'provider' | 'provider2' | 'provider3') =>
      snapshot.replicaRegistry
        .filter((entry) => Boolean(entry.rootsByProvider[role]))
        .map((entry) => entry.cid);

    return [
      {
        id: 'sp1',
        role: 'provider' as const,
        label: 'Storage Provider #1',
        npub: providerNpub,
        files: filesForRole('provider'),
        lastPaid: providerLastPaid.get(providerNpub) ?? null,
      },
      {
        id: 'sp2',
        role: 'provider2' as const,
        label: 'Storage Provider #2',
        npub: provider2Npub,
        files: filesForRole('provider2'),
        lastPaid: providerLastPaid.get(provider2Npub) ?? null,
      },
      {
        id: 'sp3',
        role: 'provider3' as const,
        label: 'Storage Provider #3',
        npub: provider3Npub,
        files: filesForRole('provider3'),
        lastPaid: providerLastPaid.get(provider3Npub) ?? null,
      },
    ];
  }, [snapshot.replicaRegistry, provider?.npub, provider2?.npub, provider3?.npub, providerLastPaid]);

  return (
    <div className="page-shell">
      <section className="hero">
        <div>
          <h1>Flower Market</h1>
          <p>
            Quick links:{' '}
            <a href="/?view=challenger" target="_blank" rel="noreferrer">
              Challenger
            </a>
            {' • '}
            <a href="/?view=sp1" target="_blank" rel="noreferrer">
              SP1
            </a>
            {' • '}
            <a href="/?view=sp2" target="_blank" rel="noreferrer">
              SP2
            </a>
            {' • '}
            <a href="/?view=sp3" target="_blank" rel="noreferrer">
              SP3
            </a>
            {' • '}
            <a href="/?view=stall" target="_blank" rel="noreferrer">
              Stall
            </a>
          </p>
        </div>
        <div className="hero-card">
          <div className="stat">
            <span>Runtime</span>
            <strong>{snapshot.relayMode}</strong>
          </div>
          <div className="stat">
            <span>Owner npub</span>
            <strong style={{ fontSize: 12 }}>{owner?.npub ?? 'loading...'}</strong>
          </div>
          <div className="stat">
            <span>Status</span>
            <strong>{busy ? `Working: ${busy}` : status}</strong>
          </div>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 16 }}>
        <h2>Window Mode</h2>
        <div className="dual">
          {(['all', 'challenger', 'sp1', 'sp2', 'sp3', 'stall'] as DemoView[]).map((v) => (
            <button key={v} onClick={() => setView(v)} className={view === v ? 'badge' : ''}>
              {v}
            </button>
          ))}
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 16 }}>
        <h2>Participant Balances</h2>
        {snapshot.balances.map((b) => (
          <div key={b.role} className="sub-row">
            <span>{participantLabel(b.role)}</span>
            <span>{Math.round(b.balanceMsats / 1000)} sats</span>
            <span className="muted">
              funded {Math.round(b.fundedMsats / 1000)} / in {Math.round(b.incomingMsats / 1000)} /
              out {Math.round(b.outgoingMsats / 1000)}
            </span>
          </div>
        ))}
      </section>

      {(view === 'all' || view === 'challenger') && (
        <section className="panel" style={{ marginBottom: 16 }}>
          <h2>Challenger UI</h2>
          <p>Challenge feed can be viewed at Jumble for owner npub:</p>
          <p>
            <a
              href={`https://jumble.social/users/${encodeURIComponent(owner?.npub ?? '')}`}
              target="_blank"
              rel="noreferrer"
            >
              Open owner feed in jumble.social
            </a>
          </p>

          <h3>Lightning Balances (NWC)</h3>
          {snapshot.balances
            .filter((b) => b.role !== 'settler')
            .map((b) => (
              <div key={b.role} className="sub-row">
                <span>{b.role}</span>
                <span>{Math.round(b.balanceMsats / 1000)} sats</span>
                <span className="muted">
                  funded {Math.round(b.fundedMsats / 1000)} / in{' '}
                  {Math.round(b.incomingMsats / 1000)} / out {Math.round(b.outgoingMsats / 1000)}
                </span>
              </div>
            ))}

          <h3>Quick Seed Blob</h3>
          <label>Seed Blob Id</label>
          <input value={seedBlobId} onChange={(event) => setSeedBlobId(event.target.value)} />
          <label>Seed Blob Content</label>
          <textarea
            value={seedBlobContent}
            onChange={(event) => setSeedBlobContent(event.target.value)}
            rows={3}
          />
          <div className="dual" style={{ marginTop: 12 }}>
            <button
              onClick={() =>
                void run('seed blob', async () => {
                  await uploadBlob(seedBlobId, seedBlobContent);
                  setChallengeBlobId(seedBlobId);
                })
              }
              disabled={!seedBlobId || !seedBlobContent}
            >
              Seed Blob
            </button>
          </div>

          <label>Blob for recurring challenge</label>
          <select
            value={challengeBlobId}
            onChange={(event) => setChallengeBlobId(event.target.value)}
          >
            <option value="">Select blob</option>
            {snapshot.blobs.map((blob) => (
              <option key={blob.blobId} value={blob.blobId}>
                {blob.blobId}
              </option>
            ))}
          </select>

          <div className="dual" style={{ marginTop: 12 }}>
            <button
              onClick={() =>
                void run('manual challenge', () =>
                  createChallenge({
                    blobId: challengeBlobId,
                    payoutSchedule: [15, 12, 9],
                    reliabilityBonusMsats: 1000,
                    commitLeadSeconds: 20,
                    revealLeadSeconds: 40,
                  }),
                )
              }
              disabled={!challengeBlobId}
            >
              Post Challenge Now
            </button>
            <button onClick={() => setAutoMode((v) => !v)} disabled={!challengeBlobId}>
              {autoMode ? 'Stop 30s Auto Challenges' : 'Start 30s Auto Challenges'}
            </button>
          </div>

          <h3 style={{ marginTop: 16 }}>One-click scenarios</h3>
          <div className="dual">
            <button
              onClick={() =>
                void run('scenario: seed + replicate to SP3', async () => {
                  await uploadBlob(seedBlobId, seedBlobContent);
                  await requestStallTransfer({
                    blobId: seedBlobId,
                    fromRole: 'provider',
                    toRole: 'provider3',
                    supplierFeeSats: 5,
                    stallFeeSats: 1,
                  });
                  setChallengeBlobId(seedBlobId);
                  setStallBlobId(seedBlobId);
                })
              }
            >
              Scenario A: Seed + Replicate SP1→SP3
            </button>
            <button
              onClick={() =>
                void run('scenario: run 3 rounds', async () => {
                  for (let i = 0; i < 3; i += 1) {
                    await createChallenge({
                      blobId: challengeBlobId || seedBlobId,
                      payoutSchedule: [15, 12, 9],
                      reliabilityBonusMsats: 1000,
                      commitLeadSeconds: 20,
                      revealLeadSeconds: 40,
                    });
                  }
                })
              }
              disabled={!(challengeBlobId || seedBlobId)}
            >
              Scenario B: Run 3 Challenge Rounds
            </button>
          </div>

          <h3 style={{ marginTop: 16 }}>Inter-SP Data Market (Market Stall)</h3>
          <label>Blob</label>
          <select value={stallBlobId} onChange={(event) => setStallBlobId(event.target.value)}>
            <option value="">Select blob</option>
            {snapshot.blobs.map((blob) => (
              <option key={blob.blobId} value={blob.blobId}>
                {blob.blobId}
              </option>
            ))}
          </select>
          <div className="dual" style={{ marginTop: 8 }}>
            <div>
              <label>From SP</label>
              <select
                value={stallFromRole}
                onChange={(event) =>
                  setStallFromRole(event.target.value as 'provider' | 'provider2' | 'provider3')
                }
              >
                <option value="provider">SP1</option>
                <option value="provider2">SP2</option>
                <option value="provider3">SP3</option>
              </select>
            </div>
            <div>
              <label>To SP</label>
              <select
                value={stallToRole}
                onChange={(event) =>
                  setStallToRole(event.target.value as 'provider' | 'provider2' | 'provider3')
                }
              >
                <option value="provider">SP1</option>
                <option value="provider2">SP2</option>
                <option value="provider3">SP3</option>
              </select>
            </div>
          </div>
          <div className="dual" style={{ marginTop: 8 }}>
            <div>
              <label>Supplier fee (sats)</label>
              <input
                type="number"
                value={supplierFeeSats}
                min={0}
                onChange={(event) => setSupplierFeeSats(Number(event.target.value))}
              />
            </div>
            <div>
              <label>Stall fee (sats)</label>
              <input
                type="number"
                value={stallFeeSats}
                min={0}
                onChange={(event) => setStallFeeSats(Number(event.target.value))}
              />
            </div>
          </div>
          <button
            style={{ marginTop: 8 }}
            onClick={() =>
              void run('stall transfer', () =>
                requestStallTransfer({
                  blobId: stallBlobId,
                  fromRole: stallFromRole,
                  toRole: stallToRole,
                  supplierFeeSats,
                  stallFeeSats,
                }),
              )
            }
            disabled={!stallBlobId || stallFromRole === stallToRole}
          >
            Request Transfer via Stall
          </button>

          <h3 style={{ marginTop: 16 }}>Replica Registry (CID → SP roots)</h3>
          {snapshot.replicaRegistry.length === 0 ? (
            <p className="muted">No replica roots yet.</p>
          ) : (
            snapshot.replicaRegistry.map((entry) => (
              <div key={entry.cid} className="result-card">
                <div className="sub-row">
                  <span>CID</span>
                  <code>{entry.cid}</code>
                </div>
                {Object.entries(entry.rootsByProvider).map(([sp, root]) => (
                  <div key={`${entry.cid}-${sp}`} className="sub-row">
                    <span>{sp}</span>
                    <code>{root.slice(0, 24)}…</code>
                  </div>
                ))}
              </div>
            ))
          )}

          <h3 style={{ marginTop: 16 }}>Market Stall Transfer Receipts</h3>
          {snapshot.stallTransfers.length === 0 ? (
            <p className="muted">No inter-SP transfers yet.</p>
          ) : (
            snapshot.stallTransfers.slice(0, 8).map((receipt) => (
              <div key={receipt.transferId} className="result-card">
                <div className="result-head">
                  <strong>{receipt.transferId}</strong>
                  <span className="badge">
                    {receipt.fromRole} → {receipt.toRole}
                  </span>
                </div>
                <div className="sub-row">
                  <span>CID</span>
                  <code>{receipt.cid}</code>
                </div>
                <div className="sub-row">
                  <span>Supplier fee</span>
                  <span>{Math.round(receipt.supplierFeeMsats / 1000)} sats</span>
                </div>
                <div className="sub-row">
                  <span>Stall fee</span>
                  <span>{Math.round(receipt.stallFeeMsats / 1000)} sats</span>
                </div>
                <div className="sub-row">
                  <span>Time</span>
                  <span>{fmtTs(receipt.createdAt)}</span>
                </div>
              </div>
            ))
          )}

          <h3 style={{ marginTop: 16 }}>Tracked Files / Replication Health</h3>
          {Array.from(challengesByBlob.entries()).map(([blob, data]) => (
            <div key={blob} className="list-row">
              <div>
                <strong>{blob}</strong>
                <p>Last checked: {fmtTs(data.lastChecked)}</p>
                <p>
                  Responders:{' '}
                  {Array.from(data.responders).length
                    ? Array.from(data.responders).join(', ')
                    : 'none yet'}
                </p>
              </div>
            </div>
          ))}

          <h3 style={{ marginTop: 16 }}>Round Timeline</h3>
          {snapshot.challenges
            .slice()
            .sort((a, b) => b.challenge.createdAt - a.challenge.createdAt)
            .slice(0, 8)
            .map((entry) => (
              <div key={`${entry.challenge.id}-timeline`} className="result-card">
                <div className="result-head">
                  <strong>{entry.challenge.payload.challengeId}</strong>
                  <span className="badge">leaf #{entry.challenge.payload.leafIndex}</span>
                </div>
                <div className="sub-row">
                  <span>Challenge posted</span>
                  <span>{fmtTs(entry.challenge.createdAt)}</span>
                </div>
                <div className="sub-row">
                  <span>Commits</span>
                  <span>{entry.commits.length}</span>
                </div>
                <div className="sub-row">
                  <span>Reveals</span>
                  <span>{entry.reveals.length}</span>
                </div>
                <div className="sub-row">
                  <span>Settlement</span>
                  <span>{entry.settlement ? fmtTs(entry.settlement.createdAt) : 'pending'}</span>
                </div>
              </div>
            ))}

          <h3 style={{ marginTop: 16 }}>Live Ranking (latest settled round)</h3>
          {!latestRound?.settlement ? (
            <p className="muted">No settled rounds yet.</p>
          ) : (
            <div className="result-card">
              <div className="result-head">
                <strong>{latestRound.challenge.payload.challengeId}</strong>
                <span className="badge">latest</span>
              </div>
              {(latestRound.settlement.payload.winners ?? []).map((winner) => {
                const receipt = (latestRound.settlement?.payload.payoutReceipts ?? []).find(
                  (r) => r.responder === winner.responder,
                );
                return (
                  <div key={`${latestRound.challenge.id}-${winner.responder}`} className="sub-row">
                    <span>
                      #{winner.rank} {winner.responder.slice(0, 12)}…
                    </span>
                    <span>
                      {winner.baseSats} sats (+{winner.bonusMsats} msat bonus)
                    </span>
                    <span>
                      {receipt
                        ? `${Math.round(receipt.amountMsats / 1000)} sats paid`
                        : 'pending payout'}
                    </span>
                  </div>
                );
              })}
              {(latestRound.settlement.payload.excluded ?? []).length > 0 && (
                <p className="muted">
                  Excluded: {(latestRound.settlement.payload.excluded ?? []).join(', ')}
                </p>
              )}
            </div>
          )}

          <h3 style={{ marginTop: 16 }}>Recent Settlements + Payout Receipts</h3>
          {recentSettlements.length === 0 ? (
            <p className="muted">No settlements yet.</p>
          ) : (
            recentSettlements.map((entry) => (
              <div key={entry.challenge.id} className="result-card">
                <div className="result-head">
                  <strong>{entry.challenge.payload.challengeId}</strong>
                  <span className="badge">settled</span>
                </div>
                {(entry.settlement?.payload.payoutReceipts ?? []).length === 0 ? (
                  <p className="muted">No payout receipts emitted.</p>
                ) : (
                  (entry.settlement?.payload.payoutReceipts ?? []).map((r) => (
                    <div key={r.payoutId} className="sub-row">
                      <span>{r.responder.slice(0, 16)}…</span>
                      <span>{r.amountMsats} msat</span>
                      <span>{r.tokenRef}</span>
                    </div>
                  ))
                )}
              </div>
            ))
          )}

          <h3 style={{ marginTop: 16 }}>Published Messages</h3>
          {publishedEvents.length === 0 ? (
            <p className="muted">No published Flower messages yet.</p>
          ) : (
            publishedEvents.slice(0, 30).map((event) => {
              const tagMap = new Map(event.tags.map((t) => [t[0], t[1]]));
              const eventType =
                tagMap.get('f') ?? (tagMap.get('t') === 'proof-reply' ? 'proof-reply' : 'note');
              return (
                <div key={event.id} className="result-card">
                  <div className="result-head">
                    <strong>{eventType}</strong>
                    <span className="badge">kind {event.kind}</span>
                  </div>
                  <div className="sub-row">
                    <span>id</span>
                    <code>{event.id}</code>
                  </div>
                  <div className="sub-row">
                    <span>time</span>
                    <span>{fmtTs(event.createdAt)}</span>
                  </div>
                  <div className="sub-row">
                    <span>author</span>
                    <code>{event.pubkey.slice(0, 16)}…</code>
                  </div>
                  <div className="sub-row">
                    <span>content</span>
                    <code className="content-wrap">{event.content}</code>
                  </div>
                </div>
              );
            })
          )}
        </section>
      )}

      {(view === 'all' || view === 'sp1' || view === 'sp2' || view === 'sp3') && (
        <section className="workspace-grid">
          {spRows
            .filter((sp) => view === 'all' || view === sp.id)
            .map((sp) => (
              <div className="panel" key={sp.id}>
                <h2>{sp.label}</h2>
                <p>
                  <strong>npub:</strong> <code>{sp.npub}</code>
                </p>
                <p>
                  <strong>Last paid:</strong> {fmtTs(sp.lastPaid)}
                </p>

                <h3>Tracked files</h3>
                {sp.files.length === 0 ? (
                  <p className="muted">No tracked files yet.</p>
                ) : (
                  sp.files.map((f) => (
                    <div key={f} className="sub-row">
                      <span>{f}</span>
                    </div>
                  ))
                )}

                <h3 style={{ marginTop: 16 }}>Open challenges</h3>
                {openChallenges.map((c) => (
                  <div key={c.challenge.id} className="list-row">
                    <div>
                      <strong>{c.challenge.payload.challengeId}</strong>
                      <p>{c.challenge.payload.contentRef}</p>
                    </div>
                    <button
                      onClick={() =>
                        void run(`${sp.id} respond`, () =>
                          respondToChallenge(c.challenge.payload.challengeId, sp.role),
                        )
                      }
                    >
                      Respond
                    </button>
                  </div>
                ))}

                <h3 style={{ marginTop: 16 }}>Payout receipts</h3>
                {recentSettlements
                  .flatMap((s) => s.settlement?.payload.payoutReceipts ?? [])
                  .filter((r) => r.responder === sp.npub).length === 0 ? (
                  <p className="muted">No payouts for this SP yet.</p>
                ) : (
                  recentSettlements
                    .flatMap((s) => s.settlement?.payload.payoutReceipts ?? [])
                    .filter((r) => r.responder === sp.npub)
                    .map((r) => (
                      <div key={r.payoutId} className="sub-row">
                        <span>{r.amountMsats} msat</span>
                        <span>{r.mintUrl}</span>
                      </div>
                    ))
                )}
              </div>
            ))}
        </section>
      )}

      {(view === 'all' || view === 'stall') && (
        <section className="panel" style={{ marginTop: 16 }}>
          <h2>Stall View</h2>
          <p className="muted">
            Stall routes DO uploads/replication and re-encrypts data between SPs. Transfers below
            show source and target SP for each CID.
          </p>

          <h3>Re-encryption / Transfer log</h3>
          {snapshot.stallTransfers.length === 0 ? (
            <p className="muted">No stall transfers yet.</p>
          ) : (
            snapshot.stallTransfers.map((receipt) => (
              <div key={`stall-${receipt.transferId}`} className="result-card">
                <div className="result-head">
                  <strong>{receipt.transferId}</strong>
                  <span className="badge">
                    {roleLabel(receipt.fromRole)} → {roleLabel(receipt.toRole)}
                  </span>
                </div>
                <div className="sub-row">
                  <span>CID</span>
                  <code>{receipt.cid}</code>
                </div>
                <div className="sub-row">
                  <span>Blob</span>
                  <span>{receipt.blobId}</span>
                </div>
                <div className="sub-row">
                  <span>Requester</span>
                  <code>{receipt.requester.slice(0, 16)}…</code>
                </div>
                <div className="sub-row">
                  <span>Supplier</span>
                  <code>{receipt.supplier.slice(0, 16)}…</code>
                </div>
                <div className="sub-row">
                  <span>Supplier fee</span>
                  <span>{Math.round(receipt.supplierFeeMsats / 1000)} sats</span>
                </div>
                <div className="sub-row">
                  <span>Stall fee</span>
                  <span>{Math.round(receipt.stallFeeMsats / 1000)} sats</span>
                </div>
                <div className="sub-row">
                  <span>Time</span>
                  <span>{fmtTs(receipt.createdAt)}</span>
                </div>
              </div>
            ))
          )}

          <h3 style={{ marginTop: 16 }}>CID coverage by SP</h3>
          {snapshot.replicaRegistry.length === 0 ? (
            <p className="muted">No replicas registered yet.</p>
          ) : (
            snapshot.replicaRegistry.map((entry) => {
              const blobName =
                snapshot.blobs.find((blob) => blob.contentRef === entry.cid)?.blobId ?? 'unknown';
              return (
                <div key={`stall-repl-${entry.cid}`} className="result-card">
                  <div className="sub-row">
                    <span>Blob</span>
                    <span>{blobName}</span>
                  </div>
                  <div className="sub-row">
                    <span>CID</span>
                    <code>{entry.cid}</code>
                  </div>
                  <div className="sub-row">
                    <span>SP1</span>
                    <span>{entry.rootsByProvider.provider ? 'yes' : 'no'}</span>
                  </div>
                  <div className="sub-row">
                    <span>SP2</span>
                    <span>{entry.rootsByProvider.provider2 ? 'yes' : 'no'}</span>
                  </div>
                  <div className="sub-row">
                    <span>SP3</span>
                    <span>{entry.rootsByProvider.provider3 ? 'yes' : 'no'}</span>
                  </div>
                </div>
              );
            })
          )}
        </section>
      )}
    </div>
  );
}
