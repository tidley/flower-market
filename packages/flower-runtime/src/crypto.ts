import { randomUUID } from 'node:crypto';

import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { sha256 } from '@noble/hashes/sha256';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';

import { stableStringify } from '../../flower-contextvm/src/index.ts';
import type { CommitEventPayload, FlowerPayload, RuntimeSigner } from './types.ts';

function encodeBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function sha256Hex(value: string): string {
  return bytesToHex(sha256(encodeBytes(value)));
}

export function randomId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

export function createRuntimeSigner(secretKeyHex?: string): RuntimeSigner {
  const secretKey = secretKeyHex ? hexToBytes(secretKeyHex) : generateSecretKey();
  const publicKey = getPublicKey(secretKey);
  return {
    secretKey,
    publicKey,
    npub: nip19.npubEncode(publicKey),
  };
}

export function payloadHash(payload: FlowerPayload): string {
  return sha256Hex(stableStringify(payload));
}

export function buildCommitHash(
  challengeId: string,
  responder: string,
  leafHash: string,
  revealNonce: string,
): string {
  return sha256Hex(
    stableStringify({
      challengeId,
      responder,
      leafHash,
      revealNonce,
    }),
  );
}

export function matchesCommit(
  commit: CommitEventPayload,
  leafHash: string,
  revealNonce: string,
): boolean {
  return commit.commitHash === buildCommitHash(commit.challengeId, commit.responder, leafHash, revealNonce);
}
