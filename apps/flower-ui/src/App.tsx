import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import type { RetrievedBlobView, RuntimeSnapshot } from '../../../packages/flower-runtime/src/index.ts';
import { createChallenge, fetchPublishedMessages, fetchRuntimeState, requestStallTransfer, respondToChallenge, retrieveBlob, uploadBlob, type PublishedMessage } from './api';

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
  return new Date(ts * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && value >= 1024; i += 1) {
    value /= 1024;
    unit = units[i];
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

function estimateContentBytes(content: string, encoding?: 'utf8' | 'base64'): number {
  if (encoding === 'base64') {
    const clean = content.replace(/\s+/g, '');
    const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
  }
  return new TextEncoder().encode(content).length;
}

function parseExcluded(entry: string): { responder: string; reason: string } {
  const payoutPrefix = 'payout_failed:';
  if (entry.startsWith(payoutPrefix)) {
    const rest = entry.slice(payoutPrefix.length);
    const idx = rest.indexOf(':');
    if (idx >= 0) {
      return { responder: rest.slice(0, idx), reason: `payout_failed (${rest.slice(idx + 1)})` };
    }
    return { responder: rest, reason: 'payout_failed' };
  }

  const idx = entry.indexOf(':');
  if (idx >= 0) {
    return { responder: entry.slice(0, idx), reason: entry.slice(idx + 1) };
  }

  return { responder: entry, reason: 'excluded' };
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

function shortId(value: string, keep = 10): string {
  if (!value) return value;
  if (value.length <= keep * 2 + 1) return value;
  return `${value.slice(0, keep)}…${value.slice(-keep)}`;
}

function roleName(role: string): string {
  if (role === 'provider') return 'SP1';
  if (role === 'provider2') return 'SP2';
  if (role === 'provider3') return 'SP3';
  return role;
}

export function App() {
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>(emptySnapshot);
  const [status, setStatus] = useState('Connecting to daemon...');
  const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<DemoView>(parseView());
  const [autoMode, setAutoMode] = useState(false);
  const [autoLibraryMode, setAutoLibraryMode] = useState(false);
  const autoTimer = useRef<number | null>(null);
  const autoLibraryTimer = useRef<number | null>(null);
  const [challengeBlobId, setChallengeBlobId] = useState('');
  const [seedBlobId, setSeedBlobId] = useState('demo_blob');
  const [seedBlobContent, setSeedBlobContent] = useState('flower market demo payload');
  const [seedFile, setSeedFile] = useState<{
    name: string;
    mimeType: string;
    base64: string;
  } | null>(null);
  const [publishedEvents, setPublishedEvents] = useState<PublishedMessage[]>([]);
  const [stallBlobId, setStallBlobId] = useState('demo_blob');
  const [stallFromRole, setStallFromRole] = useState<'provider' | 'provider2' | 'provider3'>('provider');
  const [stallToRole, setStallToRole] = useState<'provider' | 'provider2' | 'provider3'>('provider3');
  const [retrieveFromRole, setRetrieveFromRole] = useState<'provider' | 'provider2' | 'provider3'>('provider');
  const [supplierFeeSats, setSupplierFeeSats] = useState(5);
  const [stallFeeSats, setStallFeeSats] = useState(1);
  const [rewardSchedule, setRewardSchedule] = useState<[number, number, number]>([15, 12, 9]);
  const [reliabilityBonusMsats, setReliabilityBonusMsats] = useState(1000);
  const [retrievedBlob, setRetrievedBlob] = useState<RetrievedBlobView | null>(null);
  const [seedNotice, setSeedNotice] = useState<string | null>(null);


  async function refreshState() {
    const [next, events] = await Promise.all([fetchRuntimeState(), fetchPublishedMessages()]);
    startTransition(() => {
      setSnapshot(next);
      setPublishedEvents(events.slice().sort((a, b) => b.createdAt - a.createdAt));
      setStatus(`Connected to ${next.relayMode} runtime`);
      setChallengeBlobId((prev) => {
        if (next.blobs.length === 0) return '';
        if (prev && next.blobs.some((blob) => blob.blobId === prev)) return prev;
        return next.blobs[0].blobId;
      });
      setStallBlobId((prev) => {
        if (next.blobs.length === 0) return '';
        if (prev && next.blobs.some((blob) => blob.blobId === prev)) return prev;
        return next.blobs[0].blobId;
      });
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
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest('button');
      if (!button || (button as HTMLButtonElement).disabled) return;
      button.classList.add('click-flash');
      window.setTimeout(() => button.classList.remove('click-flash'), 1800);
    };

    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
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
          payoutSchedule: rewardSchedule,
          reliabilityBonusMsats,
          commitLeadSeconds: 20,
          revealLeadSeconds: 40,
        });
      });
    }, 30_000);

    return () => {
      if (autoTimer.current) window.clearInterval(autoTimer.current);
      autoTimer.current = null;
    };
  }, [autoMode, challengeBlobId, rewardSchedule, reliabilityBonusMsats]);

  useEffect(() => {
    if (!autoLibraryMode) {
      if (autoLibraryTimer.current) window.clearInterval(autoLibraryTimer.current);
      autoLibraryTimer.current = null;
      return;
    }

    autoLibraryTimer.current = window.setInterval(() => {
      if (snapshot.blobs.length === 0) return;
      const randomBlob = snapshot.blobs[Math.floor(Math.random() * snapshot.blobs.length)];
      if (!randomBlob) return;
      void run('auto library challenge', async () => {
        await createChallenge({
          blobId: randomBlob.blobId,
          payoutSchedule: rewardSchedule,
          reliabilityBonusMsats,
          commitLeadSeconds: 20,
          revealLeadSeconds: 40,
        });
      });
    }, 30_000);

    return () => {
      if (autoLibraryTimer.current) window.clearInterval(autoLibraryTimer.current);
      autoLibraryTimer.current = null;
    };
  }, [autoLibraryMode, snapshot.blobs, rewardSchedule, reliabilityBonusMsats]);

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

  async function onSeedFileSelected(file: File | null) {
    if (!file) {
      setSeedFile(null);
      return;
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });

    const idx = dataUrl.indexOf(',');
    if (idx < 0) throw new Error('Failed to parse selected file payload');

    setSeedFile({
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      base64: dataUrl.slice(idx + 1),
    });
  }

  function downloadRetrievedBlob() {
    if (!retrievedBlob) return;

    if (retrievedBlob.encoding === 'base64') {
      const binary = atob(retrievedBlob.plaintextPayload);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      const blob = new Blob([bytes], { type: retrievedBlob.mimeType || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = retrievedBlob.fileName || `${retrievedBlob.blobId}.bin`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return;
    }

    const blob = new Blob([retrievedBlob.plaintextPayload], { type: retrievedBlob.mimeType || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = retrievedBlob.fileName || `${retrievedBlob.blobId}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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

  const blobNameByContentRef = useMemo(() => {
    const map = new Map<string, string>();
    snapshot.blobs.forEach((blob) => {
      if (!map.has(blob.contentRef)) {
        map.set(blob.contentRef, blob.blobId);
      }
    });
    return map;
  }, [snapshot.blobs]);

  const blobSizeByContentRef = useMemo(() => {
    const map = new Map<string, number>();
    snapshot.blobs.forEach((blob) => {
      if (!map.has(blob.contentRef)) {
        map.set(blob.contentRef, estimateContentBytes(blob.content, blob.encoding));
      }
    });
    return map;
  }, [snapshot.blobs]);

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

  const balanceView = useMemo(() => {
    const toRow = (role: string) => {
      const b = snapshot.balances.find((entry) => entry.role === role);
      if (!b) return null;
      const balance = Math.round(b.balanceMsats / 1000);
      const activity = {
        funded: Math.round(b.fundedMsats / 1000),
        in: Math.round(b.incomingMsats / 1000),
        out: Math.round(b.outgoingMsats / 1000),
      };
      return { role, label: participantLabel(role), balance, activity };
    };

    const owner = toRow('owner');
    const providers = ['provider', 'provider2', 'provider3']
      .map((role) => toRow(role))
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
    const stall = toRow('settler');

    const maxBalance = Math.max(0, owner?.balance ?? 0, stall?.balance ?? 0, ...providers.map((row) => row.balance));

    return {
      owner,
      providers,
      stall,
      maxBalance,
    };
  }, [snapshot.balances]);

  const summary = useMemo(() => {
    const totalSats = snapshot.balances.reduce((acc, b) => acc + Math.round(b.balanceMsats / 1000), 0);
    const latest = snapshot.challenges.slice().sort((a, b) => b.challenge.createdAt - a.challenge.createdAt)[0] ?? null;
    const latestStatus = latest?.settlement ? 'settled' : latest ? 'open' : 'no-rounds';
    const activeProviders = ['provider', 'provider2', 'provider3'].filter((role) =>
      snapshot.replicaRegistry.some((entry) => Boolean(entry.rootsByProvider[role])),
    ).length;
    return {
      totalSats,
      latestStatus,
      openChallenges: openChallenges.length,
      activeProviders,
      transferCount: snapshot.stallTransfers.length,
    };
  }, [snapshot, openChallenges.length]);

  const spRows = useMemo(() => {
    const providerNpub = provider?.npub ?? 'unknown-provider';
    const provider2Npub = provider2?.npub ?? 'unknown-provider2';
    const provider3Npub = provider3?.npub ?? 'unknown-provider3';

    const filesForRole = (role: 'provider' | 'provider2' | 'provider3') =>
      snapshot.replicaRegistry
        .filter((entry) => Boolean(entry.rootsByProvider[role]))
        .map((entry) => ({
          cid: entry.cid,
          storedCid: entry.storedCidByProvider?.[role] ?? entry.cid,
          providerRoot: entry.rootsByProvider[role],
        }));

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
          <p className="lede">Control surface for DO, providers, stall transfers, and challenge rounds.</p>
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
            <strong style={{ fontSize: 12 }}>{owner?.npub ? shortId(owner.npub, 12) : 'loading...'}</strong>
          </div>
          <div className="stat">
            <span>Status</span>
            <strong>{busy ? `Working: ${busy}` : status}</strong>
          </div>
        </div>
      </section>

      <section className="summary-grid" style={{ marginBottom: 16 }}>
        <div className="summary-card"><span>Latest round</span><strong className={`chip ${summary.latestStatus}`}>{summary.latestStatus}</strong></div>
        <div className="summary-card"><span>Open challenges</span><strong>{summary.openChallenges}</strong></div>
        <div className="summary-card"><span>Active providers</span><strong>{summary.activeProviders}/3</strong></div>
        <div className="summary-card"><span>Total sats</span><strong>{summary.totalSats}</strong></div>
        <div className="summary-card"><span>Stall transfers</span><strong>{summary.transferCount}</strong></div>
      </section>

      <section className="panel" style={{ marginBottom: 16 }}>
        <h2>Window Mode</h2>
        <div className="view-pills">
          {(['all', 'challenger', 'sp1', 'sp2', 'sp3', 'stall'] as DemoView[]).map((v) => (
            <button key={v} onClick={() => setView(v)} className={view === v ? 'badge' : ''}>
              {v}
            </button>
          ))}
        </div>
      </section>

      <section className="panel balance-panel" style={{ marginBottom: 16 }}>
        <h2>Participant Balances</h2>
        <div className="balance-table-head">
          <span>Participant</span>
          <span>Balance (sats)</span>
          <span>Bar</span>
          <span>Activity</span>
        </div>

        {balanceView.owner && (
          <div className="balance-row owner-row" key={balanceView.owner.role}>
            <span className="participant">{balanceView.owner.label}</span>
            <span className="balance-num">{balanceView.owner.balance}</span>
            <span className="bar-cell">
              <span className="bar-track">
                <span
                  className="bar-fill"
                  style={{ width: `${balanceView.maxBalance > 0 ? (balanceView.owner.balance / balanceView.maxBalance) * 100 : 0}%` }}
                />
              </span>
            </span>
            <span className="activity">
              {balanceView.owner.activity.funded === 0 && balanceView.owner.activity.in === 0 && balanceView.owner.activity.out === 0
                ? '—'
                : `F${balanceView.owner.activity.funded} I${balanceView.owner.activity.in} O${balanceView.owner.activity.out}`}
            </span>
          </div>
        )}

        <p className="balance-section">• Storage Providers</p>
        {balanceView.providers.map((row) => (
          <div className="balance-row" key={row.role}>
            <span className="participant">{row.label}</span>
            <span className="balance-num">{row.balance}</span>
            <span className="bar-cell">
              <span className="bar-track">
                <span
                  className="bar-fill"
                  style={{ width: `${balanceView.maxBalance > 0 ? (row.balance / balanceView.maxBalance) * 100 : 0}%` }}
                />
              </span>
            </span>
            <span className="activity">
              {row.activity.funded === 0 && row.activity.in === 0 && row.activity.out === 0
                ? '—'
                : `F${row.activity.funded} I${row.activity.in} O${row.activity.out}`}
            </span>
          </div>
        ))}

        <p className="balance-section">• Stall</p>
        {balanceView.stall && (
          <div className="balance-row" key={balanceView.stall.role}>
            <span className="participant">{balanceView.stall.label}</span>
            <span className="balance-num">{balanceView.stall.balance}</span>
            <span className="bar-cell">
              <span className="bar-track">
                <span
                  className="bar-fill"
                  style={{ width: `${balanceView.maxBalance > 0 ? (balanceView.stall.balance / balanceView.maxBalance) * 100 : 0}%` }}
                />
              </span>
            </span>
            <span className="activity">
              {balanceView.stall.activity.funded === 0 && balanceView.stall.activity.in === 0 && balanceView.stall.activity.out === 0
                ? '—'
                : `F${balanceView.stall.activity.funded} I${balanceView.stall.activity.in} O${balanceView.stall.activity.out}`}
            </span>
          </div>
        )}
      </section>

      {(view === 'all' || view === 'challenger') && (
        <section className="panel" style={{ marginBottom: 16 }}>
          <h2>Challenger UI</h2>
          <p>Challenge feed can be viewed via Alphaama for owner pubkey:</p>
          <p>
            <a
              href={`https://alphaama.com/profile/${encodeURIComponent(owner?.pubkey ?? '')}`}
              target="_blank"
              rel="noreferrer"
            >
              Open owner activity in alphaama.com
            </a>
          </p>

          <h3>Quick Seed Blob</h3>
          <label>Seed Blob Id</label>
          <input value={seedBlobId} onChange={(event) => setSeedBlobId(event.target.value)} />
          <label>Seed Blob Content</label>
          <textarea
            value={seedBlobContent}
            onChange={(event) => setSeedBlobContent(event.target.value)}
            rows={3}
            disabled={Boolean(seedFile)}
          />
          <label style={{ marginTop: 8 }}>Upload file blob (image, audio, etc.)</label>
          <input
            type="file"
            onChange={(event) => {
              void onSeedFileSelected(event.target.files?.[0] ?? null).catch((error) => {
                setStatus(error instanceof Error ? error.message : 'Failed to read selected file');
              });
            }}
          />
          {seedFile && <p className="muted">Selected file: {seedFile.name} ({seedFile.mimeType})</p>}
          <div className="dual" style={{ marginTop: 12 }}>
            <button
              onClick={() =>
                void run('seed blob', async () => {
                  const content = seedFile ? seedFile.base64 : seedBlobContent;
                  const result = await uploadBlob(seedBlobId, content, seedFile
                    ? { encoding: 'base64', mimeType: seedFile.mimeType, fileName: seedFile.name }
                    : { encoding: 'utf8', mimeType: 'text/plain', fileName: `${seedBlobId}.txt` }) as {
                    blobId: string;
                    contentRef: string;
                    deduped?: boolean;
                    message?: string;
                    existingBlobId?: string | null;
                  };

                  if (result.deduped) {
                    setSeedNotice(result.message ?? `The file (${seedBlobId}) is already stored as (${result.existingBlobId ?? result.blobId}) with CID ${result.contentRef}.`);
                    setChallengeBlobId(result.existingBlobId ?? result.blobId);
                    setStallBlobId(result.existingBlobId ?? result.blobId);
                    return;
                  }

                  setSeedNotice(`Stored blob (${result.blobId}) with CID ${result.contentRef}.`);
                  setChallengeBlobId(result.blobId);
                  setStallBlobId(result.blobId);
                })
              }
              disabled={!seedBlobId || (!seedBlobContent && !seedFile)}
            >
              Seed Blob
            </button>
          </div>
          {seedNotice && <p className="muted" style={{ marginTop: 8 }}>{seedNotice}</p>}

          <h3 style={{ marginTop: 16 }}>Retrieve Blob (Challenger)</h3>
          <div className="dual" style={{ marginTop: 8 }}>
            <select value={challengeBlobId} onChange={(event) => setChallengeBlobId(event.target.value)}>
              <option value="">Select blob</option>
              {snapshot.blobs.map((blob) => (
                <option key={`retrieve-${blob.blobId}`} value={blob.blobId}>{blob.blobId}</option>
              ))}
            </select>
            <select value={retrieveFromRole} onChange={(event) => setRetrieveFromRole(event.target.value as 'provider' | 'provider2' | 'provider3')}>
              <option value="provider">Request from SP1</option>
              <option value="provider2">Request from SP2</option>
              <option value="provider3">Request from SP3</option>
            </select>
            <button
              onClick={() =>
                void run('retrieve blob', async () => {
                  if (!challengeBlobId) return;
                  const blob = await retrieveBlob(challengeBlobId, retrieveFromRole);
                  setRetrievedBlob(blob);
                })
              }
              disabled={!challengeBlobId}
            >
              Retrieve via SP
            </button>
          </div>
          {retrievedBlob && (
            <div className="result-card">
              <div className="sub-row"><span>Blob</span><span>{retrievedBlob.blobId}</span></div>
              <div className="sub-row"><span>CID</span><code>{shortId(retrievedBlob.cid, 14)}</code></div>
              <div className="sub-row"><span>Size</span><span>{formatBytes(estimateContentBytes(retrievedBlob.plaintextPayload, retrievedBlob.encoding))}</span></div>
              <div className="sub-row"><span>From</span><span>{roleName(retrievedBlob.fromRole)} ({shortId(retrievedBlob.providerNpub, 10)})</span></div>
              <div className="sub-row"><span>Encoding</span><span>{retrievedBlob.encoding ?? 'utf8'}</span></div>
              {retrievedBlob.fileName && <div className="sub-row"><span>File</span><span>{retrievedBlob.fileName}</span></div>}
              {retrievedBlob.mimeType && <div className="sub-row"><span>MIME</span><span>{retrievedBlob.mimeType}</span></div>}
              <div className="sub-row"><span>Plaintext</span><code className="content-wrap">{retrievedBlob.encoding === 'base64' ? `${retrievedBlob.plaintextPayload.slice(0, 72)}...` : retrievedBlob.plaintextPayload}</code></div>
              <div className="sub-row"><span>Flow</span><span className="muted">{retrievedBlob.transportNote}</span></div>
              <button style={{ marginTop: 8 }} onClick={downloadRetrievedBlob}>Download Retrieved Blob</button>
            </div>
          )}

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

          <h3 style={{ marginTop: 12 }}>Challenge rewards (sats)</h3>
          <div className="dual" style={{ marginTop: 8 }}>
            <div>
              <label>Rank #1 sats</label>
              <input
                type="number"
                min={0}
                value={rewardSchedule[0]}
                onChange={(event) =>
                  setRewardSchedule(([_, r2, r3]) => [Math.max(0, Number(event.target.value)), r2, r3])
                }
              />
            </div>
            <div>
              <label>Rank #2 sats</label>
              <input
                type="number"
                min={0}
                value={rewardSchedule[1]}
                onChange={(event) =>
                  setRewardSchedule(([r1, _, r3]) => [r1, Math.max(0, Number(event.target.value)), r3])
                }
              />
            </div>
            <div>
              <label>Rank #3 sats</label>
              <input
                type="number"
                min={0}
                value={rewardSchedule[2]}
                onChange={(event) =>
                  setRewardSchedule(([r1, r2]) => [r1, r2, Math.max(0, Number(event.target.value))])
                }
              />
            </div>
          </div>

          <div style={{ marginTop: 8, maxWidth: 260 }}>
            <label>Reliability bonus (msat)</label>
            <input
              type="number"
              min={0}
              value={reliabilityBonusMsats}
              onChange={(event) => setReliabilityBonusMsats(Math.max(0, Number(event.target.value)))}
            />
          </div>

          <div className="dual" style={{ marginTop: 12 }}>
            <button
              onClick={() =>
                void run('manual challenge', () =>
                  createChallenge({
                    blobId: challengeBlobId,
                    payoutSchedule: rewardSchedule,
                    reliabilityBonusMsats,
                    commitLeadSeconds: 20,
                    revealLeadSeconds: 40,
                  }),
                )
              }
              disabled={!challengeBlobId}
            >
              Post Challenge Now
            </button>
            <button
              onClick={() => {
                setAutoLibraryMode(false);
                setAutoMode((v) => !v);
              }}
              disabled={!challengeBlobId}
            >
              {autoMode ? 'Stop 30s Auto Challenges' : 'Start 30s Auto Challenges'}
            </button>
            <button
              onClick={() => {
                setAutoMode(false);
                setAutoLibraryMode((v) => !v);
              }}
              disabled={snapshot.blobs.length === 0}
            >
              {autoLibraryMode ? 'Stop 30s Auto Challenges (Library)' : 'Start 30s Auto Challenges (Library Random)'}
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
                      payoutSchedule: rewardSchedule,
                      reliabilityBonusMsats,
                      commitLeadSeconds: 20,
                      revealLeadSeconds: 40,
                      autoRespondProviders: true,
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

          <details className="evidence-block" style={{ marginTop: 16 }}>
            <summary>Replica Registry (CID → SP roots)</summary>
            {snapshot.replicaRegistry.length === 0 ? (
              <p className="muted">No replica roots yet.</p>
            ) : (
              snapshot.replicaRegistry.map((entry) => (
                <div key={entry.cid} className="result-card compact-card">
                  <div className="result-head">
                    <strong>{blobNameByContentRef.get(entry.cid) ?? 'Unknown blob'}</strong>
                    <code>{shortId(entry.cid, 14)} · {formatBytes(blobSizeByContentRef.get(entry.cid))}</code>
                  </div>
                  {Object.entries(entry.rootsByProvider).map(([sp, root]) => (
                    <div key={`${entry.cid}-${sp}`} className="sub-row">
                      <span>{roleName(sp)}</span>
                      <code>{shortId(root, 12)}</code>
                    </div>
                  ))}
                </div>
              ))
            )}
          </details>

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
                  <code>{shortId(receipt.cid, 14)}</code>
                </div>
                <div className="sub-row">
                  <span>Supplier fee</span>
                  <span>{Math.round(receipt.supplierFeeMsats / 1000)} sats</span>
                </div>
                <div className="sub-row">
                  <span>Stall fee</span>
                  <span>{Math.round(receipt.stallFeeMsats / 1000)} sats</span>
                </div>
                <div className="sub-row"><span>Payment status</span><span className={`chip ${receipt.paymentStatus === 'paid' ? 'settled' : 'open'}`}>{receipt.paymentStatus}</span></div>
                {receipt.supplierPaymentRef && <div className="sub-row"><span>Supplier payment</span><code>{shortId(receipt.supplierPaymentRef, 12)}</code></div>}
                {receipt.stallPaymentRef && <div className="sub-row"><span>Stall payment</span><code>{shortId(receipt.stallPaymentRef, 12)}</code></div>}
                {receipt.paymentError && <div className="sub-row"><span>Error</span><span className="muted">{receipt.paymentError}</span></div>}
                <div className="sub-row">
                  <span>Time</span>
                  <span>{fmtTs(receipt.createdAt)}</span>
                </div>
              </div>
            ))
          )}

          <h3 style={{ marginTop: 16 }}>Tracked Files / Replication Health</h3>
          {Array.from(challengesByBlob.entries())
            .sort((a, b) => (b[1].lastChecked ?? 0) - (a[1].lastChecked ?? 0))
            .map(([blob, data]) => {
              const responders = Array.from(data.responders);
              return (
                <div key={blob} className="result-card compact-card">
                  <div className="result-head">
                    <strong>{blobNameByContentRef.get(blob) ?? (blob.startsWith('cid:') ? 'CID-only blob' : 'Legacy blob ref')}</strong>
                    <code>{shortId(blob, 14)}</code>
                  </div>
                  <div className="sub-row"><span>Last checked</span><span>{fmtTs(data.lastChecked)}</span></div>
                  <div className="sub-row"><span>Responder count</span><span className={`chip ${responders.length > 0 ? 'settled' : 'open'}`}>{responders.length}</span></div>
                  <details className="evidence-block" style={{ marginTop: 8 }}>
                    <summary>Responders</summary>
                    {responders.length === 0 ? (
                      <p className="muted">none yet</p>
                    ) : (
                      responders.map((responder) => (
                        <div key={`${blob}-${responder}`} className="sub-row">
                          <span>{shortId(responder, 12)}</span>
                        </div>
                      ))
                    )}
                  </details>
                </div>
              );
            })}

          <h3 style={{ marginTop: 16 }}>Round Timeline</h3>
          {snapshot.challenges
            .slice()
            .sort((a, b) => b.challenge.createdAt - a.challenge.createdAt)
            .slice(0, 8)
            .map((entry) => (
              <div key={`${entry.challenge.id}-timeline`} className="result-card">
                <div className="result-head">
                  <strong>{shortId(entry.challenge.payload.challengeId, 8)}</strong>
                  <span className="badge">leaf #{entry.challenge.payload.leafIndex}</span>
                  <span className={`chip ${entry.settlement ? 'settled' : 'open'}`}>{entry.settlement ? 'settled' : 'pending'}</span>
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
                <div style={{ marginTop: 8 }}>
                  <p className="muted" style={{ marginBottom: 6 }}>Excluded responders:</p>
                  {(latestRound.settlement.payload.excluded ?? []).map((entry) => {
                    const parsed = parseExcluded(entry);
                    return (
                      <div key={`excluded-${entry}`} className="sub-row">
                        <code>{shortId(parsed.responder, 14)}</code>
                        <span className="muted">{parsed.reason}</span>
                      </div>
                    );
                  })}
                </div>
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

          <details className="evidence-block" style={{ marginTop: 16 }}>
            <summary>Published Messages</summary>
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
                      <code>{shortId(event.id, 14)}</code>
                    </div>
                    <div className="sub-row">
                      <span>time</span>
                      <span>{fmtTs(event.createdAt)}</span>
                    </div>
                    <div className="sub-row">
                      <span>author</span>
                      <code>{shortId(event.pubkey, 10)}</code>
                    </div>
                    <div className="sub-row">
                      <span>content</span>
                      <code className="content-wrap">{event.content}</code>
                    </div>
                  </div>
                );
              })
            )}
          </details>
        </section>
      )}

      {(view === 'all' || view === 'sp1' || view === 'sp2' || view === 'sp3') && (
        <section className="workspace-grid">
          {spRows
            .filter((sp) => view === 'all' || view === sp.id)
            .map((sp) => (
              <div className="panel" key={sp.id}>
                <h2>{sp.label}</h2>
                <div className="result-head" style={{ marginBottom: 8 }}>
                  <span className={`chip ${sp.files.length > 0 ? 'settled' : 'open'}`}>{sp.files.length > 0 ? 'active' : 'idle'}</span>
                  <span className="chip open">open {openChallenges.length}</span>
                </div>
                <p>
                  <strong>npub:</strong> <code>{shortId(sp.npub, 12)}</code>
                </p>
                <p>
                  <strong>Last paid:</strong> {fmtTs(sp.lastPaid)}
                </p>

                <h3>Tracked files</h3>
                {sp.files.length === 0 ? (
                  <p className="muted">No tracked files yet.</p>
                ) : (
                  sp.files.map((f) => (
                    <div key={`${sp.id}-${f.cid}`} className="result-card compact-card" style={{ marginBottom: 8 }}>
                      <div className="sub-row">
                        <span>Original CID</span>
                        <code>{shortId(f.cid, 14)}</code>
                      </div>
                      {f.storedCid !== f.cid && (
                        <div className="sub-row">
                          <span>{roleName(sp.role)} stored CID</span>
                          <code>{shortId(f.storedCid, 14)}</code>
                        </div>
                      )}
                      <div className="sub-row">
                        <span>Size</span>
                        <span>{formatBytes(blobSizeByContentRef.get(f.cid))}</span>
                      </div>
                      <div className="sub-row">
                        <span>{roleName(sp.role)} root</span>
                        <code>{shortId(f.providerRoot, 14)}</code>
                      </div>
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
            Stall routes DO uploads/replication and re-wrap data between SPs. Each retrieval now
            shows the SP unwrap followed by the DO unwrap before plaintext is returned.
          </p>

          <h3>Re-wrap / Transfer log</h3>
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
                  <code>{shortId(receipt.requester, 10)}</code>
                </div>
                <div className="sub-row">
                  <span>Supplier</span>
                  <code>{shortId(receipt.supplier, 10)}</code>
                </div>
                <div className="sub-row">
                  <span>Supplier fee</span>
                  <span>{Math.round(receipt.supplierFeeMsats / 1000)} sats</span>
                </div>
                <div className="sub-row">
                  <span>Stall fee</span>
                  <span>{Math.round(receipt.stallFeeMsats / 1000)} sats</span>
                </div>
                <div className="sub-row"><span>Payment status</span><span className={`chip ${receipt.paymentStatus === 'paid' ? 'settled' : 'open'}`}>{receipt.paymentStatus}</span></div>
                {receipt.supplierPaymentRef && <div className="sub-row"><span>Supplier payment</span><code>{shortId(receipt.supplierPaymentRef, 12)}</code></div>}
                {receipt.stallPaymentRef && <div className="sub-row"><span>Stall payment</span><code>{shortId(receipt.stallPaymentRef, 12)}</code></div>}
                {receipt.paymentError && <div className="sub-row"><span>Error</span><span className="muted">{receipt.paymentError}</span></div>}
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
              const blobName = blobNameByContentRef.get(entry.cid) ?? 'unknown';
              return (
                <div key={`stall-repl-${entry.cid}`} className="result-card">
                  <div className="sub-row">
                    <span>Blob</span>
                    <span>{blobName}</span>
                  </div>
                  <div className="sub-row">
                    <span>CID</span>
                    <code>{shortId(entry.cid, 14)}</code>
                  </div>
                  <div className="sub-row">
                    <span>Size</span>
                    <span>{formatBytes(blobSizeByContentRef.get(entry.cid))}</span>
                  </div>
                  <div className="sub-row">
                    <span>SP1</span>
                    <span className={`chip ${entry.rootsByProvider.provider ? 'settled' : 'open'}`}>{entry.rootsByProvider.provider ? 'covered' : 'missing'}</span>
                  </div>
                  <div className="sub-row">
                    <span>SP2</span>
                    <span className={`chip ${entry.rootsByProvider.provider2 ? 'settled' : 'open'}`}>{entry.rootsByProvider.provider2 ? 'covered' : 'missing'}</span>
                  </div>
                  <div className="sub-row">
                    <span>SP3</span>
                    <span className={`chip ${entry.rootsByProvider.provider3 ? 'settled' : 'open'}`}>{entry.rootsByProvider.provider3 ? 'covered' : 'missing'}</span>
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
