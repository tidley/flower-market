import { hexToBytes } from '@noble/hashes/utils';
import { getPublicKey, finalizeEvent, SimplePool } from 'nostr-tools';
import { decrypt, encrypt } from 'nostr-tools/nip04';

import type { PayoutAdapter, PayoutQuote, PayoutReceipt, PayoutRequest } from '../../flower-payout/src/index.ts';

const NWC_REQUEST_KIND = 23194;
const NWC_RESPONSE_KIND = 23195;

export interface NwcWalletConfig {
  uri: string;
}

export interface NwcPayoutConfig {
  payer: NwcWalletConfig;
  recipientsByNpub: Record<string, NwcWalletConfig>;
  timeoutMs?: number;
}

type ParsedNwc = {
  walletPubkey: string;
  relay: string;
  secretHex: string;
  secretBytes: Uint8Array;
  clientPubkey: string;
};

export class NwcPayoutAdapter implements PayoutAdapter {
  readonly kind = 'lightning' as const;

  private pool = new SimplePool();
  private payer: ParsedNwc;
  private recipientsByNpub: Record<string, ParsedNwc>;
  private timeoutMs: number;

  constructor(config: NwcPayoutConfig) {
    this.payer = parseNwcUri(config.payer.uri);
    this.recipientsByNpub = Object.fromEntries(
      Object.entries(config.recipientsByNpub).map(([npub, wallet]) => [npub, parseNwcUri(wallet.uri)]),
    );
    this.timeoutMs = config.timeoutMs ?? 15_000;
  }

  async quote(request: PayoutRequest): Promise<PayoutQuote> {
    this.validateRequest(request);
    const recipient = this.recipientsByNpub[request.recipientNpub];
    if (!recipient) {
      throw new Error(`No NWC recipient mapping for ${request.recipientNpub}`);
    }

    return {
      mintUrl: `nwc:${recipient.relay}`,
      amountMsats: request.amountMsats,
      feeMsats: 0,
      totalMsats: request.amountMsats,
    };
  }

  async execute(request: PayoutRequest): Promise<PayoutReceipt> {
    this.validateRequest(request);
    const receiver = this.recipientsByNpub[request.recipientNpub];
    if (!receiver) {
      throw new Error(`No NWC recipient mapping for ${request.recipientNpub}`);
    }

    const invoiceRes = await this.request(receiver, 'make_invoice', {
      amount: request.amountMsats,
      description: request.memo ?? `Flower payout ${request.settlementRef}`,
    });
    const invoice = invoiceRes?.result?.invoice as string | undefined;
    if (!invoice) {
      throw new Error(`NWC make_invoice did not return invoice for ${request.recipientNpub}`);
    }

    const payRes = await this.request(this.payer, 'pay_invoice', { invoice });
    const paymentHash =
      (payRes?.result?.payment_hash as string | undefined) ||
      (payRes?.result?.preimage as string | undefined) ||
      `unknown_${Date.now()}`;

    return {
      id: `nwc_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      recipientNpub: request.recipientNpub,
      mintUrl: `nwc:${this.payer.relay}`,
      amountMsats: request.amountMsats,
      tokenRef: `payment_hash:${paymentHash}`,
      settlementRef: request.settlementRef,
      createdAt: Date.now(),
    };
  }

  async verify(receipt: PayoutReceipt): Promise<boolean> {
    return receipt.tokenRef.startsWith('payment_hash:') && receipt.amountMsats > 0;
  }

  async close(): Promise<void> {
    const relays = new Set<string>([
      this.payer.relay,
      ...Object.values(this.recipientsByNpub).map((wallet) => wallet.relay),
    ]);
    this.pool.close([...relays]);
  }

  private async request(wallet: ParsedNwc, method: string, params: Record<string, unknown>): Promise<any> {
    const createdAt = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({ method, params });
    const encrypted = await encrypt(wallet.secretHex, wallet.walletPubkey, payload);

    const reqEvent = finalizeEvent(
      {
        kind: NWC_REQUEST_KIND,
        created_at: createdAt,
        tags: [['p', wallet.walletPubkey]],
        content: encrypted,
      },
      wallet.secretBytes,
    );

    await Promise.allSettled(this.pool.publish([wallet.relay], reqEvent));

    const timeoutAt = Date.now() + this.timeoutMs;
    while (Date.now() < timeoutAt) {
      const responses = await this.pool.querySync(
        [wallet.relay],
        { kinds: [NWC_RESPONSE_KIND], authors: [wallet.walletPubkey], '#e': [reqEvent.id], since: createdAt - 3, limit: 20 } as any,
        { maxWait: 1200 },
      );

      for (const response of responses) {
        try {
          const decrypted = await decrypt(wallet.secretHex, wallet.walletPubkey, response.content);
          const decoded = JSON.parse(decrypted);
          if (decoded.error) {
            throw new Error(typeof decoded.error === 'string' ? decoded.error : JSON.stringify(decoded.error));
          }
          return decoded;
        } catch {
          // keep looking; relays may return unrelated payloads
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error(`NWC ${method} timed out via ${wallet.relay}`);
  }

  private validateRequest(request: PayoutRequest): void {
    if (!request.recipientNpub?.startsWith('npub')) throw new Error('recipientNpub must be npub');
    if (!Number.isFinite(request.amountMsats) || request.amountMsats <= 0) throw new Error('amountMsats must be > 0');
    if (!request.settlementRef) throw new Error('settlementRef is required');
  }
}

function parseNwcUri(uri: string): ParsedNwc {
  const parsed = new URL(uri);
  if (parsed.protocol !== 'nostr+walletconnect:') {
    throw new Error('NWC URI must use nostr+walletconnect://');
  }

  const walletPubkey = parsed.hostname;
  const relay = parsed.searchParams.get('relay');
  const secretHex = parsed.searchParams.get('secret');
  if (!walletPubkey || walletPubkey.length !== 64) {
    throw new Error('NWC URI missing valid wallet pubkey');
  }
  if (!relay) {
    throw new Error('NWC URI missing relay');
  }
  if (!secretHex || secretHex.length !== 64) {
    throw new Error('NWC URI missing valid secret');
  }

  const secretBytes = hexToBytes(secretHex);
  const clientPubkey = getPublicKey(secretBytes);

  return {
    walletPubkey,
    relay,
    secretHex,
    secretBytes,
    clientPubkey,
  };
}
