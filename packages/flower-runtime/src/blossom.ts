import { createServer, get, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';

import { hashLeaf, hashPair } from '../../flower-contextvm/src/index.ts';
import type { MerkleProofNode } from '../../flower-contextvm/src/proof.ts';
import type { BlossomFixture, RetrievedBlossomObject } from './types.ts';

function json(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function chunkContent(content: string, chunkSize = 32): string[] {
  if (!content.length) return [''];
  const chunks: string[] = [];
  for (let i = 0; i < content.length; i += chunkSize) {
    chunks.push(content.slice(i, i + chunkSize));
  }
  return chunks;
}

function buildLeafProofs(leafHashes: string[]): { root: string; proofs: Array<{ leafHash: string; proof: MerkleProofNode[] }> } {
  if (leafHashes.length === 0) {
    const leafHash = hashLeaf('');
    return { root: leafHash, proofs: [{ leafHash, proof: [] }] };
  }

  const proofs = leafHashes.map((leafHash) => ({ leafHash, proof: [] as MerkleProofNode[] }));
  let level = leafHashes.map((hash, index) => ({ hash, indices: [index] }));

  while (level.length > 1) {
    const next: Array<{ hash: string; indices: number[] }> = [];

    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1];

      if (!right) {
        next.push(left);
        continue;
      }

      for (const idx of left.indices) {
        proofs[idx].proof.push({ hash: right.hash, position: 'right' });
      }
      for (const idx of right.indices) {
        proofs[idx].proof.push({ hash: left.hash, position: 'left' });
      }

      next.push({
        hash: hashPair(left.hash, right.hash),
        indices: [...left.indices, ...right.indices],
      });
    }

    level = next;
  }

  return { root: level[0].hash, proofs };
}

export function createBlossomFixture(
  blobId: string,
  content: string,
  options?: { encoding?: 'utf8' | 'base64'; mimeType?: string; fileName?: string },
): BlossomFixture {
  const leafChunks = chunkContent(content);
  const leafHashes = leafChunks.map((chunk) => hashLeaf(chunk));
  const { root, proofs } = buildLeafProofs(leafHashes);
  const sample = proofs[0] ?? { leafHash: hashLeaf(content), proof: [] };

  return {
    blobId,
    content,
    contentRef: `cid:${root}`,
    leafHash: sample.leafHash,
    merkleRoot: root,
    sampleLeafHash: sample.leafHash,
    sampleProof: sample.proof,
    encoding: options?.encoding ?? 'utf8',
    mimeType: options?.mimeType,
    fileName: options?.fileName,
    leafProofs: proofs,
  };
}

export class DummyBlossomServer {
  private fixtures = new Map<string, BlossomFixture>();
  private server: Server;
  private started = false;
  private sockets = new Set<Socket>();

  constructor(initialFixtures: BlossomFixture[] = []) {
    this.server = createServer(this.handleRequest);
    initialFixtures.forEach((fixture) => {
      this.fixtures.set(fixture.blobId, fixture);
    });
    this.server.keepAliveTimeout = 0;
    this.server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.on('close', () => {
        this.sockets.delete(socket);
      });
    });
  }

  seed(fixture: BlossomFixture): BlossomFixture {
    this.fixtures.set(fixture.blobId, fixture);
    return fixture;
  }

  list(): BlossomFixture[] {
    return [...this.fixtures.values()];
  }

  async start(port = 0): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, '127.0.0.1', () => {
        this.server.off('error', reject);
        const address = this.server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Failed to bind dummy Blossom server'));
          return;
        }
        this.started = true;
        resolve(address.port);
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        this.server.closeAllConnections();
        this.sockets.forEach((socket) => socket.destroy());
        this.sockets.clear();
        this.started = false;
        resolve();
      });
    });
  }

  private handleRequest = (request: IncomingMessage, response: ServerResponse) => {
    if (!request.url) {
      json(response, 400, { error: 'missing url' });
      return;
    }

    const url = new URL(request.url, 'http://127.0.0.1');

    if (request.method === 'GET' && url.pathname === '/health') {
      json(response, 200, { ok: true, blobs: this.fixtures.size });
      return;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/blob/')) {
      const blobId = decodeURIComponent(url.pathname.slice('/blob/'.length));
      const fixture = this.fixtures.get(blobId);
      if (!fixture) {
        json(response, 404, { error: 'blob not found', blobId });
        return;
      }
      json(response, 200, fixture);
      return;
    }

    json(response, 404, { error: 'not found' });
  };
}

export async function fetchBlossomObject(baseUrl: string, blobId: string): Promise<RetrievedBlossomObject> {
  const url = `${baseUrl.replace(/\/$/, '')}/blob/${encodeURIComponent(blobId)}`;
  const fixture = await new Promise<BlossomFixture>((resolve, reject) => {
    get(url, (response) => {
      const chunks: Uint8Array[] = [];

      response.on('data', (chunk: Uint8Array) => {
        chunks.push(chunk);
      });

      response.on('end', () => {
        if ((response.statusCode ?? 500) >= 400) {
          reject(new Error(`Failed to fetch Blossom blob ${blobId}: ${response.statusCode}`));
          return;
        }

        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as BlossomFixture);
        } catch (error) {
          reject(error);
        }
      });

      response.on('error', reject);
    }).on('error', reject);
  });

  return {
    ...fixture,
    sourceUrl: url,
  };
}
