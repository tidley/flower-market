import { deriveEligibilityState, hashLeaf, verifyTransferProof } from '../../flower-contextvm/src/index.ts';
import { EcashPayoutAdapter, type PayoutAdapter } from '../../flower-payout/src/index.ts';
import { finalizeEvent, SimplePool } from 'nostr-tools';
import { createBlossomFixture, DummyBlossomServer, fetchBlossomObject } from './blossom.ts';
import { buildCommitHash, createRuntimeSigner, randomId } from './crypto.ts';
import { buildBlobEnvelope, decryptBlobEnvelope, rewrapBlobEnvelope } from './envelope.ts';
import { NwcPayoutAdapter } from './nwcPayout.ts';
import {
  AutonomousCheckpointStore,
  createEmptyAutonomyCheckpoint,
  responseKey,
} from './autonomy.ts';
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
  PeerTransferEventPayload,
  PublishedFlowerEvent,
  RelayFilter,
  ProviderRole,
  RuntimeIdentityView,
  RuntimeSigner,
  RuntimeSnapshot,
  RuntimeStatus,
  RevealEventPayload,
  ReplicaRegistryEntry,
  SettlementEventPayload,
  RetrievedBlobView,
  AutonomousResponderCheckpoint,
  AutonomousResponderRecord,
  AutonomousResponderStatus,
  AutonomousResponderCursor,
} from './types.ts';
import type { RelayTransport } from './relay.ts';


export interface FlowerDaemonConfig {
  relayUrls?: string[];
  forceKind1?: boolean;
  syncIntervalMs?: number;
  autonomousResponderEnabled?: boolean;
  autonomousResponderIntervalMs?: number;
  autonomousResponderJitterMs?: number;
  autonomousCheckpointPath?: string;
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
  provider3NwcUri?: string;
  settlementNwcUri?: string;
  nwcBalancePolling?: boolean;
  nwcBalancePollIntervalMs?: number;
  nwcBalancePollSpacingMs?: number;
  ignoreRelayHistory?: boolean;
  transport?: RelayTransport;
}

