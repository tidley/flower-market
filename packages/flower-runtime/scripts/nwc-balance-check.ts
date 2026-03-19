import { NwcPayoutAdapter } from '../src/nwcPayout.ts';

async function main() {
  const uri = process.env.FLOWER_CHALLENGER_NWC;
  if (!uri) {
    throw new Error('Missing FLOWER_CHALLENGER_NWC');
  }

  const ownerNpub = process.env.FLOWER_OWNER_NPUB ?? 'npub1ownercheck0000000000000000000000000000000000000000000000000000';

  const adapter = new NwcPayoutAdapter({
    payer: { uri, npub: ownerNpub },
    recipientsByNpub: {},
    timeoutMs: process.env.FLOWER_NWC_TIMEOUT_MS ? Number(process.env.FLOWER_NWC_TIMEOUT_MS) : 20000,
  });

  try {
    const balances = await adapter.getBalanceMsatsByNpub();
    const msats = balances[ownerNpub] ?? 0;
    console.log(JSON.stringify({ ok: true, ownerNpub, msats, sats: Math.floor(msats / 1000) }, null, 2));
  } finally {
    await adapter.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
});
