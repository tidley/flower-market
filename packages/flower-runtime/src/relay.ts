import { finalizeEvent, SimplePool } from 'nostr-tools';

import { stableStringify } from '../../flower-contextvm/src/index.ts';
import { FLOWER_EVENT_KINDS } from './types.ts';
import type { FlowerPayload, PublishedFlowerEvent, RelayFilter, RuntimeSigner } from './types.ts';

function kindForPayload(payload: FlowerPayload, forceKind1 = false): number {
  if (forceKind1) return 1;
  switch (payload.type) {
    case 'challenge':
      return FLOWER_EVENT_KINDS.challenge;
    case 'commit':
      return FLOWER_EVENT_KINDS.commit;
    case 'reveal':
      return FLOWER_EVENT_KINDS.reveal;
    case 'settlement':
      return FLOWER_EVENT_KINDS.settlement;
    case 'market.listing':
      return FLOWER_EVENT_KINDS.marketListing;
    case 'market.offer':
      return FLOWER_EVENT_KINDS.marketOffer;
    case 'market.accept':
      return FLOWER_EVENT_KINDS.marketAccept;
    case 'market.transfer_proof':
      return FLOWER_EVENT_KINDS.marketTransferProof;
    case 'market.settlement':
      return FLOWER_EVENT_KINDS.marketSettlement;
  }
}

function matchesFilter(event: PublishedFlowerEvent, filter: RelayFilter): boolean {
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
  if (filter.type && event.payload.type !== filter.type) return false;

  if ('challengeId' in event.payload && filter.challengeId && event.payload.challengeId !== filter.challengeId) {
    return false;
  }

  return true;
}

function encodeEvent<T extends FlowerPayload>(
  signer: RuntimeSigner,
  payload: T,
  now = Math.floor(Date.now() / 1000),
  forceKind1 = false,
) {
  const tags = [['t', 'flower-market'], ['f', payload.type]];
  if ('challengeId' in payload) {
    tags.push(['c', payload.challengeId]);
  }

  return finalizeEvent(
    {
      kind: kindForPayload(payload, forceKind1),
      created_at: now,
      tags,
      content: stableStringify(payload),
    },
    signer.secretKey,
  );
}

function decodeEvent(raw: {
  id: string;
  kind: number;
  pubkey: string;
  created_at: number;
  content: string;
}): PublishedFlowerEvent | null {
  try {
    const payload = JSON.parse(raw.content) as FlowerPayload;
    if (!payload || typeof payload !== 'object' || !('type' in payload)) {
      return null;
    }

    return {
      id: raw.id,
      kind: raw.kind,
      pubkey: raw.pubkey,
      createdAt: raw.created_at,
      payload,
      raw,
    };
  } catch {
    return null;
  }
}

export interface RelayTransport {
  publish<T extends FlowerPayload>(signer: RuntimeSigner, payload: T): Promise<PublishedFlowerEvent<T>>;
  list(filter?: RelayFilter): Promise<PublishedFlowerEvent[]>;
  close(): Promise<void>;
}

export class MemoryRelayTransport implements RelayTransport {
  private events: PublishedFlowerEvent[] = [];

  async publish<T extends FlowerPayload>(signer: RuntimeSigner, payload: T): Promise<PublishedFlowerEvent<T>> {
    const raw = encodeEvent(signer, payload);
    const decoded = decodeEvent(raw) as PublishedFlowerEvent<T> | null;
    if (!decoded) {
      throw new Error('Failed to decode in-memory flower event');
    }
    this.events.push(decoded);
    return decoded;
  }

  async list(filter: RelayFilter = {}): Promise<PublishedFlowerEvent[]> {
    return this.events.filter((event) => matchesFilter(event, filter));
  }

  async close(): Promise<void> {}
}

export class NostrRelayTransport implements RelayTransport {
  private pool = new SimplePool();
  private relays: string[];
  private maxWaitMs: number;
  private forceKind1: boolean;
  private localPublished: PublishedFlowerEvent[] = [];

  constructor(relays: string[], maxWaitMs = 1500, forceKind1 = false) {
    this.relays = relays;
    this.maxWaitMs = maxWaitMs;
    this.forceKind1 = forceKind1;
  }

  async publish<T extends FlowerPayload>(signer: RuntimeSigner, payload: T): Promise<PublishedFlowerEvent<T>> {
    const raw = encodeEvent(signer, payload, Math.floor(Date.now() / 1000), this.forceKind1);
    const publishResults = this.pool.publish(this.relays, raw);
    await Promise.allSettled(publishResults);

    const decoded = decodeEvent(raw) as PublishedFlowerEvent<T> | null;
    if (!decoded) {
      throw new Error('Failed to decode published flower event');
    }

    this.localPublished.push(decoded);
    return decoded;
  }

  async list(filter: RelayFilter = {}): Promise<PublishedFlowerEvent[]> {
    const kinds = filter.kinds && filter.kinds.length > 0 ? filter.kinds : (this.forceKind1 ? [1] : Object.values(FLOWER_EVENT_KINDS));
    const relayFilter = { kinds, limit: 200, '#t': ['flower-market'] };
    const events = await this.pool.querySync(this.relays, relayFilter as any, { maxWait: this.maxWaitMs });
    const remote = events.map(decodeEvent).filter((event): event is PublishedFlowerEvent => Boolean(event));

    const mergedById = new Map<string, PublishedFlowerEvent>();
    for (const event of [...this.localPublished, ...remote]) {
      mergedById.set(event.id, event);
    }

    return Array.from(mergedById.values()).filter((event) => matchesFilter(event, filter));
  }

  async close(): Promise<void> {
    this.pool.close(this.relays);
  }
}