function roleName(role: ProviderRole): string {
  if (role === 'provider') return 'SP1';
  if (role === 'provider2') return 'SP2';
  return 'SP3';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  private ownsTransport = true;
  private payoutAdapter: PayoutAdapter;
  private blossomBaseUrl = '';
  private syncIntervalMs: number;
  private autonomousResponderEnabled = false;
  private autonomousResponderIntervalMs = 4_000;
  private autonomousResponderJitterMs = 1_250;
  private autonomousResponderTimer: NodeJS.Timeout | null = null;
  private autonomousResponderRunning = false;
  private autonomousResponderPendingCount = 0;
  private autonomousResponderLastRunAt = 0;
  private autonomousResponderLastSuccessfulRunAt = 0;
  private autonomousResponderLastError: string | null = null;
  private autonomousResponderCursor: AutonomousResponderCursor = { lastProcessedChallengeCreatedAt: 0 };
  private autonomousResponderInstanceSalt = randomId('auto');
  private autonomousCheckpointStore: AutonomousCheckpointStore;
  private autonomousCheckpoint: AutonomousResponderCheckpoint = createEmptyAutonomyCheckpoint();
  private autonomousResponseRecords = new Map<string, AutonomousResponderRecord>();
  private autonomousResponseInFlight = new Map<string, Promise<{ commit: PublishedFlowerEvent<CommitEventPayload>; reveal: PublishedFlowerEvent<RevealEventPayload> }>>();
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private publishedMessages: PublishedMessage[] = [];
  private fundedMsatsByRole = new Map<RuntimeIdentityView['role'], number>();
  private marketIncomingMsatsByRole = new Map<RuntimeIdentityView['role'], number>();
  private marketOutgoingMsatsByRole = new Map<RuntimeIdentityView['role'], number>();
  private replicaRootsByCid = new Map<string, Map<ProviderRole, string>>();
  private envelopeByCid = new Map<string, BlossomFixture['envelope']>();
  private cidToBlobId = new Map<string, string>();
  private inventoryByRole = new Map<ProviderRole, Set<string>>();
  private liveNwcBalancesByNpub: Record<string, number> = {};
  private nwcBalancePollInFlight = false;
  private lastNwcBalancePollAt = 0;
  private nwcBalancePollIntervalMs = 90_000;
  private nwcBalancePollBackoffMs = 0;
  private readonly nwcBalancePollMaxBackoffMs = 10 * 60_000;
  private lastLogAtByKey = new Map<string, number>();
  private nwcBalancePolling = true;
  private ignoreRelayHistory = false;
  private startedAtSec = Math.floor(Date.now() / 1000);
  private sessionChallengeIds = new Set<string>();
  private sessionListingIds = new Set<string>();
  private sessionPeerTransferIds = new Set<string>();

  constructor(config: FlowerDaemonConfig = {}) {
    this.owner = createRuntimeSigner(config.ownerSecretKeyHex);
    this.provider = createRuntimeSigner(config.providerSecretKeyHex);
    this.provider2 = createRuntimeSigner(config.provider2SecretKeyHex);
    this.provider3 = createRuntimeSigner();
    this.settler = createRuntimeSigner(config.settlerSecretKeyHex);
    this.relayUrls = config.relayUrls ?? [];
    this.relayMode = this.relayUrls.length > 0 ? 'nostr' : 'memory';
    this.transport = config.transport ?? (this.relayMode === 'nostr' ? new NostrRelayTransport(this.relayUrls, 1500, config.forceKind1 ?? true) : new MemoryRelayTransport());
    this.ownsTransport = !config.transport;

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
          ...(config.provider3NwcUri ? { [this.provider3.npub]: { uri: config.provider3NwcUri } } : {}),
        },
        observersByNpub: {
          ...(config.settlementNwcUri ? { [this.settler.npub]: { uri: config.settlementNwcUri } } : {}),
        },
        balancePollSpacingMs: config.nwcBalancePollSpacingMs ?? 750,
      });
    } else {
      this.payoutAdapter = new EcashPayoutAdapter({
        mintUrls: config.mintUrls ?? ['https://mint.example'],
      });
    }
    this.blossom = new DummyBlossomServer();
    this.syncIntervalMs = config.syncIntervalMs ?? 2_000;
    this.autonomousResponderEnabled = config.autonomousResponderEnabled ?? false;
    this.autonomousResponderIntervalMs = Math.max(10, config.autonomousResponderIntervalMs ?? 4_000);
    this.autonomousResponderJitterMs = Math.max(0, config.autonomousResponderJitterMs ?? 1_250);
    const autonomousCheckpointPath =
      config.autonomousCheckpointPath ??
      (this.autonomousResponderEnabled ? `${process.cwd()}/.flower-runtime/autonomy-checkpoint.json` : null);
    this.autonomousCheckpointStore = new AutonomousCheckpointStore(
      autonomousCheckpointPath,
    );
    this.nwcBalancePolling = config.nwcBalancePolling ?? true;
    this.nwcBalancePollIntervalMs = Math.max(15_000, config.nwcBalancePollIntervalMs ?? 90_000);
    this.ignoreRelayHistory = config.ignoreRelayHistory ?? false;
    this.inventoryByRole.set('provider', new Set());
    this.inventoryByRole.set('provider2', new Set());
    this.inventoryByRole.set('provider3', new Set());
  }

  async start(blossomPort = 0): Promise<void> {
    if (this.timer) {
      return;
    }

    await this.blossom.start(blossomPort);
    this.blossomBaseUrl = this.blossom.getBaseUrl();
    await this.loadAutonomousCheckpoint();
    await this.tick();
    this.timer = setInterval(() => {
      this.tick().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logRateLimited(`tick:${message}`, 'flower-runtime tick failed', error);
      });
    }, this.syncIntervalMs);

    if (this.autonomousResponderEnabled) {
      try {
        await this.runAutonomousResponderLoop();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.autonomousResponderLastError = message;
        this.logRateLimited(`autonomous:${message}`, 'flower-runtime autonomous responder failed', error);
      }
      this.autonomousResponderTimer = setInterval(() => {
        this.runAutonomousResponderLoop().catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          this.autonomousResponderLastError = message;
          this.logRateLimited(`autonomous:${message}`, 'flower-runtime autonomous responder failed', error);
        });
      }, this.autonomousResponderIntervalMs);
    }
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.autonomousResponderTimer) {
      clearInterval(this.autonomousResponderTimer);
      this.autonomousResponderTimer = null;
    }

    if (this.ownsTransport) {
      await this.transport.close();
    }
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

  async getStatus(): Promise<RuntimeStatus> {
    return {
      uptimeMs: Date.now() - this.startedAtSec * 1000,
      startedAtSec: this.startedAtSec,
      relayMode: this.relayMode,
      relayUrls: this.relayUrls,
      blossomBaseUrl: this.blossomBaseUrl,
      autonomousResponder: this.getAutonomousResponderStatus(),
    };
  }

  async getEvents(filter: RelayFilter = {}): Promise<PublishedFlowerEvent[]> {
    return this.listEvents(filter);
  }

  private async listEvents(filter: RelayFilter = {}): Promise<PublishedFlowerEvent[]> {
    const events = await this.transport.list(filter);
    if (!this.ignoreRelayHistory) return events;

    return events.filter((event) => {
      if (event.createdAt < this.startedAtSec) return false;

      const payload = event.payload as unknown as Record<string, unknown>;
      const type = typeof payload.type === 'string' ? payload.type : undefined;
      const challengeId = typeof payload.challengeId === 'string' ? payload.challengeId : undefined;
      const listingId = typeof payload.listingId === 'string' ? payload.listingId : undefined;
      const transferId = typeof payload.transferId === 'string' ? payload.transferId : undefined;

      if (challengeId) return this.sessionChallengeIds.has(challengeId);
      if (listingId) return this.sessionListingIds.has(listingId);
      if (transferId) return this.sessionPeerTransferIds.has(transferId);

      if (type === 'challenge' || type === 'commit' || type === 'reveal' || type === 'settlement') return false;
      if (type?.startsWith('market.')) return false;

      return true;
    });
  }

  getPublishedMessages(): PublishedMessage[] {
    return this.publishedMessages.slice().sort((a, b) => b.createdAt - a.createdAt);
  }

  private getAutonomousResponderStatus(): AutonomousResponderStatus {
    return {
      enabled: this.autonomousResponderEnabled,
      running: this.autonomousResponderRunning,
      pendingCount: this.autonomousResponderPendingCount,
      lastRunAt: this.autonomousResponderLastRunAt || null,
      lastSuccessfulRunAt: this.autonomousResponderLastSuccessfulRunAt || null,
      cursor: this.autonomousResponderCursor,
      checkpointPath: this.autonomousCheckpointStore.path,
      lastError: this.autonomousResponderLastError,
    };
  }

  private async loadAutonomousCheckpoint(): Promise<void> {
    this.autonomousCheckpoint = await this.autonomousCheckpointStore.load();
    this.autonomousResponderCursor = this.autonomousCheckpoint.cursor;
    this.autonomousResponderPendingCount = this.autonomousCheckpoint.lastPendingCount ?? 0;
    this.autonomousResponderLastRunAt = this.autonomousCheckpoint.lastRunAt ?? 0;
    this.autonomousResponseRecords = new Map(
      Object.entries(this.autonomousCheckpoint.records).map(([key, record]) => [key, { ...record }]),
    );
  }

  private async saveAutonomousCheckpoint(): Promise<void> {
    this.autonomousCheckpoint = {
      version: 1,
      cursor: this.autonomousResponderCursor,
      lastRunAt: this.autonomousResponderLastRunAt || undefined,
      lastPendingCount: this.autonomousResponderPendingCount,
      records: Object.fromEntries(this.autonomousResponseRecords.entries()),
    };
    await this.autonomousCheckpointStore.save(this.autonomousCheckpoint);
  }

  private async markAutonomousRecord(
    key: string,
    patch: Partial<AutonomousResponderRecord> & Pick<AutonomousResponderRecord, 'challengeId' | 'providerRole' | 'revealNonce'>,
  ): Promise<AutonomousResponderRecord> {
    const existing = this.autonomousResponseRecords.get(key);
    const next: AutonomousResponderRecord = {
      challengeId: patch.challengeId,
      providerRole: patch.providerRole,
      revealNonce: patch.revealNonce,
      status: patch.status ?? existing?.status ?? 'pending',
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      commitEventId: patch.commitEventId ?? existing?.commitEventId,
      revealEventId: patch.revealEventId ?? existing?.revealEventId,
      notePublishedAt: patch.notePublishedAt ?? existing?.notePublishedAt,
      lastError: patch.lastError ?? existing?.lastError,
    };
    this.autonomousResponseRecords.set(key, next);
    await this.saveAutonomousCheckpoint();
    return next;
  }

  private async runAutonomousResponderLoop(): Promise<void> {
    if (!this.autonomousResponderEnabled || this.autonomousResponderRunning) {
      return;
    }

    this.autonomousResponderRunning = true;
    this.autonomousResponderLastError = null;
    this.autonomousResponderLastRunAt = Date.now();

    try {
      const snapshot = await this.getSnapshot();
      const tasks: Array<{ challenge: PublishedFlowerEvent<ChallengeEventPayload>; providerRole: ProviderRole }> = [];
      let maxCreatedAt = this.autonomousResponderCursor.lastProcessedChallengeCreatedAt;

      for (const challengeView of snapshot.challenges) {
        maxCreatedAt = Math.max(maxCreatedAt, challengeView.challenge.createdAt);
        if (challengeView.settlement) {
          continue;
        }

        for (const providerRole of ['provider', 'provider2', 'provider3'] as const) {
          if (!this.inventoryByRole.get(providerRole)?.has(challengeView.challenge.payload.contentRef)) {
            continue;
          }

          const key = responseKey(challengeView.challenge.payload.challengeId, providerRole);
          const record = this.autonomousResponseRecords.get(key);
          if (record?.status === 'complete' && record.commitEventId && record.revealEventId) {
            continue;
          }

          tasks.push({ challenge: challengeView.challenge, providerRole });
        }
      }

      this.autonomousResponderPendingCount = tasks.length;
      this.autonomousResponderCursor = { lastProcessedChallengeCreatedAt: maxCreatedAt };
      await this.saveAutonomousCheckpoint();

      const orderedTasks = tasks.sort((left, right) => {
        if (left.challenge.createdAt !== right.challenge.createdAt) {
          return left.challenge.createdAt - right.challenge.createdAt;
        }
        return this.providerRoleRank(left.providerRole) - this.providerRoleRank(right.providerRole);
      });

      for (const task of orderedTasks) {
        const jitterMs = this.autonomousResponderJitterMs > 0
          ? this.calculateAutonomousResponderJitter(task.challenge.payload.challengeId, task.providerRole)
          : 0;
        if (jitterMs > 0) {
          await sleep(jitterMs);
        }

        try {
          await this.respondToChallenge(task.challenge.payload.challengeId, task.providerRole);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const key = responseKey(task.challenge.payload.challengeId, task.providerRole);
          const existing = this.autonomousResponseRecords.get(key);
          if (existing) {
            existing.lastError = message;
            existing.updatedAt = Date.now();
            this.autonomousResponseRecords.set(key, existing);
            await this.saveAutonomousCheckpoint();
          }
          this.autonomousResponderLastError = message;
          if (!message.includes('does not host')) {
            throw error;
          }
        }
      }

      this.autonomousResponderPendingCount = 0;
      this.autonomousResponderLastSuccessfulRunAt = Date.now();
      this.autonomousResponderLastError = null;
      await this.saveAutonomousCheckpoint();
    } finally {
      this.autonomousResponderRunning = false;
    }
  }

  private providerRoleRank(role: ProviderRole): number {
    if (role === 'provider2') return 1;
    if (role === 'provider3') return 2;
    return 0;
  }

  private calculateAutonomousResponderJitter(challengeId: string, providerRole: ProviderRole): number {
    const seedText = `${this.autonomousResponderInstanceSalt}:${challengeId}:${providerRole}`;
    let seed = 0;
    for (let index = 0; index < seedText.length; index += 1) {
      seed = (seed * 31 + seedText.charCodeAt(index)) >>> 0;
    }
    return 200 + (seed % this.autonomousResponderJitterMs);
  }

  addFunding(role: RuntimeIdentityView['role'], sats: number): void {
    if (!Number.isFinite(sats) || sats <= 0) {
      throw new Error('funding sats must be > 0');
    }
    const current = this.fundedMsatsByRole.get(role) ?? 0;
    this.fundedMsatsByRole.set(role, current + Math.round(sats * 1000));
  }

  async getSnapshot(): Promise<RuntimeSnapshot> {
    const events = await this.listEvents();
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
      peerTransfers: parsed.peerTransfers.slice().sort((a, b) => b.createdAt - a.createdAt),
    };
  }

  seedBlob(
    blobId: string,
    content: string,
    options?: { encoding?: 'utf8' | 'base64'; mimeType?: string; fileName?: string },
  ): BlossomFixture {
    const blob = createBlossomFixture(blobId, content, options);
    blob.envelope = buildBlobEnvelope(blob, this.owner, {
      provider: this.provider,
      provider2: this.provider2,
    });
    this.blossom.seed(blob);
    this.envelopeByCid.set(blob.contentRef, blob.envelope);
    this.cidToBlobId.set(blob.contentRef, blob.blobId);
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
    autoRespondProviders?: boolean;
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
    this.sessionChallengeIds.add(event.payload.challengeId);

    const challengeNoteId = await this.publishChallengeNote(event);

    if (input.autoRespondProviders) {
      const roles: ProviderRole[] = ['provider', 'provider2', 'provider3'];
      const seed = [...event.payload.challengeId].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
      const start = seed % roles.length;
      const ordered = [...roles.slice(start), ...roles.slice(0, start)];

      for (let i = 0; i < ordered.length; i += 1) {
        const role = ordered[i];
        try {
          await this.respondToChallenge(event.payload.challengeId, role, {
            publishProofReplyNote: true,
            challengeNoteId,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!message.includes('does not host')) {
            throw error;
          }
        }
        if (i < ordered.length - 1) {
          await sleep(250 + i * 250);
        }
      }
    }

    return event;
  }

  async respondToChallenge(
    challengeId: string,
    providerRole: ProviderRole = 'provider',
    options: { publishProofReplyNote?: boolean; challengeNoteId?: string | null } = {},
  ): Promise<{
    commit: PublishedFlowerEvent<CommitEventPayload>;
    reveal: PublishedFlowerEvent<RevealEventPayload>;
  }> {
    const key = responseKey(challengeId, providerRole);
    const inFlight = this.autonomousResponseInFlight.get(key);
    if (inFlight) {
      return inFlight;
    }

    const work = (async () => {
      const events = await this.listEvents({ challengeId });
      const challenge = events.find(
        (event): event is PublishedFlowerEvent<ChallengeEventPayload> => event.payload.type === 'challenge',
      );
      if (!challenge) {
        throw new Error(`Unknown challenge ${challengeId}`);
      }

      const responderSigner = this.signerForRole(providerRole);
      const existingRecord = this.autonomousResponseRecords.get(key);
      const existingCommit = events.find(
        (event): event is PublishedFlowerEvent<CommitEventPayload> =>
          event.payload.type === 'commit' &&
          event.payload.challengeId === challengeId &&
          event.payload.responder === responderSigner.npub,
      );
      const existingReveal = events.find(
        (event): event is PublishedFlowerEvent<RevealEventPayload> =>
          event.payload.type === 'reveal' &&
          event.payload.challengeId === challengeId &&
          event.payload.responder === responderSigner.npub,
      );

      if (existingCommit && existingReveal) {
        let record = existingRecord;
        if (!record || record.status !== 'complete') {
          record = await this.markAutonomousRecord(key, {
            challengeId,
            providerRole,
            revealNonce: existingReveal.payload.revealNonce,
            status: 'complete',
            commitEventId: existingCommit.id,
            revealEventId: existingReveal.id,
            notePublishedAt: existingRecord?.notePublishedAt,
          });
        }

        if (options.publishProofReplyNote && (!record.notePublishedAt || record.notePublishedAt === 0)) {
          await this.publishProofReplyNote(challenge, options.challengeNoteId ?? null, providerRole, existingReveal, existingCommit);
          await this.markAutonomousRecord(key, {
            challengeId,
            providerRole,
            revealNonce: existingReveal.payload.revealNonce,
            status: 'complete',
            commitEventId: existingCommit.id,
            revealEventId: existingReveal.id,
            notePublishedAt: Date.now(),
          });
        }

        return { commit: existingCommit, reveal: existingReveal };
      }

      const blobId = this.resolveBlobIdFromContentRef(challenge.payload.contentRef);
      const blob = await fetchBlossomObject(this.blossomBaseUrl, blobId);
      if (!this.inventoryByRole.get(providerRole)?.has(blob.contentRef)) {
        throw new Error(`${providerRole} does not host ${blob.contentRef}`);
      }

      const challengedLeafIndex = challenge.payload.leafIndex;
      const selectedLeaf = blob.leafProofs?.[challengedLeafIndex] ?? {
        leafHash: blob.sampleLeafHash,
        proof: blob.sampleProof,
      };

      const perfSeed = `${challengeId}:${providerRole}`;
      const perfHash = [...perfSeed].reduce((acc, ch, idx) => ((acc * 33) ^ (ch.charCodeAt(0) + idx)) >>> 0, 5381);
      const latencyMs = 45 + (perfHash % 85);
      const reliabilityScore = Number((0.92 + ((perfHash >> 8) % 80) / 1000).toFixed(4));

      const initialRecord =
        existingRecord ??
        (await this.markAutonomousRecord(key, {
          challengeId,
          providerRole,
          revealNonce: randomId('reveal'),
          status: 'pending',
        }));
      let record = initialRecord;

      let commit = existingCommit;
      if (!commit) {
        const commitTs = Math.floor(Date.now() / 1000);
        commit = await this.transport.publish(responderSigner, {
          type: 'commit',
          challengeId,
          responder: responderSigner.npub,
          commitHash: buildCommitHash(challengeId, responderSigner.npub, selectedLeaf.leafHash, record.revealNonce),
          commitTs,
        });
        record = await this.markAutonomousRecord(key, {
          challengeId,
          providerRole,
          revealNonce: record.revealNonce,
          status: 'pending',
          commitEventId: commit.id,
        });
      } else if (!record.commitEventId) {
        record = await this.markAutonomousRecord(key, {
          challengeId,
          providerRole,
          revealNonce: record.revealNonce,
          status: 'pending',
          commitEventId: commit.id,
        });
      }

      if (!commit) {
        throw new Error(`Missing commit for ${challengeId} / ${providerRole}`);
      }

      let reveal = existingReveal;
      if (!reveal) {
        reveal = await this.transport.publish(responderSigner, {
          type: 'reveal',
          challengeId,
          responder: responderSigner.npub,
          commitTs: commit.payload.commitTs,
          revealTs: commit.payload.commitTs + 1,
          latencyMs,
          reliabilityScore,
          leafHash: selectedLeaf.leafHash,
          proof: selectedLeaf.proof,
          expectedRoot: blob.merkleRoot,
          revealNonce: record.revealNonce,
        });
        record = await this.markAutonomousRecord(key, {
          challengeId,
          providerRole,
          revealNonce: record.revealNonce,
          status: 'complete',
          commitEventId: commit.id,
          revealEventId: reveal.id,
          notePublishedAt: record.notePublishedAt,
        });
      } else if (record.status !== 'complete') {
        record = await this.markAutonomousRecord(key, {
          challengeId,
          providerRole,
          revealNonce: record.revealNonce,
          status: 'complete',
          commitEventId: commit.id,
          revealEventId: reveal.id,
          notePublishedAt: record.notePublishedAt,
        });
      }

      if (options.publishProofReplyNote && (!record.notePublishedAt || record.notePublishedAt === 0)) {
        await this.publishProofReplyNote(challenge, options.challengeNoteId ?? null, providerRole, reveal, commit);
        record = await this.markAutonomousRecord(key, {
          challengeId,
          providerRole,
          revealNonce: record.revealNonce,
          status: 'complete',
          commitEventId: commit.id,
          revealEventId: reveal.id,
          notePublishedAt: Date.now(),
        });
      }

      return { commit, reveal };
    })();

    this.autonomousResponseInFlight.set(key, work);
    try {
      return await work;
    } finally {
      this.autonomousResponseInFlight.delete(key);
    }
  }

  async publishListing(input: {
    blobId: string;
    priceSats: number;
    deliveryDeadline: number;
    cooldownSeconds: number;
  }): Promise<PublishedFlowerEvent<MarketListingEventPayload>> {
    const blob = await fetchBlossomObject(this.blossomBaseUrl, input.blobId);

    const event = await this.transport.publish(this.owner, {
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
    this.sessionListingIds.add(event.payload.listingId);
    return event;
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
    const events = await this.listEvents();
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

    const blob = await fetchBlossomObject(this.blossomBaseUrl, this.resolveBlobIdFromContentRef(listingView.listing.payload.contentRef));

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

  async requestPeerTransfer(input: {
    blobId: string;
    fromRole: ProviderRole;
    toRole: ProviderRole;
    supplierFeeSats: number;
    transferFeeSats: number;
  }): Promise<PublishedFlowerEvent<PeerTransferEventPayload>> {
    if (input.fromRole === input.toRole) {
      throw new Error('fromRole and toRole must differ');
    }

    const blob = await fetchBlossomObject(this.blossomBaseUrl, input.blobId);
    const cid = blob.contentRef;
    if (!this.inventoryByRole.get(input.fromRole)?.has(cid)) {
      throw new Error(`${input.fromRole} does not host ${cid}`);
    }

    const sourceSigner = this.signerForRole(input.fromRole);
    const targetSigner = this.signerForRole(input.toRole);
    const envelope = this.getEnvelopeOrThrow(blob);
    const rewrappedEnvelope = rewrapBlobEnvelope(envelope, input.fromRole, input.toRole, sourceSigner, targetSigner, this.owner);
    const sourceWrap = envelope.wrapsByProvider[input.fromRole];
    if (!sourceWrap) {
      throw new Error(`missing peer wrap for ${input.fromRole}`);
    }
    const targetWrap = rewrappedEnvelope.wrapsByProvider[input.toRole];
    if (!targetWrap) {
      throw new Error(`missing peer wrap for ${input.toRole}`);
    }
    this.storeEnvelope(cid, rewrappedEnvelope);
    this.registerReplica(cid, input.toRole);

    const supplierFeeMsats = Math.max(0, Math.round(input.supplierFeeSats * 1000));
    const transferFeeMsats = Math.max(0, Math.round(input.transferFeeSats * 1000));

    const requester = this.owner.npub;
    const supplier = this.signerForRole(input.fromRole).npub;
    const target = this.signerForRole(input.toRole).npub;

    let supplierPaymentRef: string | undefined;
    let transferPaymentRef: string | undefined;
    let paymentStatus: PeerTransferEventPayload['paymentStatus'] = 'simulated';
    let paymentError: string | undefined;

    if (this.payoutAdapter instanceof NwcPayoutAdapter) {
      let supplierPaid = supplierFeeMsats <= 0;
      let transferPaid = transferFeeMsats <= 0;
      try {
        if (supplierFeeMsats > 0) {
          const supplierPay = await this.payoutAdapter.transferBetweenNpubs({
            fromNpub: requester,
            toNpub: supplier,
            amountMsats: supplierFeeMsats,
            memo: `peer supplier fee ${cid}`,
            settlementRef: cid,
          });
          supplierPaymentRef = supplierPay.tokenRef;
          supplierPaid = true;
        }
        if (transferFeeMsats > 0) {
          const transferPay = await this.payoutAdapter.transferBetweenNpubs({
            fromNpub: requester,
            toNpub: target,
            amountMsats: transferFeeMsats,
            memo: `peer transfer fee ${cid}`,
            settlementRef: cid,
          });
          transferPaymentRef = transferPay.tokenRef;
          transferPaid = true;
        }
      } catch (error) {
        paymentError = error instanceof Error ? error.message : String(error);
      }

      paymentStatus = supplierPaid && transferPaid ? 'paid' : supplierPaid || transferPaid ? 'partial' : 'failed';
    }

    this.bumpMarketFlow('owner', 'out', supplierFeeMsats + transferFeeMsats);
    this.bumpMarketFlow(input.fromRole, 'in', supplierFeeMsats);
    this.bumpMarketFlow(input.toRole, 'in', transferFeeMsats);

    const receipt: PeerTransferEventPayload = {
      type: 'peer.transfer',
      transferId: randomId('peer'),
      blobId: input.blobId,
      cid,
      contentRef: cid,
      merkleRoot: blob.merkleRoot,
      sourceRole: input.fromRole,
      targetRole: input.toRole,
      sourceNpub: supplier,
      targetNpub: target,
      requesterNpub: requester,
      supplierFeeMsats,
      transferFeeMsats,
      paymentStatus,
      supplierPaymentRef,
      transferPaymentRef,
      paymentError,
      sourceWrapFingerprint: sourceWrap.wrapKeyFingerprint,
      targetWrapFingerprint: targetWrap.wrapKeyFingerprint,
      targetReceivedRewrap: true,
      targetAckTs: Math.floor(Date.now() / 1000),
    };
    const event = await this.transport.publish(targetSigner, receipt);
    this.sessionPeerTransferIds.add(event.payload.transferId);
    await this.publishPeerTransferNote(event);
    return event;
  }

  private async publishPeerTransferNote(event: PublishedFlowerEvent<PeerTransferEventPayload>): Promise<string | null> {
    const note = await this.publishKind1Note(
      this.owner,
      [
        ['t', 'flower-market'],
        ['t', 'peer-transfer'],
        ['c', event.payload.transferId],
        ['r', event.payload.contentRef],
        ['p', event.payload.targetNpub],
      ],
      JSON.stringify({
        kind: 'flower-peer-transfer',
        transferId: event.payload.transferId,
        blobId: event.payload.blobId,
        sourceRole: event.payload.sourceRole,
        targetRole: event.payload.targetRole,
        sourceNpub: event.payload.sourceNpub,
        targetNpub: event.payload.targetNpub,
        requesterNpub: event.payload.requesterNpub,
        contentRef: event.payload.contentRef,
        cid: event.payload.cid,
        merkleRoot: event.payload.merkleRoot,
        sourceWrapFingerprint: event.payload.sourceWrapFingerprint,
        targetWrapFingerprint: event.payload.targetWrapFingerprint,
        targetReceivedRewrap: event.payload.targetReceivedRewrap,
        targetAckTs: event.payload.targetAckTs,
        supplierFeeMsats: event.payload.supplierFeeMsats,
        transferFeeMsats: event.payload.transferFeeMsats,
        paymentStatus: event.payload.paymentStatus,
        supplierPaymentRef: event.payload.supplierPaymentRef ?? null,
        transferPaymentRef: event.payload.transferPaymentRef ?? null,
        paymentError: event.payload.paymentError ?? null,
        peerTransferEventId: event.id,
        peerTransferPubkey: event.pubkey,
      }),
    );

    return note?.id ?? null;
  }

  async retrieveBlobViaProvider(input: {
    blobId: string;
    fromRole: ProviderRole;
  }): Promise<RetrievedBlobView> {
    const blob = await fetchBlossomObject(this.blossomBaseUrl, input.blobId);
    const cid = blob.contentRef;
    if (!this.inventoryByRole.get(input.fromRole)?.has(cid)) {
      throw new Error(`${input.fromRole} does not host ${cid}`);
    }

    const envelope = this.getEnvelopeOrThrow(blob);
    const decrypted = decryptBlobEnvelope(envelope, input.fromRole, this.signerForRole(input.fromRole), this.owner);
    const providerNpub = this.signerForRole(input.fromRole).npub;
    return {
      blobId: blob.blobId,
      cid,
      fromRole: input.fromRole,
      providerNpub,
      plaintextPayload: decrypted.plaintextPayload,
      deliveredCiphertext: decrypted.plaintextPayload,
      encoding: blob.encoding,
      mimeType: blob.mimeType,
      fileName: blob.fileName,
      transportNote: `${roleName(input.fromRole)} decrypted its provider-wrap, recovered the DO ciphertext, then DO decrypt recovered the plaintext payload.`,
      envelope,
    };
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

      try {
        const blob = await fetchBlossomObject(
          this.blossomBaseUrl,
          this.resolveBlobIdFromContentRef(challengeView.challenge.payload.contentRef),
        );
        await settlePublishedChallenge(this.transport, this.settler, challengeView.challenge, blob, undefined, undefined, this.payoutAdapter);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('Failed to fetch Blossom blob') || message.includes('Unknown contentRef for Blossom lookup')) {
          this.logRateLimited(`missing-blob:${challengeView.challenge.payload.challengeId}`, 'Skipping challenge settlement; blob unavailable locally', message);
          continue;
        }
        throw error;
      }
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
    return [...this.replicaRootsByCid.entries()].map(([cid, roots]) => {
      const envelope = this.envelopeByCid.get(cid);
      const storedCidByProvider: Partial<Record<ProviderRole, string>> = {};
      if (envelope) {
        (['provider', 'provider2', 'provider3'] as ProviderRole[]).forEach((role) => {
          const wrap = envelope.wrapsByProvider[role];
          if (wrap) {
            storedCidByProvider[role] = `cid:${hashLeaf(wrap.wrappedDoCiphertext)}`;
          }
        });
      }

      return {
        cid,
        rootsByProvider: Object.fromEntries([...roots.entries()]),
        storedCidByProvider,
      };
    });
  }

  private registerReplica(cid: string, role: ProviderRole): void {
    const roots = this.replicaRootsByCid.get(cid) ?? new Map<ProviderRole, string>();
    roots.set(role, hashLeaf(`${cid}:${role}`));
    this.replicaRootsByCid.set(cid, roots);
    this.inventoryByRole.get(role)?.add(cid);
  }

  private getEnvelopeOrThrow(blob: BlossomFixture) {
    const storedEnvelope = this.envelopeByCid.get(blob.contentRef);
    if (storedEnvelope) {
      blob.envelope = storedEnvelope ?? undefined;
      return storedEnvelope;
    }

    if (blob.envelope) {
      this.envelopeByCid.set(blob.contentRef, blob.envelope);
      return blob.envelope;
    }

    const envelope = buildBlobEnvelope(blob, this.owner, {
      provider: this.provider,
      provider2: this.provider2,
    });
    blob.envelope = envelope;
    this.envelopeByCid.set(blob.contentRef, envelope);
    this.syncEnvelopeAcrossBlobs(blob.contentRef, envelope);

    return envelope;
  }

  private storeEnvelope(cid: string, envelope: NonNullable<BlossomFixture['envelope']>): void {
    this.envelopeByCid.set(cid, envelope);
    this.syncEnvelopeAcrossBlobs(cid, envelope);
  }

  private syncEnvelopeAcrossBlobs(cid: string, envelope: NonNullable<BlossomFixture['envelope']>): void {
    for (const fixture of this.blossom.list()) {
      if (fixture.contentRef === cid) {
        fixture.envelope = envelope;
      }
    }
  }

  private resolveBlobIdFromContentRef(contentRef: string): string {
    if (contentRef.startsWith('blossom:')) {
      return contentRef.slice('blossom:'.length);
    }

    const fromMap = this.cidToBlobId.get(contentRef);
    if (fromMap) return fromMap;

    const fixture = this.blossom.list().find((entry) => entry.contentRef === contentRef);
    if (fixture) {
      this.cidToBlobId.set(contentRef, fixture.blobId);
      return fixture.blobId;
    }

    throw new Error(`Unknown contentRef for Blossom lookup: ${contentRef}`);
  }

  private signerForRole(role: ProviderRole): RuntimeSigner {
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
    if (!this.nwcBalancePolling) return;
    if (!(this.payoutAdapter instanceof NwcPayoutAdapter)) return;
    if (this.nwcBalancePollInFlight) return;

    const now = Date.now();
    const effectiveInterval = this.nwcBalancePollIntervalMs + this.nwcBalancePollBackoffMs;
    if (now - this.lastNwcBalancePollAt < effectiveInterval) return;

    this.nwcBalancePollInFlight = true;
    this.lastNwcBalancePollAt = now;

    this.payoutAdapter
      .getBalanceMsatsByNpub()
      .then((balances) => {
        this.liveNwcBalancesByNpub = balances;
        this.nwcBalancePollBackoffMs = 0;
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.nwcBalancePollBackoffMs = Math.min(
          this.nwcBalancePollBackoffMs > 0 ? this.nwcBalancePollBackoffMs * 2 : this.nwcBalancePollIntervalMs,
          this.nwcBalancePollMaxBackoffMs,
        );
        this.logRateLimited(
          `nwc-balance:${message}`,
          `flower-runtime: failed to poll NWC balances (backoff ${Math.round(this.nwcBalancePollBackoffMs / 1000)}s)`,
          error,
        );
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
