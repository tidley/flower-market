import { createBlossomFixture, DummyBlossomServer } from './blossom.ts';
import { createRuntimeSigner } from './crypto.ts';
import { MemoryRelayTransport, NostrRelayTransport } from './relay.ts';
import { runAutonomousRound, summarizeRound } from './runtime.ts';

function parseArgs(argv: string[]) {
  const relays: string[] = [];
  let blobId = 'demo_blob';
  let content = 'flower market demo payload';
  let blossomPort = 0;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];

    if (arg === '--relay' && value) {
      relays.push(value);
      index += 1;
      continue;
    }
    if (arg === '--blob-id' && value) {
      blobId = value;
      index += 1;
      continue;
    }
    if (arg === '--content' && value) {
      content = value;
      index += 1;
      continue;
    }
    if (arg === '--blossom-port' && value) {
      blossomPort = Number(value);
      index += 1;
    }
  }

  return { relays, blobId, content, blossomPort };
}

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  const { relays, blobId, content, blossomPort } = parseArgs(argv);
  const blossom = new DummyBlossomServer([createBlossomFixture(blobId, content)]);
  const port = await blossom.start(blossomPort);
  const baseUrl = `http://127.0.0.1:${port}`;
  const transport = relays.length > 0 ? new NostrRelayTransport(relays) : new MemoryRelayTransport();

  try {
    const result = await runAutonomousRound(
      transport,
      baseUrl,
      {
        owner: createRuntimeSigner(),
        responder: createRuntimeSigner(),
        settler: createRuntimeSigner(),
      },
      { blobId },
    );

    process.stdout.write(`${summarizeRound(result)}\n`);
  } finally {
    await transport.close();
    await blossom.stop();
  }
}

runCli().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
