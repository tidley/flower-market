import { afterEach, describe, expect, it } from 'vitest';

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
    });
    await daemon.respondToChallenge(challenge.payload.challengeId);
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

    expect(settledChallenge?.settlement?.payload.winners).toHaveLength(1);
    expect(settledChallenge?.settlement?.payload.winners[0]?.baseSats).toBe(15);
    expect(settledListing?.settlement?.payload.verified).toBe(true);
    expect(settledListing?.settlement?.payload.eligibility).toBe('pending');
  });
});
