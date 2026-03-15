import { startFlowerDaemonServer } from './server.ts';

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

async function main(argv = process.argv.slice(2)): Promise<void> {
  const handle = await startFlowerDaemonServer({
    relayUrls: parseRelayUrls(argv).length > 0 ? parseRelayUrls(argv) : process.env.FLOWER_RELAYS?.split(',').filter(Boolean),
    httpPort: process.env.FLOWER_HTTP_PORT ? Number(process.env.FLOWER_HTTP_PORT) : 8787,
    blossomPort: process.env.FLOWER_BLOSSOM_PORT ? Number(process.env.FLOWER_BLOSSOM_PORT) : 0,
    syncIntervalMs: process.env.FLOWER_SYNC_INTERVAL_MS ? Number(process.env.FLOWER_SYNC_INTERVAL_MS) : 2000,
    ownerSecretKeyHex: process.env.FLOWER_OWNER_SK,
    providerSecretKeyHex: process.env.FLOWER_PROVIDER_SK,
    settlerSecretKeyHex: process.env.FLOWER_SETTLER_SK,
  });

  console.log(
    JSON.stringify(
      {
        httpPort: handle.port,
        blossomBaseUrl: handle.daemon.getBlossomBaseUrl(),
        relayMode: handle.daemon.relayMode,
        relayUrls: handle.daemon.relayUrls,
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
