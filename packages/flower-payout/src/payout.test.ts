import { describe, expect, it } from 'vitest';
import { EcashPayoutAdapter } from './index.ts';

describe('EcashPayoutAdapter', () => {
  it('quotes fee and totals deterministically', async () => {
    const adapter = new EcashPayoutAdapter({ mintUrls: ['https://mint1.example', 'https://mint2.example'], feeBps: 100 });
    const quote = await adapter.quote({
      recipientNpub: 'npub1demo000000000000000000000000000000000000000000000000000000',
      amountMsats: 10_000,
      settlementRef: 'stl_1',
    });

    expect(quote.feeMsats).toBe(100);
    expect(quote.totalMsats).toBe(10_100);
    expect(['https://mint1.example', 'https://mint2.example']).toContain(quote.mintUrl);
  });

  it('executes and verifies a payout receipt', async () => {
    const adapter = new EcashPayoutAdapter({ mintUrls: ['https://mint.example'] });
    const receipt = await adapter.execute({
      recipientNpub: 'npub1demo000000000000000000000000000000000000000000000000000000',
      amountMsats: 5_000,
      settlementRef: 'settlement_abc',
      memo: 'rank#1 payout',
    });

    expect(receipt.mintUrl).toBe('https://mint.example');
    expect(receipt.amountMsats).toBe(5_000);
    await expect(adapter.verify(receipt)).resolves.toBe(true);
  });
});
