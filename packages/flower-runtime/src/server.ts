import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { FlowerDaemon, type FlowerDaemonConfig } from './daemon.ts';

function json(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Uint8Array);
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
}

export interface FlowerDaemonServerHandle {
  daemon: FlowerDaemon;
  port: number;
  close(): Promise<void>;
}

export async function startFlowerDaemonServer(config: FlowerDaemonConfig = {}): Promise<FlowerDaemonServerHandle> {
  const daemon = new FlowerDaemon(config);
  await daemon.start(config.blossomPort ?? 0);

  const server = createServer(async (request, response) => {
    try {
      if (!request.url) {
        json(response, 400, { error: 'missing url' });
        return;
      }

      const url = new URL(request.url, 'http://127.0.0.1');

      if (request.method === 'GET' && url.pathname === '/api/state') {
        json(response, 200, await daemon.getSnapshot());
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/blobs') {
        const body = await readJson<{ blobId?: string; content: string }>(request);
        const blob = daemon.seedBlob(body.blobId ?? `blob_${Date.now()}`, body.content);
        json(response, 200, blob);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/challenges') {
        const body = await readJson<{
          blobId: string;
          payoutSchedule: [number, number, number];
          reliabilityBonusMsats: number;
          commitLeadSeconds: number;
          revealLeadSeconds: number;
        }>(request);
        json(response, 200, await daemon.publishChallenge(body));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/challenges/respond') {
        const body = await readJson<{ challengeId: string }>(request);
        const result = await daemon.respondToChallenge(body.challengeId);
        await daemon.tick();
        json(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/listings') {
        const body = await readJson<{
          blobId: string;
          priceSats: number;
          deliveryDeadline: number;
          cooldownSeconds: number;
        }>(request);
        json(response, 200, await daemon.publishListing(body));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/offers') {
        const body = await readJson<{ listingId: string }>(request);
        json(response, 200, await daemon.publishOffer(body.listingId));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/accepts') {
        const body = await readJson<{ offerId: string }>(request);
        json(response, 200, await daemon.publishAccept(body.offerId));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/transfer-proofs') {
        const body = await readJson<{ transferId: string }>(request);
        const proof = await daemon.publishTransferProof(body.transferId);
        await daemon.tick();
        json(response, 200, proof);
        return;
      }

      json(response, 404, { error: 'not found' });
    } catch (error) {
      json(response, 500, { error: error instanceof Error ? error.message : 'unknown error' });
    }
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.httpPort ?? 8787, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to start daemon server'));
        return;
      }
      resolve(address.port);
    });
  });

  return {
    daemon,
    port,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      await daemon.stop();
    },
  };
}
