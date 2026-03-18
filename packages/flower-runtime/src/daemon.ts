import { deriveEligibilityState, verifyTransferProof } from '../../flower-contextvm/src/index.ts';
import { EcashPayoutAdapter, type PayoutAdapter } from '../../flower-payout/src/index.ts';
import { finalizeEvent, SimplePool } from 'nostr-tools';
import { createBlossomFixture, DummyBlossomServer, fetchBlossomObject } from './blossom.ts';
import { buildCommitHash, createRuntimeSigner, randomId } from './crypto.ts';
import { NwcPayoutAdapter } from './nwcPayout.ts';
import { MemoryRelayTransport, NostrRelayTransport } from './relay.ts';
import { buildChallengeViews, buildMarketplaceViews, parseRuntimeEvents } from './snapshot.ts';
import { settlePublishedChallenge } from './runtime.ts';
import type {
  BlossomFixture,
  ChallengeEventPayload,
  CommitEventPayload,
  MarketAcceptEventPayload,
  MarketListingEventPayload,
  MarketOfferEventPayload,
  MarketTransferProofEventPayload,
  PublishedFlowerEvent,
  RelayFilter,
  RuntimeIdentityView,
  RuntimeSigner,
  RuntimeSnapshot,
  RevealEventPayload,
  SettlementEventPayload,
} from './types.ts';
import type { RelayTransport } from './relay.ts';

function parseBlossomBlobId(contentRef: string): string {
  if (!contentRef.startsWith('blossom:')) {
    throw new Error(`Unsupported contentRef for dummy Blossom runtime: ${contentRef}`);
  }

  return contentRef.slice('blossom:'.length);
}

export interface FlowerDaemonConfig {
  relayUrls?: string[];
  forceKind1?: boolean;
  syncIntervalMs?: number;
  httpPort?: number;
  blossomPort?: number;
  ownerSecretKeyHex?: string;
  providerSecretKeyHex?: string;
  provider2SecretKeyHex?: string;
  settlerSecretKeyHex?: string;
  mintUrls?: string[];
  payoutMode?: 'ecash' | 'lightning';
  challengerNwcUri?: string;
  providerNwcUri?: string;
  provider2NwcUri?: string;
}

type PublishedMessage = {
  id: string;
  kind: number;
  pubkey: string;
  createdAt: number;
  content: string;
  tags: string[][];
};

const TEST_CASHU_MNEMONICS = {
  challenger: 'invest unit fire blood melt elephant ancient erase way neck insane clutch',
  sp1: 'child armor company physical spatial gather draw tired push heavy parrot lemon',
  sp2: 'orbit maple badge rabbit vocal silver upset canyon flush syrup cotton drill',
} as const;

export class FlowerDaemon {
  readonly owner: RuntimeSigner;
  readonly provider: RuntimeSigner;
  readonly provider2: RuntimeSigner;
  readonly settler: RuntimeSigner;
  readonly relayMode: 'memory' | 'nostr';
  readonly relayUrls: string[];

  private blossom: DummyBlossomServer;
  private transport: RelayTransport;
  private payoutAdapter: PayoutAdapter;
  private blossomBaseUrl = '';
  private syncIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private publishedMessages: PublishedMessage[] = [];
  private fundedMsatsByRole = new Map<RuntimeIdentityView['role'], number>();

