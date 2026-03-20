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

  it('exposes runtime state through the request helper', async () => {
    const handle = await startFlowerDaemonServer({ httpPort: 0, syncIntervalMs: 50 });
    cleanup.push(() => handle.close());

    const state = await handle.request('/api/state').then((response) =>
      response.json() as Promise<{ identities: Array<{ role: string }>; blobs: Array<{ blobId: string }> }>,
    );

    expect(state.identities.some((identity) => identity.role === 'provider')).toBe(true);
    expect(state.blobs).toHaveLength(0);
  });

  it('deduplicates seed blob uploads by CID and returns a duplicate notice', async () => {
    const handle = await startFlowerDaemonServer({ httpPort: 0, syncIntervalMs: 50 });
    cleanup.push(() => handle.close());

    const first = await handle.request('/api/blobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blobId: 'first-name', content: 'same payload' }),
    }).then((response) =>
      response.json() as Promise<{ deduped?: boolean; blobId: string; contentRef: string }>,
    );

    const second = await handle.request('/api/blobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blobId: 'second-name', content: 'same payload' }),
    }).then((response) =>
      response.json() as Promise<{ deduped?: boolean; existingBlobId?: string; requestedBlobId?: string; contentRef: string; message?: string }>,
    );

    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(second.existingBlobId).toBe('first-name');
    expect(second.requestedBlobId).toBe('second-name');
    expect(second.contentRef).toBe(first.contentRef);
    expect(second.message).toContain('already stored');

    const state = await handle.request('/api/state').then((response) =>
      response.json() as Promise<{ blobs: Array<{ blobId: string; contentRef: string }> }>,
    );
    expect(state.blobs).toHaveLength(1);
    expect(state.blobs[0]?.blobId).toBe('first-name');
  });
});
