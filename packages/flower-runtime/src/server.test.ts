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
});
