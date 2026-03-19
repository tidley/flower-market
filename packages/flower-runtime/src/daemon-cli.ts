import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import 'websocket-polyfill';

import { NwcPayoutAdapter } from './nwcPayout.ts';
import { startFlowerDaemonServer } from './server.ts';

const DEFAULT_RELAYS = ['wss://nos.lol', 'wss://relay.damus.io'];

function loadDotEnv(): void {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;

  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;

    const key = trimmed.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;

    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function parseRelayUrls(argv: string[]): string[] {
  const relays: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--relay' && argv[index + 1]) {
      relays.push(argv[index + 1]);
      index += 1;
    }
  }
  return relays;
}

function wantsMemoryMode(argv: string[]): boolean {
  return argv.includes('--memory') || process.env.FLOWER_RELAY_MODE === 'memory';
}

async function probeRelay(url: string, timeoutMs = 6000): Promise<{ url: string; ok: boolean; latencyMs?: number; error?: string }> {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    let done = false;
    const WS = (globalThis as unknown as { WebSocket?: new (url: string) => {
      close: () => void;
      onopen: (() => void) | null;
      onerror: ((event: unknown) => void) | null;
    } }).WebSocket;

    if (!WS) {
      resolve({ url, ok: false, error: 'WebSocket unavailable in runtime' });
      return;
    }

    const ws = new WS(url);

    const finish = (result: { ok: boolean; error?: string }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // ignore
      }
      resolve({
        url,
        ok: result.ok,
        latencyMs: Date.now() - startedAt,
        error: result.error,
      });
    };

    const timer = setTimeout(() => finish({ ok: false, error: `timeout after ${timeoutMs}ms` }), timeoutMs);

    ws.onopen = () => finish({ ok: true });
    ws.onerror = (event) => {
      const maybeMessage = (event as unknown as { message?: string })?.message;
      finish({ ok: false, error: maybeMessage || 'websocket error' });
    };
  });
}

async function probeNwc(uri: string, ownerNpub: string): Promise<{ ok: boolean; msats?: number; sats?: number; error?: string }> {
  const adapter = new NwcPayoutAdapter({
    payer: { uri, npub: ownerNpub },
    recipientsByNpub: {},
  });

  try {
    const balances = await adapter.getBalanceMsatsByNpub();
    const msats = balances[ownerNpub] ?? 0;
    return { ok: true, msats, sats: Math.floor(msats / 1000) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await adapter.close();
  }
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  loadDotEnv();
  const cliRelays = parseRelayUrls(argv);
  const envRelays = process.env.FLOWER_RELAYS?.split(',').map((s) => s.trim()).filter(Boolean);
  const relayUrls = wantsMemoryMode(argv)
    ? []
    : (cliRelays.length > 0 ? cliRelays : (envRelays && envRelays.length > 0 ? envRelays : DEFAULT_RELAYS));
  const forceKind1 = process.env.FLOWER_FORCE_KIND1 ? process.env.FLOWER_FORCE_KIND1 !== 'false' : true;

  const mintUrls = process.env.FLOWER_MINT_URLS
    ? process.env.FLOWER_MINT_URLS.split(',').map((s) => s.trim()).filter(Boolean)
    : ['https://mint.example'];
  const payoutMode = process.env.FLOWER_PAYOUT_MODE === 'lightning' ? 'lightning' : 'ecash';

  const handle = await startFlowerDaemonServer({
    relayUrls,
    forceKind1,
    httpPort: process.env.FLOWER_HTTP_PORT ? Number(process.env.FLOWER_HTTP_PORT) : 8787,
    blossomPort: process.env.FLOWER_BLOSSOM_PORT ? Number(process.env.FLOWER_BLOSSOM_PORT) : 0,
    syncIntervalMs: process.env.FLOWER_SYNC_INTERVAL_MS ? Number(process.env.FLOWER_SYNC_INTERVAL_MS) : 2000,
    ownerSecretKeyHex: process.env.FLOWER_OWNER_SK,
    providerSecretKeyHex: process.env.FLOWER_PROVIDER_SK,
    provider2SecretKeyHex: process.env.FLOWER_PROVIDER2_SK,
    settlerSecretKeyHex: process.env.FLOWER_SETTLER_SK,
    mintUrls,
    payoutMode,
    challengerNwcUri: process.env.FLOWER_CHALLENGER_NWC,
    providerNwcUri: process.env.FLOWER_SP1_NWC,
    provider2NwcUri: process.env.FLOWER_SP2_NWC,
    provider3NwcUri: process.env.FLOWER_SP3_NWC,
    stallNwcUri: process.env.FLOWER_STALL_NWC,
    nwcBalancePolling: process.env.FLOWER_NWC_BALANCE_POLL !== 'false',
    nwcBalancePollIntervalMs: process.env.FLOWER_NWC_BALANCE_POLL_INTERVAL_MS
      ? Number(process.env.FLOWER_NWC_BALANCE_POLL_INTERVAL_MS)
      : 90_000,
    nwcBalancePollSpacingMs: process.env.FLOWER_NWC_BALANCE_POLL_SPACING_MS
      ? Number(process.env.FLOWER_NWC_BALANCE_POLL_SPACING_MS)
      : 750,
    ignoreRelayHistory: process.env.FLOWER_IGNORE_RELAY_HISTORY === 'true',
  });

  console.log(
    JSON.stringify(
      {
        httpPort: handle.port,
        blossomBaseUrl: handle.daemon.getBlossomBaseUrl(),
        relayMode: handle.daemon.relayMode,
        relayUrls: handle.daemon.relayUrls,
        payoutMode,
      },
      null,
      2,
    ),
  );

  const relayChecks = relayUrls.length > 0
    ? await Promise.all(relayUrls.map((url) => probeRelay(url, process.env.FLOWER_RELAY_PROBE_TIMEOUT_MS ? Number(process.env.FLOWER_RELAY_PROBE_TIMEOUT_MS) : 6000)))
    : [];

  const nwcUri = process.env.FLOWER_CHALLENGER_NWC;
  const runStartupNwcProbe = process.env.FLOWER_STARTUP_NWC_PROBE !== 'false';
  const nwcCheck = !runStartupNwcProbe
    ? { ok: false, error: 'startup NWC probe disabled (FLOWER_STARTUP_NWC_PROBE=false)' }
    : payoutMode === 'lightning' && nwcUri
      ? await probeNwc(nwcUri, handle.daemon.owner.npub)
      : { ok: false, error: payoutMode === 'lightning' ? 'FLOWER_CHALLENGER_NWC missing' : 'payout mode not lightning' };

  console.log(
    JSON.stringify(
      {
        startupConnectivity: {
          relays: relayChecks,
          nwc: nwcCheck,
        },
      },
      null,
      2,
    ),
  );

  const shutdown = async () => {
    await handle.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
