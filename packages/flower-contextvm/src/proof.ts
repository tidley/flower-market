import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { sha256 } from '@noble/hashes/sha256';

export type ProofPosition = 'left' | 'right';

export interface MerkleProofNode {
  hash: string; // hex sha256
  position: ProofPosition;
}

function sha256Hex(data: Uint8Array): string {
  return bytesToHex(sha256(data));
}

function safeHexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex length');
  return hexToBytes(hex);
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export function hashLeaf(value: string | Uint8Array): string {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return sha256Hex(bytes);
}

export function hashPair(leftHex: string, rightHex: string): string {
  const left = safeHexToBytes(leftHex);
  const right = safeHexToBytes(rightHex);
  return sha256Hex(concat(left, right));
}

export function verifyMerkleProof(
  leafHash: string,
  proof: MerkleProofNode[],
  expectedRoot: string,
): boolean {
  let current = leafHash;

  for (const node of proof) {
    current = node.position === 'left' ? hashPair(node.hash, current) : hashPair(current, node.hash);
  }

  return current === expectedRoot;
}
