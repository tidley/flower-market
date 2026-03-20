import { createServer } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { startFlowerDaemonServer } from './server.ts';

describe('startFlowerDaemonServer', () => {
  const cleanup: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(
      cleanup.splice(0).reverse().map(async (close) => {
        await close();
      }),
    );
  });

  it('binds to the requested port when it is available', async () => {
    const handle = await startFlowerDaemonServer({ httpPort: 18787, syncIntervalMs: 50 });
    cleanup.push(() => handle.close());

    expect(handle.port).toBe(18787);
  });

  it('falls back to the next port when the requested port is already occupied', async () => {
    const foreignServer = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('occupied');
    });

    await new Promise<void>((resolve, reject) => {
      foreignServer.listen(18788, '127.0.0.1', () => resolve());
      foreignServer.once('error', reject);
    });
    cleanup.push(
      () =>
        new Promise<void>((resolve, reject) => {
          foreignServer.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        }),
    );

    const handle = await startFlowerDaemonServer({ httpPort: 18788, syncIntervalMs: 50 });
    cleanup.push(() => handle.close());

    expect(handle.port).toBeGreaterThan(18788);
  });

  it('deduplicates seed blob uploads by CID and returns a duplicate notice', async () => {
    const handle = await startFlowerDaemonServer({ httpPort: 0, syncIntervalMs: 50 });
    cleanup.push(() => handle.close());

    const base = `http://127.0.0.1:${handle.port}`;

    const first = await fetch(`${base}/api/blobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blobId: 'first-name', content: 'same payload' }),
    }).then((r) => r.json() as Promise<{ deduped?: boolean; blobId: string; contentRef: string }>);

    const second = await fetch(`${base}/api/blobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blobId: 'second-name', content: 'same payload' }),
    }).then((r) => r.json() as Promise<{ deduped?: boolean; existingBlobId?: string; requestedBlobId?: string; contentRef: string; message?: string }>);

    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(second.existingBlobId).toBe('first-name');
    expect(second.requestedBlobId).toBe('second-name');
    expect(second.contentRef).toBe(first.contentRef);
    expect(second.message).toContain('already stored');

    const state = await fetch(`${base}/api/state`).then((r) => r.json() as Promise<{ blobs: Array<{ blobId: string; contentRef: string }> }>);
    expect(state.blobs).toHaveLength(1);
    expect(state.blobs[0]?.blobId).toBe('first-name');
  });
});