  constructor(config: FlowerDaemonConfig = {}) {
    this.owner = createRuntimeSigner(config.ownerSecretKeyHex);
    this.provider = createRuntimeSigner(config.providerSecretKeyHex);
    this.provider2 = createRuntimeSigner(config.provider2SecretKeyHex);
    this.settler = createRuntimeSigner(config.settlerSecretKeyHex);
    this.relayUrls = config.relayUrls ?? [];
    this.relayMode = this.relayUrls.length > 0 ? 'nostr' : 'memory';
    this.transport = this.relayMode === 'nostr' ? new NostrRelayTransport(this.relayUrls, 1500, config.forceKind1 ?? true) : new MemoryRelayTransport();

    if (
      config.payoutMode === 'lightning' &&
      config.challengerNwcUri &&
      config.providerNwcUri &&
      config.provider2NwcUri
    ) {
      this.payoutAdapter = new NwcPayoutAdapter({
        payer: { uri: config.challengerNwcUri },
        recipientsByNpub: {
          [this.provider.npub]: { uri: config.providerNwcUri },
          [this.provider2.npub]: { uri: config.provider2NwcUri },
        },
      });
    } else {
      this.payoutAdapter = new EcashPayoutAdapter({
        mintUrls: config.mintUrls ?? ['https://mint.minibits.cash'],
      });
    }
    this.blossom = new DummyBlossomServer();
    this.syncIntervalMs = config.syncIntervalMs ?? 2_000;
  }

