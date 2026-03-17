import { beforeEach, describe, expect, it, vi } from 'vitest';

const publishMock = vi.fn(() => [] as Promise<unknown>[]);
const querySyncMock = vi.fn(async () => []);
const closeMock = vi.fn();

vi.mock('nostr-tools', () => {
  return {
    finalizeEvent: (evt: Record<string, unknown>) => ({
      id: 'evt_test',
      kind: evt.kind,
      pubkey: 'pub_test',
      created_at: evt.created_at,
      content: evt.content,
      tags: evt.tags,
    }),
    SimplePool: class {
      publish = publishMock;
      querySync = querySyncMock;
      close = closeMock;
    },
  };
});

import { NostrRelayTransport } from './relay.ts';

const signer = {
  secretKey: new Uint8Array(32),
  publicKey: 'pub',
  npub: 'npub1demo000000000000000000000000000000000000000000000000000000',
};

describe('NostrRelayTransport kind mode', () => {
  beforeEach(() => {
    publishMock.mockClear();
    querySyncMock.mockClear();
    closeMock.mockClear();
  });

  it('publishes as kind 1 when forceKind1=true', async () => {
    const transport = new NostrRelayTransport(['wss://nos.lol'], 1500, true);
    await transport.publish(signer, {
      type: 'challenge',
      challengeId: 'ch_1',
      epoch: 1,
      contentRef: 'blossom:demo',
      merkleRoot: 'abc',
      leafIndex: 0,
      nonce: 'n',
      commitDeadline: 1,
      revealDeadline: 2,
      payoutSchedule: [15, 10, 5],
      reliabilityBonusMsats: 1000,
    });

    const raw = publishMock.mock.calls[0][1];
    expect(raw.kind).toBe(1);
  });

  it('publishes protocol kind when forceKind1=false', async () => {
    const transport = new NostrRelayTransport(['wss://nos.lol'], 1500, false);
    await transport.publish(signer, {
      type: 'challenge',
      challengeId: 'ch_2',
      epoch: 1,
      contentRef: 'blossom:demo',
      merkleRoot: 'abc',
      leafIndex: 0,
      nonce: 'n',
      commitDeadline: 1,
      revealDeadline: 2,
      payoutSchedule: [15, 10, 5],
      reliabilityBonusMsats: 1000,
    });

    const raw = publishMock.mock.calls[0][1];
    expect(raw.kind).toBe(33001);
  });
});
