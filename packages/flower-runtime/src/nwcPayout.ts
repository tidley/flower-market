import 'websocket-polyfill';

import { NWCClient } from '@getalby/sdk/nwc';

import type { PayoutAdapter, PayoutQuote, PayoutReceipt, PayoutRequest } from '../../flower-payout/src/index.ts';

export interface NwcWalletConfig {
  uri: string;
}

export interface NwcPayoutConfig {
  payer: NwcWalletConfig & { npub: string };
  recipientsByNpub: Record<string, NwcWalletConfig>;
  observersByNpub?: Record<string, NwcWalletConfig>;
}

type WalletEntry = {
  npub: string;
  client: NWCClient;
};

export class NwcPayoutAdapter implements PayoutAdapter {
  readonly kind = 'lightning' as const;

  private payerNpub: string;
  private payerClient: NWCClient;
  private recipientsByNpub: Record<string, NWCClient>;
  private observersByNpub: Record<string, NWCClient>;

  constructor(config: NwcPayoutConfig) {
    this.payerNpub = config.payer.npub;
    this.payerClient = new NWCClient({ nostrWalletConnectUrl: config.payer.uri });
    this.recipientsByNpub = Object.fromEntries(
      Object.entries(config.recipientsByNpub).map(([npub, wallet]) => [npub, new NWCClient({ nostrWalletConnectUrl: wallet.uri })]),
    );
    this.observersByNpub = Object.fromEntries(
      Object.entries(config.observersByNpub ?? {}).map(([npub, wallet]) => [npub, new NWCClient({ nostrWalletConnectUrl: wallet.uri })]),
    );
  }

  async quote(request: PayoutRequest): Promise<PayoutQuote> {
    this.validateRequest(request);
    const recipient = this.recipientsByNpub[request.recipientNpub];
    if (!recipient) throw new Error(`No NWC recipient mapping for ${request.recipientNpub}`);

    return {
      mintUrl: 'lightning:nwc',
      amountMsats: request.amountMsats,
      feeMsats: 0,
      totalMsats: request.amountMsats,
    };
  }

  async execute(request: PayoutRequest): Promise<PayoutReceipt> {
    this.validateRequest(request);

    const recipientClient = this.recipientsByNpub[request.recipientNpub];
    if (!recipientClient) throw new Error(`No NWC recipient mapping for ${request.recipientNpub}`);

    const invoiceResponse = await recipientClient.makeInvoice({
      amount: request.amountMsats,
      description: request.memo ?? `Flower payout ${request.settlementRef}`,
    } as any);

    const invoice = (invoiceResponse as any)?.invoice;
    if (!invoice || typeof invoice !== 'string') {
      throw new Error(`NWC make_invoice did not return invoice for ${request.recipientNpub}`);
    }

    const paymentResponse = await this.payerClient.payInvoice({ invoice } as any);
    const paymentHash =
      (paymentResponse as any)?.payment_hash ||
      (paymentResponse as any)?.preimage ||
      `unknown_${Date.now()}`;

    return {
      id: `nwc_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      recipientNpub: request.recipientNpub,
      mintUrl: 'lightning:nwc',
      amountMsats: request.amountMsats,
      tokenRef: `payment_hash:${paymentHash}`,
      settlementRef: request.settlementRef,
      createdAt: Date.now(),
    };
  }

  async verify(receipt: PayoutReceipt): Promise<boolean> {
    return receipt.tokenRef.startsWith('payment_hash:') && receipt.amountMsats > 0;
  }

  async getBalanceMsatsByNpub(): Promise<Record<string, number>> {
    const wallets: WalletEntry[] = [
      { npub: this.payerNpub, client: this.payerClient },
      ...Object.entries(this.recipientsByNpub).map(([npub, client]) => ({ npub, client })),
      ...Object.entries(this.observersByNpub).map(([npub, client]) => ({ npub, client })),
    ];

    const balances: Record<string, number> = {};
    let successCount = 0;
    let lastError: unknown = null;

    for (const wallet of wallets) {
      try {
        const msats = await this.fetchBalanceMsats(wallet.client);
        balances[wallet.npub] = msats;
        successCount += 1;
      } catch (error) {
        lastError = error;
      }
    }

    if (successCount === 0 && lastError) {
      const message = lastError instanceof Error ? lastError.message : String(lastError);
      throw new Error(`All NWC balance polls failed: ${message}`);
    }

    return balances;
  }

  async close(): Promise<void> {
    try {
      this.payerClient.close();
    } catch {}

    for (const client of Object.values(this.recipientsByNpub)) {
      try {
        client.close();
      } catch {}
    }
    for (const client of Object.values(this.observersByNpub)) {
      try {
        client.close();
      } catch {}
    }
  }

  private async fetchBalanceMsats(client: NWCClient): Promise<number> {
    try {
      const balance = await client.getBalance();
      const msats = coerceMsats(balance as Record<string, unknown>);
      if (msats !== null) return msats;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isNetworkFailure = message.includes('Failed to connect') || message.includes('Nip47NetworkError');
      if (isNetworkFailure) {
        throw error;
      }
      // Non-network failures can still fallback to getInfo.
    }

    const info = await client.getInfo();
    const msats = coerceMsats(info as Record<string, unknown>);
    return msats ?? 0;
  }

  private validateRequest(request: PayoutRequest): void {
    if (!request.recipientNpub?.startsWith('npub')) throw new Error('recipientNpub must be npub');
    if (!Number.isFinite(request.amountMsats) || request.amountMsats <= 0) throw new Error('amountMsats must be > 0');
    if (!request.settlementRef) throw new Error('settlementRef is required');
  }
}

function coerceMsats(result: Record<string, unknown> | null | undefined): number | null {
  if (!result || typeof result !== 'object') return null;
  if (typeof result.balance_msat === 'number' && Number.isFinite(result.balance_msat)) {
    return Math.max(0, Math.round(result.balance_msat));
  }
  if (typeof result.balance === 'number' && Number.isFinite(result.balance)) {
    return Math.max(0, Math.round(result.balance));
  }
  if (typeof result.balance_sat === 'number' && Number.isFinite(result.balance_sat)) {
    return Math.max(0, Math.round(result.balance_sat * 1000));
  }
  return null;
}
