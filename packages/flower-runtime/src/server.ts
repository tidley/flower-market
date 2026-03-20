import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { createBlossomFixture } from './blossom.ts';
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
  const requestedPort = config.httpPort ?? 8787;

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

      if (request.method === 'GET' && url.pathname === '/api/events') {
        json(response, 200, await daemon.getEvents());
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/messages') {
        json(response, 200, daemon.getPublishedMessages());
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/blobs') {
        const body = await readJson<{ blobId?: string; content: string }>(request);
        const requestedBlobId = body.blobId ?? `blob_${Date.now()}`;
        const candidate = createBlossomFixture(requestedBlobId, body.content);
        const existing = daemon.listBlobs().find((entry) => entry.contentRef === candidate.contentRef);

        if (existing) {
          json(response, 200, {
            ...existing,
            deduped: true,
            requestedBlobId,
            existingBlobId: existing.blobId,
            message: `The file (${requestedBlobId}) is already stored as (${existing.blobId}) with CID ${existing.contentRef}.`,
          });
          return;
        }

        const blob = daemon.seedBlob(requestedBlobId, body.content);
        json(response, 200, { ...blob, deduped: false, requestedBlobId, existingBlobId: null });
        return;
      }

      if (request.method === 'GET' && url.pathname.startsWith('/api/blobs/')) {
        const blobId = decodeURIComponent(url.pathname.slice('/api/blobs/'.length));
        const blob = daemon.listBlobs().find((entry) => entry.blobId === blobId);
        if (!blob) {
          json(response, 404, { error: 'blob not found', blobId });
          return;
        }
        json(response, 200, blob);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/retrieve') {
        const body = await readJson<{ blobId: string; fromRole: 'provider' | 'provider2' | 'provider3' }>(request);
        json(response, 200, await daemon.retrieveBlobViaProvider(body));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/funding') {
        const body = await readJson<{ role: 'owner' | 'provider' | 'provider2' | 'provider3' | 'settler'; sats: number }>(request);
        daemon.addFunding(body.role, body.sats);
        json(response, 200, await daemon.getSnapshot());
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/challenges') {
        const body = await readJson<{
          blobId: string;
          payoutSchedule: [number, number, number];
          reliabilityBonusMsats: number;
          commitLeadSeconds: number;
          revealLeadSeconds: number;
          autoRespondProviders?: boolean;
        }>(request);
        json(response, 200, await daemon.publishChallenge(body));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/challenges/respond') {
        const body = await readJson<{ challengeId: string; providerRole?: 'provider' | 'provider2' | 'provider3' }>(request);
        const result = await daemon.respondToChallenge(body.challengeId, body.providerRole ?? 'provider');
        await daemon.tick();
        json(response, 200, result);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/stall/transfers') {
        const body = await readJson<{
          blobId: string;
          fromRole: 'provider' | 'provider2' | 'provider3';
          toRole: 'provider' | 'provider2' | 'provider3';
          supplierFeeSats: number;
          stallFeeSats: number;
        }>(request);
        json(response, 200, await daemon.requestTransferViaStall(body));
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

  let port: number;
  try {
    port = await listenOnAvailablePort(server, requestedPort);
  } catch (error) {
    await daemon.stop();
    throw error;
  }

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

async function listenOnAvailablePort(server: ReturnType<typeof createServer>, requestedPort: number): Promise<number> {
  for (let port = requestedPort; port <= 65_535; port += 1) {
    try {
      return await new Promise<number>((resolve, reject) => {
        const onError = (error: Error) => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.off('error', onError);
          const address = server.address();
          if (!address || typeof address === 'string') {
            reject(new Error('Failed to start daemon server'));
            return;
          }
          resolve(address.port);
        };

        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, '127.0.0.1');
      });
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? (error as { code?: string }).code : undefined;
      if (code === 'EADDRINUSE') {
        continue;
      }
      throw error;
    }
  }

  throw new Error(`No available TCP port found on 127.0.0.1 starting at ${requestedPort}`);
}
