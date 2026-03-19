import { deriveEligibilityState, hashLeaf, verifyTransferProof } from '../../flower-contextvm/src/index.ts';
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
  ReplicaRegistryEntry,
  SettlementEventPayload,
  StallTransferReceipt,
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
  sp3: 'olive eager domain pistol ladder spell kingdom absorb trick utility fossil render',
} as const;

export class FlowerDaemon {
  readonly owner: RuntimeSigner;
  readonly provider: RuntimeSigner;
  readonly provider2: RuntimeSigner;
  readonly provider3: RuntimeSigner;
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
  private marketIncomingMsatsByRole = new Map<RuntimeIdentityView['role'], number>();
  private marketOutgoingMsatsByRole = new Map<RuntimeIdentityView['role'], number>();
  private replicaRootsByCid = new Map<string, Map<'provider' | 'provider2' | 'provider3', string>>();
  private inventoryByRole = new Map<'provider' | 'provider2' | 'provider3', Set<string>>();
  private stallTransfers: StallTransferReceipt[] = [];
  private liveNwcBalancesByNpub: Record<string, number> = {};
  private nwcBalancePollInFlight = false;
  private lastNwcBalancePollAt = 0;
  private readonly nwcBalancePollIntervalMs = 30_000;
  private lastLogAtByKey = new Map<string, number>();

