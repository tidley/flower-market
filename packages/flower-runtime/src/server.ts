import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

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

async function readJsonFromBody<T>(body: unknown): Promise<T> {
  if (typeof body === 'string') {
    return JSON.parse(body) as T;
  }

  if (body instanceof Uint8Array) {
    return JSON.parse(Buffer.from(body).toString('utf8')) as T;
  }

  return body as T;
}

type DaemonApiRequest = {
  method: string;
  pathname: string;
  body?: unknown;
};

async function dispatchDaemonRequest(daemon: FlowerDaemon, request: DaemonApiRequest): Promise<Response> {
  try {
    if (request.method === 'GET' && request.pathname === '/api/state') {
      return jsonResponse(200, await daemon.getSnapshot());
    }

    if (request.method === 'GET' && request.pathname === '/api/status') {
      return jsonResponse(200, await daemon.getStatus());
    }

    if (request.method === 'GET' && request.pathname === '/api/events') {
      return jsonResponse(200, await daemon.getEvents());
    }

    if (request.method === 'GET' && request.pathname === '/api/messages') {
      return jsonResponse(200, daemon.getPublishedMessages());
    }

    if (request.method === 'POST' && request.pathname === '/api/blobs') {
      const body = await readJsonFromBody<{
        blobId?: string;
        content: string;
        encoding?: 'utf8' | 'base64';
        mimeType?: string;
        fileName?: string;
      }>(request.body);
      const requestedBlobId = body.blobId ?? `blob_${Date.now()}`;
      const candidate = createBlossomFixture(requestedBlobId, body.content, {
        encoding: body.encoding,
        mimeType: body.mimeType,
        fileName: body.fileName,
      });
      const existing = daemon.listBlobs().find((entry) => entry.contentRef === candidate.contentRef);

      if (existing) {
        return jsonResponse(200, {
          ...existing,
          deduped: true,
          requestedBlobId,
          existingBlobId: existing.blobId,
          message: `The file (${requestedBlobId}) is already stored as (${existing.blobId}) with CID ${existing.contentRef}.`,
        });
      }

      const blob = daemon.seedBlob(requestedBlobId, body.content, {
        encoding: body.encoding,
        mimeType: body.mimeType,
        fileName: body.fileName,
      });
      return jsonResponse(200, { ...blob, deduped: false, requestedBlobId, existingBlobId: null });
    }

    if (request.method === 'GET' && request.pathname.startsWith('/api/blobs/')) {
      const blobId = decodeURIComponent(request.pathname.slice('/api/blobs/'.length));
      const blob = daemon.listBlobs().find((entry) => entry.blobId === blobId);
      if (!blob) {
        return jsonResponse(404, { error: 'blob not found', blobId });
      }
      return jsonResponse(200, blob);
    }

    if (request.method === 'POST' && request.pathname === '/api/retrieve') {
      const body = await readJsonFromBody<{ blobId: string; fromRole: 'provider' | 'provider2' | 'provider3' }>(request.body);
      return jsonResponse(200, await daemon.retrieveBlobViaProvider(body));
    }

    if (request.method === 'POST' && request.pathname === '/api/funding') {
      const body = await readJsonFromBody<{ role: 'owner' | 'provider' | 'provider2' | 'provider3' | 'settler'; sats: number }>(request.body);
      daemon.addFunding(body.role, body.sats);
      return jsonResponse(200, await daemon.getSnapshot());
    }

    if (request.method === 'POST' && request.pathname === '/api/challenges') {
      const body = await readJsonFromBody<{
        blobId: string;
        payoutSchedule: [number, number, number];
        reliabilityBonusMsats: number;
        commitLeadSeconds: number;
        revealLeadSeconds: number;
        autoRespondProviders?: boolean;
      }>(request.body);
      return jsonResponse(200, await daemon.publishChallenge(body));
    }

    if (request.method === 'POST' && request.pathname === '/api/challenges/respond') {
      const body = await readJsonFromBody<{ challengeId: string; providerRole?: 'provider' | 'provider2' | 'provider3' }>(request.body);
      const result = await daemon.respondToChallenge(body.challengeId, body.providerRole ?? 'provider');
      await daemon.tick();
      return jsonResponse(200, result);
    }

    if (request.method === 'POST' && request.pathname === '/api/peer/transfers') {
      const body = await readJsonFromBody<{
        blobId: string;
        fromRole: 'provider' | 'provider2' | 'provider3';
        toRole: 'provider' | 'provider2' | 'provider3';
        supplierFeeSats: number;
        transferFeeSats: number;
      }>(request.body);
      return jsonResponse(200, await daemon.requestPeerTransfer(body));
    }

    if (request.method === 'POST' && request.pathname === '/api/listings') {
      const body = await readJsonFromBody<{
        blobId: string;
        priceSats: number;
        deliveryDeadline: number;
        cooldownSeconds: number;
      }>(request.body);
      return jsonResponse(200, await daemon.publishListing(body));
    }

    if (request.method === 'POST' && request.pathname === '/api/offers') {
      const body = await readJsonFromBody<{ listingId: string }>(request.body);
      return jsonResponse(200, await daemon.publishOffer(body.listingId));
    }

    if (request.method === 'POST' && request.pathname === '/api/accepts') {
      const body = await readJsonFromBody<{ offerId: string }>(request.body);
      return jsonResponse(200, await daemon.publishAccept(body.offerId));
    }

    if (request.method === 'POST' && request.pathname === '/api/transfer-proofs') {
      const body = await readJsonFromBody<{ transferId: string }>(request.body);
      const proof = await daemon.publishTransferProof(body.transferId);
      await daemon.tick();
      return jsonResponse(200, proof);
    }

    return jsonResponse(404, { error: 'not found' });
  } catch (error) {
    return jsonResponse(500, { error: error instanceof Error ? error.message : 'unknown error' });
  }
}

