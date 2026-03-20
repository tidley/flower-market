import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { sha256 } from '@noble/hashes/sha256';

import { stableStringify } from '../../flower-contextvm/src/index.ts';
import type { BlossomFixture, BlobEnvelope, ProviderRole, ProviderWrap, ProviderWrapSourceRole, RuntimeSigner } from './types.ts';

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function decodeUtf8(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

function sha256Hex(value: string): string {
  return bytesToHex(sha256(encodeUtf8(value)));
}

function deriveKeyMaterial(parts: Record<string, unknown>): string {
  return sha256Hex(stableStringify(parts));
}

function xorWithDerivedKey(value: string, keyMaterial: string): string {
  const source = encodeUtf8(value);
  const key = hexToBytes(sha256Hex(keyMaterial));
  const output = new Uint8Array(source.length);

  for (let i = 0; i < source.length; i += 1) {
    output[i] = source[i] ^ key[i % key.length];
  }

  return Buffer.from(output).toString('base64');
}

function decryptWithDerivedKey(value: string, keyMaterial: string): string {
  const source = Buffer.from(value, 'base64');
  const key = hexToBytes(sha256Hex(keyMaterial));
  const output = new Uint8Array(source.length);

  for (let i = 0; i < source.length; i += 1) {
    output[i] = source[i] ^ key[i % key.length];
  }

  return decodeUtf8(output);
}

function doKeyMaterial(owner: RuntimeSigner, contentRef: string): string {
  return deriveKeyMaterial({
    purpose: 'do-ciphertext',
    contentRef,
    ownerPubkey: owner.publicKey,
    ownerSecretFingerprint: sha256Hex(bytesToHex(owner.secretKey)),
  });
}

function providerWrapKeyMaterial(
  providerRole: ProviderRole,
  provider: RuntimeSigner,
  owner: RuntimeSigner,
  contentRef: string,
  sourceRole: ProviderWrapSourceRole,
): string {
  return deriveKeyMaterial({
    purpose: 'provider-wrap',
    providerRole,
    sourceRole,
    contentRef,
    ownerPubkey: owner.publicKey,
    providerPubkey: provider.publicKey,
    providerSecretFingerprint: sha256Hex(bytesToHex(provider.secretKey)),
  });
}

export function buildBlobEnvelope(
  blob: BlossomFixture,
  owner: RuntimeSigner,
  providers: Partial<Record<ProviderRole, RuntimeSigner>>,
): BlobEnvelope {
  const doMaterial = doKeyMaterial(owner, blob.contentRef);
  const doCiphertext = xorWithDerivedKey(blob.content, doMaterial);
  const wrapsByProvider: Partial<Record<ProviderRole, ProviderWrap>> = {};
  for (const [role, signer] of Object.entries(providers) as Array<[ProviderRole, RuntimeSigner | undefined]>) {
    if (!signer) continue;
    wrapsByProvider[role] = buildProviderWrap({
      role,
      signer,
      owner,
      contentRef: blob.contentRef,
      doCiphertext,
      sourceRole: 'owner',
    });
  }

  return {
    version: 1,
    algorithm: 'flower-do-envelope-v1',
    contentRef: blob.contentRef,
    doCiphertext,
    doKeyFingerprint: sha256Hex(doMaterial),
    wrapsByProvider,
  };
}

export function buildProviderWrap(input: {
  role: ProviderRole;
  signer: RuntimeSigner;
  owner: RuntimeSigner;
  contentRef: string;
  doCiphertext: string;
  sourceRole: ProviderWrapSourceRole;
}): ProviderWrap {
  const wrapMaterial = providerWrapKeyMaterial(input.role, input.signer, input.owner, input.contentRef, input.sourceRole);
  return {
    version: 1,
    role: input.role,
    sourceRole: input.sourceRole,
    wrappedDoCiphertext: xorWithDerivedKey(input.doCiphertext, wrapMaterial),
    wrapKeyFingerprint: sha256Hex(wrapMaterial),
  };
}

export function rewrapBlobEnvelope(
  envelope: BlobEnvelope,
  sourceRole: ProviderRole,
  targetRole: ProviderRole,
  sourceSigner: RuntimeSigner,
  targetSigner: RuntimeSigner,
  owner: RuntimeSigner,
): BlobEnvelope {
  const sourceWrap = envelope.wrapsByProvider[sourceRole];
  if (!sourceWrap) {
    throw new Error(`missing provider wrap for ${sourceRole}`);
  }

  const sourceMaterial = providerWrapKeyMaterial(sourceRole, sourceSigner, owner, envelope.contentRef, sourceWrap.sourceRole);
  const doCiphertext = decryptWithDerivedKey(sourceWrap.wrappedDoCiphertext, sourceMaterial);
  if (doCiphertext !== envelope.doCiphertext) {
    throw new Error(`failed to unwrap provider ciphertext for ${sourceRole}`);
  }

  const targetWrap = buildProviderWrap({
    role: targetRole,
    signer: targetSigner,
    owner,
    contentRef: envelope.contentRef,
    doCiphertext,
    sourceRole,
  });

  return {
    ...envelope,
    wrapsByProvider: {
      ...envelope.wrapsByProvider,
      [targetRole]: targetWrap,
    },
  };
}

export function decryptBlobEnvelope(
  envelope: BlobEnvelope,
  providerRole: ProviderRole,
  providerSigner: RuntimeSigner,
  owner: RuntimeSigner,
): { plaintextPayload: string; providerDoCiphertext: string; providerWrap: ProviderWrap } {
  const providerWrap = envelope.wrapsByProvider[providerRole];
  if (!providerWrap) {
    throw new Error(`${providerRole} does not host ${envelope.contentRef}`);
  }

  const providerMaterial = providerWrapKeyMaterial(
    providerRole,
    providerSigner,
    owner,
    envelope.contentRef,
    providerWrap.sourceRole,
  );
  const providerDoCiphertext = decryptWithDerivedKey(providerWrap.wrappedDoCiphertext, providerMaterial);
  if (providerDoCiphertext !== envelope.doCiphertext) {
    throw new Error(`failed to unwrap provider ciphertext for ${providerRole}`);
  }

  const plaintextPayload = decryptWithDerivedKey(envelope.doCiphertext, doKeyMaterial(owner, envelope.contentRef));
  return { plaintextPayload, providerDoCiphertext, providerWrap };
}
