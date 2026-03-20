import type { RuntimeSnapshot } from '../../../packages/flower-runtime/src/index.ts';

export type PublishedMessage = {
  id: string;
  kind: number;
  pubkey: string;
  createdAt: number;
  content: string;
  tags: string[][];
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function fetchRuntimeState(): Promise<RuntimeSnapshot> {
  return request<RuntimeSnapshot>('/api/state');
}

export function fetchPublishedMessages(): Promise<PublishedMessage[]> {
  return request<PublishedMessage[]>('/api/messages');
}

export function uploadBlob(
  blobId: string,
  content: string,
  options?: { encoding?: 'utf8' | 'base64'; mimeType?: string; fileName?: string },
) {
  return request('/api/blobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ blobId, content, ...options }),
  });
}

export function retrieveBlob(blobId: string, fromRole: 'provider' | 'provider2' | 'provider3') {
  return request('/api/retrieve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ blobId, fromRole }),
  });
}

export function addFunding(role: 'owner' | 'provider' | 'provider2' | 'provider3' | 'settler', sats: number) {
  return request('/api/funding', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role, sats }),
  });
}

export function createChallenge(input: {
  blobId: string;
  payoutSchedule: [number, number, number];
  reliabilityBonusMsats: number;
  commitLeadSeconds: number;
  revealLeadSeconds: number;
  autoRespondProviders?: boolean;
}) {
  return request('/api/challenges', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function respondToChallenge(challengeId: string, providerRole: 'provider' | 'provider2' | 'provider3' = 'provider') {
  return request('/api/challenges/respond', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ challengeId, providerRole }),
  });
}

export function createListing(input: {
  blobId: string;
  priceSats: number;
  deliveryDeadline: number;
  cooldownSeconds: number;
}) {
  return request('/api/listings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function createOffer(listingId: string) {
  return request('/api/offers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ listingId }),
  });
}

export function acceptOffer(offerId: string) {
  return request('/api/accepts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ offerId }),
  });
}

export function publishTransferProof(transferId: string) {
  return request('/api/transfer-proofs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transferId }),
  });
}

export function requestStallTransfer(input: {
  blobId: string;
  fromRole: 'provider' | 'provider2' | 'provider3';
  toRole: 'provider' | 'provider2' | 'provider3';
  supplierFeeSats: number;
  stallFeeSats: number;
}) {
  return request('/api/stall/transfers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}
