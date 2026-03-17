import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import type { RuntimeSnapshot } from '../../../packages/flower-runtime/src/index.ts';
import { createChallenge, fetchRuntimeState, respondToChallenge } from './api';

function emptySnapshot(): RuntimeSnapshot {
  return {
    updatedAt: Date.now(),
    relayMode: 'memory',
    relayUrls: [],
    blossomBaseUrl: '',
    identities: [],
    blobs: [],
    challenges: [],
    listings: [],
  };
}

type DemoView = 'all' | 'challenger' | 'sp1' | 'sp2';

function parseView(): DemoView {
  const raw = new URLSearchParams(window.location.search).get('view');
  if (raw === 'challenger' || raw === 'sp1' || raw === 'sp2') return raw;
  return 'all';
}

function fmtTs(ts: number | null): string {
  if (!ts) return 'never';
  return new Date(ts * 1000).toISOString();
}

export function App() {
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>(emptySnapshot);
  const [status, setStatus] = useState('Connecting to daemon...');
  const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<DemoView>(parseView());
  const [autoMode, setAutoMode] = useState(false);
  const autoTimer = useRef<number | null>(null);
  const [challengeBlobId, setChallengeBlobId] = useState('');

  async function refreshState() {
    const next = await fetchRuntimeState();
    startTransition(() => {
      setSnapshot(next);
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
          payoutSchedule: [15, 10, 5],
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
  const provider = snapshot.identities.find((identity) => identity.role === 'provider');
  const provider2 = snapshot.identities.find((identity) => identity.role === 'provider2');

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

  const spRows = useMemo(() => {
    const providerNpub = provider?.npub ?? 'unknown-provider';
    const provider2Npub = provider2?.npub ?? 'unknown-provider2';
    const files = snapshot.blobs.map((b) => b.contentRef);

    const sp1Files = files.filter((_, i) => i % 2 === 0);
    const sp2Files = files.filter((_, i) => i % 2 === 1);

    return [
      {
        id: 'sp1',
        role: 'provider' as const,
        label: 'Storage Provider #1',
        npub: providerNpub,
        files: sp1Files,
        lastPaid: providerLastPaid.get(providerNpub) ?? null,
      },
      {
        id: 'sp2',
        role: 'provider2' as const,
        label: 'Storage Provider #2',
        npub: provider2Npub,
        files: sp2Files,
        lastPaid: providerLastPaid.get(provider2Npub) ?? null,
      },
    ];
  }, [snapshot.blobs, provider?.npub, provider2?.npub, providerLastPaid]);

  return (
    <div className="page-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Flower Market Demo Control</p>
          <h1>Challenger + 2x SP windows</h1>
          <p className="lede">Open this app in 3 windows with query params: <code>?view=challenger</code>, <code>?view=sp1</code>, <code>?view=sp2</code>.</p>
        </div>
        <div className="hero-card">
          <div className="stat"><span>Runtime</span><strong>{snapshot.relayMode}</strong></div>
          <div className="stat"><span>Owner npub</span><strong style={{fontSize:12}}>{owner?.npub ?? 'loading...'}</strong></div>
          <div className="stat"><span>Status</span><strong>{busy ? `Working: ${busy}` : status}</strong></div>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 16 }}>
        <h2>Window Mode</h2>
        <div className="dual">
          {(['all', 'challenger', 'sp1', 'sp2'] as DemoView[]).map((v) => (
            <button key={v} onClick={() => setView(v)} className={view === v ? 'badge' : ''}>{v}</button>
          ))}
        </div>
      </section>

      {(view === 'all' || view === 'challenger') && (
        <section className="panel" style={{ marginBottom: 16 }}>
          <h2>Challenger UI</h2>
          <p>Challenge feed can be viewed at Jumble for owner npub:</p>
          <p>
            <a href={`https://jumble.social/?npub=${encodeURIComponent(owner?.npub ?? '')}`} target="_blank" rel="noreferrer">
              Open owner feed in jumble.social
            </a>
          </p>

          <label>Blob for recurring challenge</label>
          <select value={challengeBlobId} onChange={(event) => setChallengeBlobId(event.target.value)}>
            <option value="">Select blob</option>
            {snapshot.blobs.map((blob) => (
              <option key={blob.blobId} value={blob.blobId}>{blob.blobId}</option>
            ))}
          </select>

          <div className="dual" style={{ marginTop: 12 }}>
            <button
              onClick={() => void run('manual challenge', () => createChallenge({
                blobId: challengeBlobId,
                payoutSchedule: [15, 10, 5],
                reliabilityBonusMsats: 1000,
                commitLeadSeconds: 20,
                revealLeadSeconds: 40,
              }))}
              disabled={!challengeBlobId}
            >
              Post Challenge Now
            </button>
            <button onClick={() => setAutoMode((v) => !v)} disabled={!challengeBlobId}>
              {autoMode ? 'Stop 30s Auto Challenges' : 'Start 30s Auto Challenges'}
            </button>
          </div>

          <h3 style={{ marginTop: 16 }}>Tracked Files / Replication Health</h3>
          {Array.from(challengesByBlob.entries()).map(([blob, data]) => (
            <div key={blob} className="list-row">
              <div>
                <strong>{blob}</strong>
                <p>Last checked: {fmtTs(data.lastChecked)}</p>
                <p>Responders: {Array.from(data.responders).length ? Array.from(data.responders).join(', ') : 'none yet'}</p>
              </div>
            </div>
          ))}

          <h3 style={{ marginTop: 16 }}>Recent Settlements + Ecash Receipts</h3>
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
                      <span>{r.mintUrl}</span>
                    </div>
                  ))
                )}
              </div>
            ))
          )}
        </section>
      )}

      {(view === 'all' || view === 'sp1' || view === 'sp2') && (
        <section className="workspace-grid">
          {spRows
            .filter((sp) => view === 'all' || view === sp.id)
            .map((sp) => (
              <div className="panel" key={sp.id}>
                <h2>{sp.label}</h2>
                <p><strong>npub:</strong> <code>{sp.npub}</code></p>
                <p><strong>Last paid:</strong> {fmtTs(sp.lastPaid)}</p>

                <h3>Tracked files</h3>
                {sp.files.length === 0 ? <p className="muted">No tracked files yet.</p> : (
                  sp.files.map((f) => <div key={f} className="sub-row"><span>{f}</span></div>)
                )}

                <h3 style={{ marginTop: 16 }}>Open challenges</h3>
                {snapshot.challenges.filter((c) => c.status === 'open').map((c) => (
                  <div key={c.challenge.id} className="list-row">
                    <div>
                      <strong>{c.challenge.payload.challengeId}</strong>
                      <p>{c.challenge.payload.contentRef}</p>
                    </div>
                    <button onClick={() => void run(`${sp.id} respond`, () => respondToChallenge(c.challenge.payload.challengeId, sp.role))}>
                      Respond
                    </button>
                  </div>
                ))}

                <h3 style={{ marginTop: 16 }}>Payout receipts</h3>
                {recentSettlements.flatMap((s) => s.settlement?.payload.payoutReceipts ?? []).filter((r) => r.responder === sp.npub).length === 0 ? (
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
    </div>
  );
}