function jsonResponse(statusCode: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export interface FlowerDaemonServerHandle {
  daemon: FlowerDaemon;
  port: number;
  baseUrl: string;
  request(path: string, init?: RequestInit): Promise<Response>;
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
      const body = request.method === 'POST' ? await readJson(request) : undefined;
      const apiResponse = await dispatchDaemonRequest(daemon, {
        method: request.method ?? 'GET',
        pathname: url.pathname,
        body,
      });

      response.writeHead(apiResponse.status, Object.fromEntries(apiResponse.headers.entries()));
      if (apiResponse.body) {
        const text = await apiResponse.text();
        response.end(text);
      } else {
        response.end();
      }
    } catch (error) {
      json(response, 500, { error: error instanceof Error ? error.message : 'unknown error' });
    }
  });

  let port = 0;
  let serverMode: 'http' | 'memory' = 'http';
  try {
    port = await listenOnAvailablePort(server, requestedPort);
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? (error as { code?: string }).code : undefined;
    if (code !== 'EPERM' && code !== 'EACCES') {
      await daemon.stop();
      throw error;
    }
    serverMode = 'memory';
    port = 0;
  }

  const baseUrl = serverMode === 'http' ? `http://127.0.0.1:${port}` : `memory://flower-daemon-${Date.now()}`;

  return {
    daemon,
    port,
    baseUrl,
    request: async (path: string, init: RequestInit = {}) => {
      if (serverMode === 'http') {
        return fetch(`${baseUrl}${path}`, init);
      }

      const url = new URL(path, 'http://127.0.0.1');
      let body: unknown = undefined;
      if (typeof init.body === 'string') {
        body = init.body;
      } else if (init.body instanceof Uint8Array) {
        body = Buffer.from(init.body).toString('utf8');
      }

      return dispatchDaemonRequest(daemon, {
        method: (init.method ?? 'GET').toUpperCase(),
        pathname: url.pathname,
        body,
      });
    },
    async close() {
      if (serverMode === 'http') {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      }
      await daemon.stop();
    },
  };
}

async function listenOnAvailablePort(server: Server, requestedPort: number): Promise<number> {
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
