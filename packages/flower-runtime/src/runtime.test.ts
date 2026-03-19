import { afterEach, describe, expect, it } from 'vitest';

import { createBlossomFixture, DummyBlossomServer, fetchBlossomObject } from './blossom.ts';
import { createRuntimeSigner } from './crypto.ts';
import { MemoryRelayTransport } from './relay.ts';
import { runAutonomousRound, summarizeRound } from './runtime.ts';

describe('flower-runtime', () => {
  const servers: DummyBlossomServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => server.stop()));
    servers.length = 0;
  });

  it('serves deterministic dummy blossom fixtures', async () => {
    const server = new DummyBlossomServer([createBlossomFixture('blob_a', 'hello blossom')]);
    servers.push(server);
    const port = await server.start();

    const object = await fetchBlossomObject(`http://127.0.0.1:${port}`, 'blob_a');

    expect(object.contentRef.startsWith('cid:')).toBe(true);
    expect(object.leafHash).toBe(object.merkleRoot);
    expect(object.sampleProof).toEqual([]);
  });

  it('runs an autonomous challenge round and publishes settlement output', async () => {
    const server = new DummyBlossomServer([createBlossomFixture('blob_demo', 'round payload')]);
    servers.push(server);
    const port = await server.start();
    const transport = new MemoryRelayTransport();

    const result = await runAutonomousRound(
      transport,
      `http://127.0.0.1:${port}`,
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
});
