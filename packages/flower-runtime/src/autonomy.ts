import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { AutonomousResponderCheckpoint, AutonomousResponderRecord, ProviderRole } from './types.ts';

export function responseKey(challengeId: string, providerRole: ProviderRole): string {
  return `${challengeId}:${providerRole}`;
}

export function createEmptyAutonomyCheckpoint(): AutonomousResponderCheckpoint {
  return {
    version: 1,
    cursor: { lastProcessedChallengeCreatedAt: 0 },
    records: {},
  };
}

function normalizeRecord(record: AutonomousResponderRecord): AutonomousResponderRecord {
  return {
    ...record,
  };
}

export class AutonomousCheckpointStore {
  constructor(private readonly checkpointPath: string | null) {}

  get path(): string | null {
    return this.checkpointPath;
  }

  async load(): Promise<AutonomousResponderCheckpoint> {
    if (!this.checkpointPath) {
      return createEmptyAutonomyCheckpoint();
    }

    try {
      const raw = await readFile(this.checkpointPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<AutonomousResponderCheckpoint> | null;
      if (!parsed || parsed.version !== 1) {
        return createEmptyAutonomyCheckpoint();
      }

      return {
        version: 1,
        cursor: {
          lastProcessedChallengeCreatedAt: parsed.cursor?.lastProcessedChallengeCreatedAt ?? 0,
        },
        lastRunAt: typeof parsed.lastRunAt === 'number' ? parsed.lastRunAt : undefined,
        lastPendingCount: typeof parsed.lastPendingCount === 'number' ? parsed.lastPendingCount : undefined,
        records: Object.fromEntries(
          Object.entries(parsed.records ?? {}).map(([key, record]) => [key, normalizeRecord(record as AutonomousResponderRecord)]),
        ),
      };
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? (error as NodeJS.ErrnoException).code : undefined;
      if (code === 'ENOENT' || error instanceof SyntaxError) {
        return createEmptyAutonomyCheckpoint();
      }
      throw error;
    }
  }

  async save(checkpoint: AutonomousResponderCheckpoint): Promise<void> {
    if (!this.checkpointPath) {
      return;
    }

    await mkdir(dirname(this.checkpointPath), { recursive: true });
    const next = `${JSON.stringify(checkpoint, null, 2)}\n`;
    const tempPath = `${this.checkpointPath}.tmp`;
    await writeFile(tempPath, next, 'utf8');
    await rename(tempPath, this.checkpointPath);
  }
}
