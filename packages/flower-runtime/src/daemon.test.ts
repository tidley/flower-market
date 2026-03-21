import { afterEach, describe, expect, it } from 'vitest';

import { decryptBlobEnvelope } from './envelope.ts';
import { FlowerDaemon } from './daemon.ts';

describe('FlowerDaemon', () => {
  const daemons: FlowerDaemon[] = [];

  afterEach(async () => {
    await Promise.all(daemons.map((daemon) => daemon.stop()));
    daemons.length = 0;
  });

  it('runs challenge settlement and marketplace settlement continuously', async () => {
    const daemon = new FlowerDaemon({ syncIntervalMs: 50 });
    daemons.push(daemon);
    await daemon.start();

    daemon.seedBlob('blob_a', 'autonomous payload');
    const challenge = await daemon.publishChallenge({
      blobId: 'blob_a',
      payoutSchedule: [15, 10, 5],
      reliabilityBonusMsats: 1000,
      commitLeadSeconds: 30,
      revealLeadSeconds: 60,
      autoRespondProviders: true,
    });
    await daemon.tick();

    const listing = await daemon.publishListing({
      blobId: 'blob_a',
      priceSats: 5,
      deliveryDeadline: Math.floor(Date.now() / 1000) + 600,
      cooldownSeconds: 30,
    });
    const offer = await daemon.publishOffer(listing.payload.listingId);
    const accept = await daemon.publishAccept(offer.payload.offerId);
    await daemon.publishTransferProof(accept.payload.transferId);
    await daemon.tick();

    const snapshot = await daemon.getSnapshot();
    const settledChallenge = snapshot.challenges.find((entry) => entry.challenge.payload.challengeId === challenge.payload.challengeId);
    const settledListing = snapshot.listings.find((entry) => entry.listing.payload.listingId === listing.payload.listingId);

    const winners = settledChallenge?.settlement?.payload.winners ?? [];
    expect(winners.length).toBeGreaterThanOrEqual(2);
    expect(winners.map((winner) => winner.baseSats).slice(0, 2)).toEqual([15, 10]);
    expect(settledListing?.settlement?.payload.verified).toBe(true);
    expect(settledListing?.settlement?.payload.eligibility).toBe('pending');
  });

  it('creates open challenges without auto replies unless explicitly requested', async () => {
    const daemon = new FlowerDaemon({ syncIntervalMs: 25, ignoreRelayHistory: true });
    daemons.push(daemon);
    await daemon.start();

    daemon.seedBlob('blob_manual', 'manual payload');
    const challenge = await daemon.publishChallenge({
      blobId: 'blob_manual',
      payoutSchedule: [15, 10, 5],
      reliabilityBonusMsats: 1000,
      commitLeadSeconds: 30,
      revealLeadSeconds: 60,
    });

    await daemon.tick();
    const snapshot = await daemon.getSnapshot();
    const view = snapshot.challenges.find((entry) => entry.challenge.payload.challengeId === challenge.payload.challengeId);
    expect(view?.status).toBe('open');
    expect(view?.reveals ?? []).toHaveLength(0);
  });

  it('prevents responses from providers that do not host the challenge blob', async () => {
    const daemon = new FlowerDaemon({ syncIntervalMs: 25, ignoreRelayHistory: true });
    daemons.push(daemon);
    await daemon.start();

    daemon.seedBlob('blob_missing_sp3', 'payload');
    const challenge = await daemon.publishChallenge({
      blobId: 'blob_missing_sp3',
      payoutSchedule: [5, 3, 1],
      reliabilityBonusMsats: 0,
      commitLeadSeconds: 30,
      revealLeadSeconds: 60,
    });

    await expect(daemon.respondToChallenge(challenge.payload.challengeId, 'provider3')).rejects.toThrow('does not host');
  });

  it('retrieves seeded binary-style blobs with file metadata through provider and DO unwraps', async () => {
    const daemon = new FlowerDaemon({ syncIntervalMs: 25, ignoreRelayHistory: true });
    daemons.push(daemon);
    await daemon.start();

    const payloadB64 = Buffer.from('fake mp3 bytes').toString('base64');
    daemon.seedBlob('song_blob', payloadB64, {
      encoding: 'base64',
      mimeType: 'audio/mpeg',
      fileName: 'demo.mp3',
    });

    await daemon.requestPeerTransfer({
      blobId: 'song_blob',
      fromRole: 'provider',
      toRole: 'provider3',
      supplierFeeSats: 1,
      transferFeeSats: 1,
    });

    const retrieved = await daemon.retrieveBlobViaProvider({ blobId: 'song_blob', fromRole: 'provider3' });
    expect(retrieved.plaintextPayload).toBe(payloadB64);
    expect(retrieved.deliveredCiphertext).toBe(payloadB64);
    expect(retrieved.envelope.wrapsByProvider.provider3?.sourceRole).toBe('provider');
    expect(retrieved.transportNote).toContain('DO decrypt');
    expect(retrieved.encoding).toBe('base64');
    expect(retrieved.mimeType).toBe('audio/mpeg');
    expect(retrieved.fileName).toBe('demo.mp3');
    expect(Buffer.from(retrieved.deliveredCiphertext, 'base64').toString('utf8')).toBe('fake mp3 bytes');
  });

  it('rejects a wrong-role unwrap attempt against a seeded envelope', async () => {
    const daemon = new FlowerDaemon({ syncIntervalMs: 25, ignoreRelayHistory: true });
    daemons.push(daemon);
    await daemon.start();

    daemon.seedBlob('wrong_role_blob', 'wrong role payload');
    const blob = daemon.listBlobs().find((entry) => entry.blobId === 'wrong_role_blob');
    expect(blob?.envelope).toBeTruthy();

    expect(() => {
      if (!blob?.envelope) throw new Error('missing envelope');
      return decryptBlobEnvelope(blob.envelope, 'provider', daemon.provider2, daemon.owner);
    }).toThrow(/failed to unwrap provider ciphertext/);
  });

  it('rewraps from SP1 to SP3 and retrieves the original payload from SP3', async () => {
    const daemon = new FlowerDaemon({ syncIntervalMs: 25, ignoreRelayHistory: true });
    daemons.push(daemon);
    await daemon.start();

    const original = 'peer transfer payload';
    daemon.seedBlob('transfer_blob', original);

    const receipt = await daemon.requestPeerTransfer({
      blobId: 'transfer_blob',
      fromRole: 'provider',
      toRole: 'provider3',
      supplierFeeSats: 1,
      transferFeeSats: 1,
    });
    expect(receipt.payload.sourceRole).toBe('provider');
    expect(receipt.payload.targetRole).toBe('provider3');
    expect(receipt.payload.targetReceivedRewrap).toBe(true);
    expect(receipt.payload.merkleRoot).toBeTruthy();

    const retrieved = await daemon.retrieveBlobViaProvider({ blobId: 'transfer_blob', fromRole: 'provider3' });
    expect(retrieved.deliveredCiphertext).toBe(original);
    expect(retrieved.plaintextPayload).toBe(original);
    expect(retrieved.envelope.wrapsByProvider.provider3?.sourceRole).toBe('provider');

    const snapshot = await daemon.getSnapshot();
    expect(snapshot.peerTransfers.some((entry) => entry.id === receipt.id)).toBe(true);

    const messages = daemon.getPublishedMessages();
    expect(messages.some((message) => message.content.includes('flower-peer-transfer'))).toBe(true);
  });

  it('tracks replica coverage after randomized peer transfers across several blobs', async () => {
    const daemon = new FlowerDaemon({ syncIntervalMs: 25, ignoreRelayHistory: true });
    daemons.push(daemon);
    await daemon.start();

    const blobs = [
      daemon.seedBlob('blob_1', 'payload A'),
      daemon.seedBlob('blob_2', 'payload B'),
      daemon.seedBlob('blob_3', 'payload A'),
      daemon.seedBlob('blob_4', 'payload C'),
      daemon.seedBlob('blob_5', 'payload D'),
    ];

    const roles = ['provider', 'provider2', 'provider3'] as const;
    const hostsByCid = new Map<string, Set<(typeof roles)[number]>>();
    for (const blob of blobs) {
      hostsByCid.set(blob.contentRef, new Set(['provider', 'provider2']));
    }

    let seed = 1337;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    for (let i = 0; i < 30; i += 1) {
      const blob = blobs[Math.floor(rand() * blobs.length)];
      const cidHosts = [...(hostsByCid.get(blob.contentRef) ?? new Set(['provider']))];
      const fromRole = cidHosts[Math.floor(rand() * cidHosts.length)];
      const toCandidates = roles.filter((role) => role !== fromRole);
      const toRole = toCandidates[Math.floor(rand() * toCandidates.length)];

      const receipt = await daemon.requestPeerTransfer({
        blobId: blob.blobId,
        fromRole,
        toRole,
        supplierFeeSats: 1,
        transferFeeSats: 1,
      });
      expect(receipt.payload.blobId).toBe(blob.blobId);
      hostsByCid.get(blob.contentRef)?.add(toRole);
    }

    const snapshot = await daemon.getSnapshot();
    expect(snapshot.blobs).toHaveLength(5);

    const byCid = new Map(snapshot.replicaRegistry.map((entry) => [entry.cid, entry]));
    for (const [cid, hosts] of hostsByCid.entries()) {
      const entry = byCid.get(cid);
      expect(entry).toBeTruthy();
      for (const role of roles) {
        const covered = Boolean(entry?.rootsByProvider[role]);
        expect(covered).toBe(hosts.has(role));
      }
    }

    for (const blob of blobs) {
      const hosts = hostsByCid.get(blob.contentRef) ?? new Set<typeof roles[number]>();
      for (const role of hosts) {
        const retrieval = await daemon.retrieveBlobViaProvider({ blobId: blob.blobId, fromRole: role });
        expect(retrieval.blobId).toBe(blob.blobId);
        expect(retrieval.cid).toBe(blob.contentRef);
        expect(retrieval.deliveredCiphertext).toBe(blob.content);
      }
    }
  });
});
