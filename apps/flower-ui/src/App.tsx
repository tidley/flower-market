import { startTransition, useEffect, useState } from 'react';
import type { RuntimeSnapshot } from '../../../packages/flower-runtime/src/index.ts';
import {
  acceptOffer,
  createChallenge,
  createListing,
  createOffer,
  fetchRuntimeState,
  publishTransferProof,
  respondToChallenge,
  uploadBlob,
} from './api';

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

export function App() {
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>(emptySnapshot);
  const [status, setStatus] = useState('Connecting to daemon...');
  const [busy, setBusy] = useState<string | null>(null);
  const [blobId, setBlobId] = useState('demo_blob');
  const [blobContent, setBlobContent] = useState('flower market owner payload');
  const [challengeBlobId, setChallengeBlobId] = useState('demo_blob');
  const [listingBlobId, setListingBlobId] = useState('demo_blob');
  const [firstPrize, setFirstPrize] = useState(15);
  const [secondPrize, setSecondPrize] = useState(10);
  const [thirdPrize, setThirdPrize] = useState(5);
  const [bonusMsats, setBonusMsats] = useState(1000);
  const [commitLead, setCommitLead] = useState(30);
  const [revealLead, setRevealLead] = useState(60);
  const [priceSats, setPriceSats] = useState(5);
  const [deliveryDeadline, setDeliveryDeadline] = useState(Math.floor(Date.now() / 1000) + 3600);
  const [cooldownSeconds, setCooldownSeconds] = useState(120);

  async function refreshState() {
    const next = await fetchRuntimeState();
    startTransition(() => {
      setSnapshot(next);
      setStatus(`Connected to ${next.relayMode} runtime`);
      if (next.blobs.length > 0) {
        setChallengeBlobId((current) => current || next.blobs[0].blobId);
        setListingBlobId((current) => current || next.blobs[0].blobId);
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

  async function onFileSelect(file: File | null) {
    if (!file) {
      return;
    }
    const text = await file.text();
    setBlobContent(text);
    if (!blobId) {
      setBlobId(file.name.replace(/\W+/g, '_'));
    }
  }

  const owner = snapshot.identities.find((identity) => identity.role === 'owner');
  const provider = snapshot.identities.find((identity) => identity.role === 'provider');
  const unsettledChallenges = snapshot.challenges.filter((challenge) => challenge.status === 'open');

  return (
    <div className="page-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Flower Market Control Surface</p>
          <h1>Owner + Provider views over the live daemon</h1>
          <p className="lede">
            Upload content into the dummy Blossom service, configure payouts, publish challenges and listings, then drive the
            provider side from the same relay-backed runtime.
          </p>
        </div>
        <div className="hero-card">
          <div className="stat">
            <span>Runtime</span>
            <strong>{snapshot.relayMode}</strong>
          </div>
          <div className="stat">
            <span>Relay Set</span>
            <strong>{snapshot.relayUrls.length > 0 ? snapshot.relayUrls.join(', ') : 'in-memory demo'}</strong>
          </div>
          <div className="stat">
            <span>Blossom</span>
            <strong>{snapshot.blossomBaseUrl || 'starting...'}</strong>
          </div>
          <div className="status-row">
            <span className="status-pill">{busy ? `Working: ${busy}` : status}</span>
          </div>
        </div>
      </section>

      <section className="identity-strip">
        <div className="identity-card">
          <h2>Owner Identity</h2>
          <code>{owner?.npub ?? 'loading'}</code>
        </div>
        <div className="identity-card">
          <h2>Provider Identity</h2>
          <code>{provider?.npub ?? 'loading'}</code>
        </div>
      </section>

      <section className="workspace-grid">
        <div className="panel">
          <h2>Owner Console</h2>
          <p className="panel-copy">Upload blobs, configure payouts, publish challenges, and handle marketplace transfers.</p>

          <div className="card-block">
            <h3>1. Add Blob To Blossom</h3>
            <label>Blob Id</label>
            <input value={blobId} onChange={(event) => setBlobId(event.target.value)} />
            <label>File</label>
            <input type="file" onChange={(event) => void onFileSelect(event.target.files?.[0] ?? null)} />
            <label>Content</label>
            <textarea value={blobContent} onChange={(event) => setBlobContent(event.target.value)} rows={6} />
            <button onClick={() => void run('upload blob', () => uploadBlob(blobId, blobContent))} disabled={!blobId || !blobContent}>
              Upload To Blossom
            </button>
          </div>

          <div className="card-block">
            <h3>2. Publish Retrieval Challenge</h3>
            <label>Blob</label>
            <select value={challengeBlobId} onChange={(event) => setChallengeBlobId(event.target.value)}>
              <option value="">Select blob</option>
              {snapshot.blobs.map((blob) => (
                <option key={blob.blobId} value={blob.blobId}>
                  {blob.blobId}
                </option>
              ))}
            </select>
            <div className="triple">
              <div>
                <label>1st Prize</label>
                <input type="number" value={firstPrize} onChange={(event) => setFirstPrize(Number(event.target.value))} />
              </div>
              <div>
                <label>2nd Prize</label>
                <input type="number" value={secondPrize} onChange={(event) => setSecondPrize(Number(event.target.value))} />
              </div>
              <div>
                <label>3rd Prize</label>
                <input type="number" value={thirdPrize} onChange={(event) => setThirdPrize(Number(event.target.value))} />
              </div>
            </div>
            <div className="dual">
              <div>
                <label>Bonus msats</label>
                <input type="number" value={bonusMsats} onChange={(event) => setBonusMsats(Number(event.target.value))} />
              </div>
              <div>
                <label>Commit Lead Seconds</label>
                <input type="number" value={commitLead} onChange={(event) => setCommitLead(Number(event.target.value))} />
              </div>
              <div>
                <label>Reveal Lead Seconds</label>
                <input type="number" value={revealLead} onChange={(event) => setRevealLead(Number(event.target.value))} />
              </div>
            </div>
            <button
              onClick={() =>
                void run('create challenge', () =>
                  createChallenge({
                    blobId: challengeBlobId,
                    payoutSchedule: [firstPrize, secondPrize, thirdPrize],
                    reliabilityBonusMsats: bonusMsats,
                    commitLeadSeconds: commitLead,
                    revealLeadSeconds: revealLead,
                  }),
                )
              }
              disabled={!challengeBlobId}
            >
              Publish Challenge
            </button>
          </div>

          <div className="card-block">
            <h3>3. Create Marketplace Listing</h3>
            <label>Blob</label>
            <select value={listingBlobId} onChange={(event) => setListingBlobId(event.target.value)}>
              <option value="">Select blob</option>
              {snapshot.blobs.map((blob) => (
                <option key={blob.blobId} value={blob.blobId}>
                  {blob.blobId}
                </option>
              ))}
            </select>
            <div className="dual">
              <div>
                <label>Price sats</label>
                <input type="number" value={priceSats} onChange={(event) => setPriceSats(Number(event.target.value))} />
              </div>
              <div>
                <label>Delivery Deadline</label>
                <input
                  type="number"
                  value={deliveryDeadline}
                  onChange={(event) => setDeliveryDeadline(Number(event.target.value))}
                />
              </div>
              <div>
                <label>Cooldown Seconds</label>
                <input
                  type="number"
                  value={cooldownSeconds}
                  onChange={(event) => setCooldownSeconds(Number(event.target.value))}
                />
              </div>
            </div>
            <button
              onClick={() =>
                void run('create listing', () =>
                  createListing({
                    blobId: listingBlobId,
                    priceSats,
                    deliveryDeadline,
                    cooldownSeconds,
                  }),
                )
              }
              disabled={!listingBlobId}
            >
              Publish Listing
            </button>
          </div>
        </div>

        <div className="panel">
          <h2>Provider Console</h2>
          <p className="panel-copy">See open rounds, mirror data, respond to challenges, and participate in the marketplace.</p>

          <div className="card-block">
            <h3>Open Challenges</h3>
            {unsettledChallenges.length === 0 ? (
              <p className="muted">No open challenges right now.</p>
            ) : (
              unsettledChallenges.map((challenge) => (
                <div key={challenge.challenge.id} className="list-row">
                  <div>
                    <strong>{challenge.challenge.payload.challengeId}</strong>
                    <p>Blob: {challenge.challenge.payload.contentRef}</p>
                    <p>Payouts: {challenge.challenge.payload.payoutSchedule.join(' / ')} sats</p>
                  </div>
                  <button onClick={() => void run('respond to challenge', () => respondToChallenge(challenge.challenge.payload.challengeId))}>
                    Commit + Reveal
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="card-block">
            <h3>Marketplace Feed</h3>
            {snapshot.listings.length === 0 ? (
              <p className="muted">No listings published yet.</p>
            ) : (
              snapshot.listings.map((listing) => (
                <div key={listing.listing.id} className="market-card">
                  <div className="market-head">
                    <div>
                      <strong>{listing.listing.payload.listingId}</strong>
                      <p>
                        {listing.listing.payload.contentRef} · {listing.listing.payload.priceSats} sats
                      </p>
                    </div>
                    {!listing.offers.length ? (
                      <button onClick={() => void run('create offer', () => createOffer(listing.listing.payload.listingId))}>Make Offer</button>
                    ) : null}
                  </div>

                  {listing.offers.map((offer) => (
                    <div key={offer.id} className="sub-row">
                      <span>Offer {offer.payload.offerId}</span>
                      {!listing.accept ? (
                        <button onClick={() => void run('accept offer', () => acceptOffer(offer.payload.offerId))}>Owner Accept</button>
                      ) : (
                        <span className="badge">accepted</span>
                      )}
                    </div>
                  ))}

                  {listing.accept ? (
                    <div className="sub-row">
                      <span>Transfer {listing.accept.payload.transferId}</span>
                      {!listing.transferProof ? (
                        <button
                          onClick={() => void run('publish transfer proof', () => publishTransferProof(listing.accept!.payload.transferId))}
                        >
                          Publish Transfer Proof
                        </button>
                      ) : (
                        <span className="badge">proof published</span>
                      )}
                    </div>
                  ) : null}

                  {listing.settlement ? (
                    <div className="settlement-box">
                      <p>Eligibility: <span className="badge">{listing.settlement.payload.eligibility}</span></p>
                      <p>Verified: <span className="badge">{String(listing.settlement.payload.verified)}</span></p>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="results-grid">
        <div className="panel">
          <h2>Challenge Settlements</h2>
          {snapshot.challenges.length === 0 ? (
            <p className="muted">No challenge events yet.</p>
          ) : (
            snapshot.challenges.map((entry) => (
              <div key={entry.challenge.id} className="result-card">
                <div className="result-head">
                  <strong>{entry.challenge.payload.challengeId}</strong>
                  <span className="badge">{entry.status}</span>
                </div>
                <p>Commits: {entry.commits.length} · Reveals: {entry.reveals.length}</p>
                {entry.settlement ? <pre>{JSON.stringify(entry.settlement.payload, null, 2)}</pre> : null}
              </div>
            ))
          )}
        </div>

        <div className="panel">
          <h2>Relay Snapshot</h2>
          <pre>{JSON.stringify(snapshot, null, 2)}</pre>
        </div>
      </section>
    </div>
  );
}
