import { createHash } from 'node:crypto';

export interface SettlementEnvelope {
  programHash: string;
  inputHash: string;
  outputHash: string;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, sortValue(v)]);
    return Object.fromEntries(entries);
  }
  return value;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function buildSettlementEnvelope(
  programDescriptor: unknown,
  input: unknown,
  output: unknown,
): SettlementEnvelope {
  return {
    programHash: sha256Hex(stableStringify(programDescriptor)),
    inputHash: sha256Hex(stableStringify(input)),
    outputHash: sha256Hex(stableStringify(output)),
  };
}
