import { startFlowerDaemonServer } from './server.ts';

const DEFAULT_RELAYS = ['wss://nos.lol', 'wss://relay.damus.io'];

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

async function main(argv = process.argv.slice(2)): Promise<void> {
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