  async start(blossomPort = 0): Promise<void> {
    if (this.timer) {
      return;
    }

    const port = await this.blossom.start(blossomPort);
    this.blossomBaseUrl = `http://127.0.0.1:${port}`;
    await this.tick();
    this.timer = setInterval(() => {
      this.tick().catch((error) => {
        console.error('flower-runtime tick failed', error);
      });
    }, this.syncIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    await this.transport.close();
    if ('close' in this.payoutAdapter && typeof this.payoutAdapter.close === 'function') {
      await this.payoutAdapter.close();
    }
    await this.blossom.stop();
  }

  getBlossomBaseUrl(): string {
    return this.blossomBaseUrl;
  }

  listBlobs(): BlossomFixture[] {
    return this.blossom.list();
  }

  async tick(): Promise<void> {
    if (this.ticking) {
      return;
    }

    this.ticking = true;
    try {
      await this.settleOpenChallenges();
      await this.settleMarketplaceTransfers();
    } finally {
      this.ticking = false;
    }
  }

  async getEvents(filter: RelayFilter = {}): Promise<PublishedFlowerEvent[]> {
    return this.transport.list(filter);
  }

  getPublishedMessages(): PublishedMessage[] {
    return this.publishedMessages.slice().sort((a, b) => b.createdAt - a.createdAt);
  }

  addFunding(role: RuntimeIdentityView['role'], sats: number): void {
    if (!Number.isFinite(sats) || sats <= 0) {
      throw new Error('funding sats must be > 0');
    }
    const current = this.fundedMsatsByRole.get(role) ?? 0;
    this.fundedMsatsByRole.set(role, current + Math.round(sats * 1000));
  }

  async getSnapshot(): Promise<RuntimeSnapshot> {
    const events = await this.transport.list();
    const parsed = parseRuntimeEvents(events);
    const identities = this.identities();

    return {
      updatedAt: Date.now(),
      relayMode: this.relayMode,
      relayUrls: this.relayUrls,
      blossomBaseUrl: this.blossomBaseUrl,
      identities,
      balances: this.buildBalances(identities, parsed.settlements),
      blobs: this.blossom.list(),
      challenges: buildChallengeViews(parsed),
      listings: buildMarketplaceViews(parsed),
    };
  }

  seedBlob(blobId: string, content: string): BlossomFixture {
    return this.blossom.seed(createBlossomFixture(blobId, content));
  }

  async publishChallenge(input: {
    blobId: string;
    payoutSchedule: [number, number, number];
    reliabilityBonusMsats: number;
    commitLeadSeconds: number;
    revealLeadSeconds: number;
  }): Promise<PublishedFlowerEvent<ChallengeEventPayload>> {
    const blob = await fetchBlossomObject(this.blossomBaseUrl, input.blobId);
    const now = Math.floor(Date.now() / 1000);

    const event = await this.transport.publish(this.owner, {
      type: 'challenge',
      challengeId: randomId('ch'),
      epoch: now,
      contentRef: blob.contentRef,
      merkleRoot: blob.merkleRoot,
      leafIndex: 0,
      nonce: randomId('nonce'),
      commitDeadline: now + input.commitLeadSeconds,
      revealDeadline: now + input.revealLeadSeconds,
      payoutSchedule: input.payoutSchedule,
      reliabilityBonusMsats: input.reliabilityBonusMsats,
    });

    const challengeNoteId = await this.publishChallengeNote(event);

    const sp1 = await this.respondToChallenge(event.payload.challengeId, 'provider');
    const sp2 = await this.respondToChallenge(event.payload.challengeId, 'provider2');
    await this.publishProofReplyNote(event, challengeNoteId, 'provider', sp1.reveal, sp1.commit);
    await this.publishProofReplyNote(event, challengeNoteId, 'provider2', sp2.reveal, sp2.commit);

    return event;
  }

  async respondToChallenge(challengeId: string, providerRole: 'provider' | 'provider2' = 'provider'): Promise<{
    commit: PublishedFlowerEvent<CommitEventPayload>;
    reveal: PublishedFlowerEvent<RevealEventPayload>;
  }> {
    const events = await this.transport.list({ challengeId });
    const challenge = events.find(
      (event): event is PublishedFlowerEvent<ChallengeEventPayload> => event.payload.type === 'challenge',
    );
    if (!challenge) {
      throw new Error(`Unknown challenge ${challengeId}`);
    }

    const blobId = parseBlossomBlobId(challenge.payload.contentRef);
    const blob = await fetchBlossomObject(this.blossomBaseUrl, blobId);
    const revealNonce = randomId('reveal');
    const now = Math.floor(Date.now() / 1000);
    const responderSigner = providerRole === 'provider2' ? this.provider2 : this.provider;

    const commit = await this.transport.publish(responderSigner, {
      type: 'commit',
      challengeId,
      responder: responderSigner.npub,
      commitHash: buildCommitHash(challengeId, responderSigner.npub, blob.leafHash, revealNonce),
      commitTs: now,
    });

    const reveal = await this.transport.publish(responderSigner, {
      type: 'reveal',
      challengeId,
      responder: responderSigner.npub,
      commitTs: now,
      revealTs: now + 1,
      latencyMs: 75,
      reliabilityScore: 0.96,
      leafHash: blob.leafHash,
      proof: blob.sampleProof,
      expectedRoot: blob.merkleRoot,
      revealNonce,
    });

    return { commit, reveal };
  }

  async publishListing(input: {
    blobId: string;
    priceSats: number;
    deliveryDeadline: number;
    cooldownSeconds: number;
  }): Promise<PublishedFlowerEvent<MarketListingEventPayload>> {
    const blob = await fetchBlossomObject(this.blossomBaseUrl, input.blobId);

    return this.transport.publish(this.owner, {
      type: 'market.listing',
      listingId: randomId('lst'),
      seller: this.owner.npub,
      contentRef: blob.contentRef,
      merkleRoot: blob.merkleRoot,
      priceSats: input.priceSats,
      terms: {
        deliveryDeadline: input.deliveryDeadline,
        cooldownSeconds: input.cooldownSeconds,
      },
    });
  }

  async publishOffer(listingId: string): Promise<PublishedFlowerEvent<MarketOfferEventPayload>> {
    return this.transport.publish(this.provider, {
      type: 'market.offer',
      offerId: randomId('off'),
      listingId,
      buyer: this.provider.npub,
      paymentRef: `invoice:${randomId('pay')}`,
      offerTs: Math.floor(Date.now() / 1000),
    });
  }

  async publishAccept(offerId: string): Promise<PublishedFlowerEvent<MarketAcceptEventPayload>> {
    const events = await this.transport.list();
    const offer = events.find(
      (event): event is PublishedFlowerEvent<MarketOfferEventPayload> =>
        event.payload.type === 'market.offer' && event.payload.offerId === offerId,
    );
    if (!offer) {
      throw new Error(`Unknown offer ${offerId}`);
    }

    return this.transport.publish(this.owner, {
      type: 'market.accept',
      offerId,
      listingId: offer.payload.listingId,
      seller: this.owner.npub,
      acceptTs: Math.floor(Date.now() / 1000),
      transferId: randomId('tr'),
    });
  }

  async publishTransferProof(transferId: string): Promise<PublishedFlowerEvent<MarketTransferProofEventPayload>> {
    const snapshot = await this.getSnapshot();
    const listingView = snapshot.listings.find((listing) => listing.accept?.payload.transferId === transferId);
    if (!listingView?.accept) {
      throw new Error(`Unknown transfer ${transferId}`);
    }

    const blob = await fetchBlossomObject(this.blossomBaseUrl, parseBlossomBlobId(listingView.listing.payload.contentRef));

    return this.transport.publish(this.owner, {
      type: 'market.transfer_proof',
      transferId,
      listingId: listingView.listing.payload.listingId,
      seller: this.owner.npub,
      buyer: this.provider.npub,
      contentRef: blob.contentRef,
      merkleRoot: blob.merkleRoot,
      sampleLeafHash: blob.sampleLeafHash,
      sampleProof: blob.sampleProof,
      proofTs: Math.floor(Date.now() / 1000),
    });
  }

  private async publishChallengeNote(challenge: PublishedFlowerEvent<ChallengeEventPayload>): Promise<string | null> {
    const note = await this.publishKind1Note(this.owner, [
      ['t', 'flower-market'],
      ['t', 'challenge'],
      ['c', challenge.payload.challengeId],
      ['r', challenge.payload.contentRef],
    ], `Flower challenge ${challenge.payload.challengeId} posted for ${challenge.payload.contentRef}; commit by ${challenge.payload.commitDeadline}, reveal by ${challenge.payload.revealDeadline}.`);

    return note?.id ?? null;
  }

  private async publishProofReplyNote(
    challenge: PublishedFlowerEvent<ChallengeEventPayload>,
    challengeNoteId: string | null,
    providerRole: 'provider' | 'provider2',
    reveal: PublishedFlowerEvent<RevealEventPayload>,
    commit: PublishedFlowerEvent<CommitEventPayload>,
  ): Promise<void> {
    const signer = providerRole === 'provider2' ? this.provider2 : this.provider;
    const revealSig = this.rawEventSig(reveal.raw);

    const tags: string[][] = [
      ['t', 'flower-market'],
      ['t', 'proof-reply'],
      ['c', challenge.payload.challengeId],
      ['p', this.owner.publicKey],
      ['e', challenge.id],
      ['e', reveal.id],
      ['e', commit.id],
    ];
    if (challengeNoteId) {
      tags.push(['e', challengeNoteId, '', 'reply']);
    }

    const content = JSON.stringify({
      kind: 'flower-proof-reply',
      challengeId: challenge.payload.challengeId,
      responder: signer.npub,
      responderPubkey: signer.publicKey,
      revealEventId: reveal.id,
      commitEventId: commit.id,
      revealSig,
      merkleRoot: challenge.payload.merkleRoot,
      contentRef: challenge.payload.contentRef,
      revealTs: reveal.payload.revealTs,
      commitTs: commit.payload.commitTs,
      latencyMs: reveal.payload.latencyMs,
      reliabilityScore: reveal.payload.reliabilityScore,
    });

    await this.publishKind1Note(signer, tags, content);
  }

  private rawEventSig(raw: unknown): string | null {
    if (!raw || typeof raw !== 'object') return null;
    const maybeSig = (raw as { sig?: unknown }).sig;
    return typeof maybeSig === 'string' ? maybeSig : null;
  }

  private async publishKind1Note(signer: RuntimeSigner, tags: string[][], content: string): Promise<PublishedMessage | null> {
    const note = finalizeEvent(
      {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content,
      },
      signer.secretKey,
    );

    this.publishedMessages.push({
      id: note.id,
      kind: note.kind,
      pubkey: note.pubkey,
      createdAt: note.created_at,
      content: note.content,
      tags: note.tags as string[][],
    });

    if (this.relayMode !== 'nostr' || this.relayUrls.length === 0) {
      return this.publishedMessages[this.publishedMessages.length - 1] ?? null;
    }

    const pool = new SimplePool();
    try {
      await Promise.allSettled(pool.publish(this.relayUrls, note));
      return this.publishedMessages[this.publishedMessages.length - 1] ?? null;
    } finally {
      pool.close(this.relayUrls);
    }
  }

  private async settleOpenChallenges(): Promise<void> {
    const snapshot = await this.getSnapshot();
    for (const challengeView of snapshot.challenges) {
      if (challengeView.settlement || challengeView.reveals.length === 0) {
        continue;
      }

      const blob = await fetchBlossomObject(
        this.blossomBaseUrl,
        parseBlossomBlobId(challengeView.challenge.payload.contentRef),
      );
      await settlePublishedChallenge(this.transport, this.settler, challengeView.challenge, blob, undefined, undefined, this.payoutAdapter);
    }
  }

  private async settleMarketplaceTransfers(): Promise<void> {
    const snapshot = await this.getSnapshot();
    for (const listingView of snapshot.listings) {
      if (!listingView.accept || !listingView.transferProof || listingView.settlement) {
        continue;
      }

      const proof = listingView.transferProof.payload;
      const verified = verifyTransferProof({
        sampleLeafHash: proof.sampleLeafHash,
        sampleProof: proof.sampleProof,
        merkleRoot: proof.merkleRoot,
      });
      const cooldownUntil = proof.proofTs + listingView.listing.payload.terms.cooldownSeconds;

      await this.transport.publish(this.settler, {
        type: 'market.settlement',
        transferId: proof.transferId,
        listingId: proof.listingId,
        offerId: listingView.accept.payload.offerId,
        seller: proof.seller,
        buyer: proof.buyer,
        priceSats: listingView.listing.payload.priceSats,
        paymentSettled: true,
        verified,
        cooldownUntil,
        eligibility: deriveEligibilityState(verified, true, Math.floor(Date.now() / 1000), cooldownUntil),
      });
    }
  }

  private buildBalances(
    identities: RuntimeIdentityView[],
    settlements: PublishedFlowerEvent<SettlementEventPayload>[],
  ): RuntimeSnapshot['balances'] {
    const incomingByNpub = new Map<string, number>();
    const outgoingByNpub = new Map<string, number>();
    let primaryMint = 'lightning:nwc';

    for (const settlement of settlements) {
      for (const receipt of settlement.payload.payoutReceipts ?? []) {
        incomingByNpub.set(receipt.responder, (incomingByNpub.get(receipt.responder) ?? 0) + receipt.amountMsats);
        outgoingByNpub.set(this.owner.npub, (outgoingByNpub.get(this.owner.npub) ?? 0) + receipt.amountMsats);
        primaryMint = receipt.mintUrl || primaryMint;
      }
    }

    return identities.map((identity) => {
      const fundedMsats = this.fundedMsatsByRole.get(identity.role) ?? 0;
      const incomingMsats = incomingByNpub.get(identity.npub) ?? 0;
      const outgoingMsats = outgoingByNpub.get(identity.npub) ?? 0;
      return {
        role: identity.role,
        npub: identity.npub,
        mintUrl: primaryMint,
        fundedMsats,
        incomingMsats,
        outgoingMsats,
        balanceMsats: fundedMsats + incomingMsats - outgoingMsats,
      };
    });
  }

  private identities(): RuntimeIdentityView[] {
    return [
      {
        role: 'owner',
        npub: this.owner.npub,
        pubkey: this.owner.publicKey,
        cashuTestMnemonic: TEST_CASHU_MNEMONICS.challenger,
      },
      {
        role: 'provider',
        npub: this.provider.npub,
        pubkey: this.provider.publicKey,
        cashuTestMnemonic: TEST_CASHU_MNEMONICS.sp1,
      },
      {
        role: 'provider2',
        npub: this.provider2.npub,
        pubkey: this.provider2.publicKey,
        cashuTestMnemonic: TEST_CASHU_MNEMONICS.sp2,
      },
      { role: 'settler', npub: this.settler.npub, pubkey: this.settler.publicKey },
    ];
  }
}