  constructor(config: FlowerDaemonConfig = {}) {
    this.owner = createRuntimeSigner(config.ownerSecretKeyHex);
    this.provider = createRuntimeSigner(config.providerSecretKeyHex);
    this.provider2 = createRuntimeSigner(config.provider2SecretKeyHex);
    this.provider3 = createRuntimeSigner();
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
        payer: { uri: config.challengerNwcUri, npub: this.owner.npub },
        recipientsByNpub: {
          [this.provider.npub]: { uri: config.providerNwcUri },
          [this.provider2.npub]: { uri: config.provider2NwcUri },
        },
      });
    } else {
      this.payoutAdapter = new EcashPayoutAdapter({
        mintUrls: config.mintUrls ?? ['https://mint.example'],
      });
    }
    this.blossom = new DummyBlossomServer();
    this.syncIntervalMs = config.syncIntervalMs ?? 2_000;
    this.inventoryByRole.set('provider', new Set());
    this.inventoryByRole.set('provider2', new Set());
    this.inventoryByRole.set('provider3', new Set());
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
        const message = error instanceof Error ? error.message : String(error);
        this.logRateLimited(`tick:${message}`, 'flower-runtime tick failed', error);
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
      balances: await this.buildBalances(identities, parsed.settlements),
      blobs: this.blossom.list(),
      challenges: buildChallengeViews(parsed),
      listings: buildMarketplaceViews(parsed),
      replicaRegistry: this.getReplicaRegistry(),
      stallTransfers: this.stallTransfers.slice().sort((a, b) => b.createdAt - a.createdAt),
    };
  }

  seedBlob(blobId: string, content: string): BlossomFixture {
    const blob = this.blossom.seed(createBlossomFixture(blobId, content));
    this.registerReplica(blob.contentRef, 'provider');
    this.registerReplica(blob.contentRef, 'provider2');
    return blob;
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
      leafIndex: Math.floor(Math.random() * Math.max(1, blob.leafProofs?.length ?? 1)),
      nonce: randomId('nonce'),
      commitDeadline: now + input.commitLeadSeconds,
      revealDeadline: now + input.revealLeadSeconds,
      payoutSchedule: input.payoutSchedule,
      reliabilityBonusMsats: input.reliabilityBonusMsats,
    });

    const challengeNoteId = await this.publishChallengeNote(event);

    const sp1 = await this.respondToChallenge(event.payload.challengeId, 'provider');
    const sp2 = await this.respondToChallenge(event.payload.challengeId, 'provider2');
    const sp3 = await this.respondToChallenge(event.payload.challengeId, 'provider3');
    await this.publishProofReplyNote(event, challengeNoteId, 'provider', sp1.reveal, sp1.commit);
    await this.publishProofReplyNote(event, challengeNoteId, 'provider2', sp2.reveal, sp2.commit);
    await this.publishProofReplyNote(event, challengeNoteId, 'provider3', sp3.reveal, sp3.commit);

    return event;
  }

  async respondToChallenge(challengeId: string, providerRole: 'provider' | 'provider2' | 'provider3' = 'provider'): Promise<{
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
    const responderSigner = this.signerForRole(providerRole);
    const challengedLeafIndex = challenge.payload.leafIndex;
    const selectedLeaf = blob.leafProofs?.[challengedLeafIndex] ?? {
      leafHash: blob.sampleLeafHash,
      proof: blob.sampleProof,
    };

    const commit = await this.transport.publish(responderSigner, {
      type: 'commit',
      challengeId,
      responder: responderSigner.npub,
      commitHash: buildCommitHash(challengeId, responderSigner.npub, selectedLeaf.leafHash, revealNonce),
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
      leafHash: selectedLeaf.leafHash,
      proof: selectedLeaf.proof,
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

  async requestTransferViaStall(input: {
    blobId: string;
    fromRole: 'provider' | 'provider2' | 'provider3';
    toRole: 'provider' | 'provider2' | 'provider3';
    supplierFeeSats: number;
    stallFeeSats: number;
  }): Promise<StallTransferReceipt> {
    if (input.fromRole === input.toRole) {
      throw new Error('fromRole and toRole must differ');
    }

    const blob = await fetchBlossomObject(this.blossomBaseUrl, input.blobId);
    const cid = blob.contentRef;
    if (!this.inventoryByRole.get(input.fromRole)?.has(cid)) {
      throw new Error(`${input.fromRole} does not host ${cid}`);
    }

    this.registerReplica(cid, input.toRole);

    const supplierFeeMsats = Math.max(0, Math.round(input.supplierFeeSats * 1000));
    const stallFeeMsats = Math.max(0, Math.round(input.stallFeeSats * 1000));

    this.bumpMarketFlow(input.toRole, 'out', supplierFeeMsats + stallFeeMsats);
    this.bumpMarketFlow(input.fromRole, 'in', Math.max(0, supplierFeeMsats - stallFeeMsats));
    this.bumpMarketFlow('settler', 'in', stallFeeMsats);

    const requester = this.signerForRole(input.toRole).npub;
    const supplier = this.signerForRole(input.fromRole).npub;
    const stall = this.settler.npub;

    const receipt: StallTransferReceipt = {
      transferId: randomId('stall'),
      cid,
      blobId: input.blobId,
      fromRole: input.fromRole,
      toRole: input.toRole,
      supplierFeeMsats,
      stallFeeMsats,
      requester,
      supplier,
      stall,
      createdAt: Math.floor(Date.now() / 1000),
    };
    this.stallTransfers.push(receipt);
    return receipt;
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
    providerRole: 'provider' | 'provider2' | 'provider3',
    reveal: PublishedFlowerEvent<RevealEventPayload>,
    commit: PublishedFlowerEvent<CommitEventPayload>,
  ): Promise<void> {
    const signer = this.signerForRole(providerRole);
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

  private getReplicaRegistry(): ReplicaRegistryEntry[] {
    return [...this.replicaRootsByCid.entries()].map(([cid, roots]) => ({
      cid,
      rootsByProvider: Object.fromEntries([...roots.entries()]),
    }));
  }

  private registerReplica(cid: string, role: 'provider' | 'provider2' | 'provider3'): void {
    const roots = this.replicaRootsByCid.get(cid) ?? new Map<'provider' | 'provider2' | 'provider3', string>();
    roots.set(role, hashLeaf(`${cid}:${role}`));
    this.replicaRootsByCid.set(cid, roots);
    this.inventoryByRole.get(role)?.add(cid);
  }

  private signerForRole(role: 'provider' | 'provider2' | 'provider3'): RuntimeSigner {
    if (role === 'provider2') return this.provider2;
    if (role === 'provider3') return this.provider3;
    return this.provider;
  }

  private bumpMarketFlow(role: RuntimeIdentityView['role'], direction: 'in' | 'out', amountMsats: number): void {
    if (amountMsats <= 0) return;
    const map = direction === 'in' ? this.marketIncomingMsatsByRole : this.marketOutgoingMsatsByRole;
    map.set(role, (map.get(role) ?? 0) + amountMsats);
  }

  private logRateLimited(key: string, label: string, error: unknown, intervalMs = 60_000): void {
    const now = Date.now();
    const last = this.lastLogAtByKey.get(key) ?? 0;
    if (now - last < intervalMs) return;
    this.lastLogAtByKey.set(key, now);
    console.warn(label, error);
  }

  private maybeRefreshNwcBalances(): void {
    if (!(this.payoutAdapter instanceof NwcPayoutAdapter)) return;
    if (this.nwcBalancePollInFlight) return;
    const now = Date.now();
    if (now - this.lastNwcBalancePollAt < this.nwcBalancePollIntervalMs) return;

    this.nwcBalancePollInFlight = true;
    this.lastNwcBalancePollAt = now;

    this.payoutAdapter
      .getBalanceMsatsByNpub()
      .then((balances) => {
        this.liveNwcBalancesByNpub = balances;
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logRateLimited(`nwc-balance:${message}`, 'flower-runtime: failed to poll NWC balances', error);
      })
      .finally(() => {
        this.nwcBalancePollInFlight = false;
      });
  }

  private async buildBalances(
    identities: RuntimeIdentityView[],
    settlements: PublishedFlowerEvent<SettlementEventPayload>[],
  ): Promise<RuntimeSnapshot['balances']> {
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

    this.maybeRefreshNwcBalances();
    const liveBalancesByNpub = this.liveNwcBalancesByNpub;

    return identities.map((identity) => {
      const fundedMsats = this.fundedMsatsByRole.get(identity.role) ?? 0;
      const settlementIncomingMsats = incomingByNpub.get(identity.npub) ?? 0;
      const settlementOutgoingMsats = outgoingByNpub.get(identity.npub) ?? 0;
      const marketIncomingMsats = this.marketIncomingMsatsByRole.get(identity.role) ?? 0;
      const marketOutgoingMsats = this.marketOutgoingMsatsByRole.get(identity.role) ?? 0;
      const incomingMsats = settlementIncomingMsats + marketIncomingMsats;
      const outgoingMsats = settlementOutgoingMsats + marketOutgoingMsats;
      const runtimeBalance = fundedMsats + incomingMsats - outgoingMsats;
      const liveBalance = liveBalancesByNpub[identity.npub];
      return {
        role: identity.role,
        npub: identity.npub,
        mintUrl: primaryMint,
        fundedMsats,
        incomingMsats,
        outgoingMsats,
        balanceMsats: Number.isFinite(liveBalance) ? liveBalance : runtimeBalance,
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
      {
        role: 'provider3',
        npub: this.provider3.npub,
        pubkey: this.provider3.publicKey,
        cashuTestMnemonic: TEST_CASHU_MNEMONICS.sp3,
      },
      { role: 'settler', npub: this.settler.npub, pubkey: this.settler.publicKey },
    ];
  }
}

