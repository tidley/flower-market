import { afterEach, describe, expect, it } from 'vitest';

import { createBlossomFixture, DummyBlossomServer, fetchBlossomObject } from './blossom.ts';
import { createRuntimeSigner } from './crypto.ts';
import { MemoryRelayTransport } from './relay.ts';
import { runAutonomousRound, settlePublishedChallenge, summarizeRound } from './runtime.ts';
import type { PayoutAdapter } from '../../flower-payout/src/index.ts';

describe('flower-runtime', () => {
  const servers: DummyBlossomServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => server.stop()));
    servers.length = 0;
  });

  it('serves deterministic dummy blossom fixtures', async () => {
    const server = new DummyBlossomServer([createBlossomFixture('blob_a', 'hello blossom')]);
    servers.push(server);
    await server.start();

    const object = await fetchBlossomObject(server.getBaseUrl(), 'blob_a');

    expect(object.contentRef.startsWith('cid:')).toBe(true);
    expect(object.leafHash).toBe(object.merkleRoot);
    expect(object.sampleProof).toEqual([]);
  });

  it('runs an autonomous challenge round and publishes settlement output', async () => {
    const server = new DummyBlossomServer([createBlossomFixture('blob_demo', 'round payload')]);
    servers.push(server);
    await server.start();
    const transport = new MemoryRelayTransport();

    const result = await runAutonomousRound(
      transport,
      server.getBaseUrl(),
      {
        owner: createRuntimeSigner(),
        responder: createRuntimeSigner(),
        settler: createRuntimeSigner(),
      },
      {
        blobId: 'blob_demo',
        challengeId: 'ch_demo',
      },
    );

    const events = await transport.list({ challengeId: 'ch_demo' });

    expect(events).toHaveLength(4);
    expect(result.settlement.payload.winners).toHaveLength(1);
    expect(result.settlement.payload.winners[0]?.rank).toBe(1);
    expect(result.settlement.payload.winners[0]?.baseSats).toBe(15);
    expect(result.settlement.payload.excluded).toEqual([]);
    expect(summarizeRound(result)).toContain('relaySettlementEventId');

    await transport.close();
  });

  it('does not fail settlement when payout adapter cannot map a winner', async () => {
    const server = new DummyBlossomServer([createBlossomFixture('blob_unmapped', 'round payload')]);
    servers.push(server);
    await server.start();
    const transport = new MemoryRelayTransport();

    const owner = createRuntimeSigner();
    const responder = createRuntimeSigner();
    const settler = createRuntimeSigner();

    const result = await runAutonomousRound(
      transport,
      server.getBaseUrl(),
      { owner, responder, settler },
      { blobId: 'blob_unmapped', challengeId: 'ch_unmapped' },
    );

    const payoutAdapter: PayoutAdapter = {
      kind: 'lightning',
      quote: async () => ({ mintUrl: 'lightning:nwc', amountMsats: 1000, feeMsats: 0, totalMsats: 1000 }),
      execute: async () => {
        throw new Error('No NWC recipient mapping for npub_test');
      },
      verify: async () => true,
    };

    const settlement = await settlePublishedChallenge(
      transport,
      settler,
      result.challenge,
      result.blossom,
      result.commit,
      result.reveal,
      payoutAdapter,
    );

    expect(settlement.payload.winners).toHaveLength(1);
    expect(settlement.payload.payoutReceipts ?? []).toHaveLength(0);
    expect(settlement.payload.excluded.some((entry) => entry.includes('payout_failed:'))).toBe(true);

    await transport.close();
  });
});
