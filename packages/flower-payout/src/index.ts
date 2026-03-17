export interface PayoutRequest {
  recipientNpub: string;
  amountMsats: number;
  memo?: string;
  settlementRef: string;
}

export interface PayoutQuote {
  mintUrl: string;
  amountMsats: number;
  feeMsats: number;
  totalMsats: number;
}

export interface PayoutReceipt {
  id: string;
  recipientNpub: string;
  mintUrl: string;
  amountMsats: number;
  tokenRef: string;
  settlementRef: string;
  createdAt: number;
}

export interface PayoutAdapter {
  kind: 'ecash' | 'lightning' | 'mock';
  quote(request: PayoutRequest): Promise<PayoutQuote>;
  execute(request: PayoutRequest): Promise<PayoutReceipt>;
  verify(receipt: PayoutReceipt): Promise<boolean>;
}

export interface EcashAdapterConfig {
  mintUrls: string[];
  feeBps?: number;
}

export class EcashPayoutAdapter implements PayoutAdapter {
  readonly kind = 'ecash' as const;

  private mintUrls: string[];
  private feeBps: number;

  constructor(config: EcashAdapterConfig) {
    if (!config.mintUrls?.length) throw new Error('EcashPayoutAdapter requires at least one mint URL');
    this.mintUrls = config.mintUrls;
    this.feeBps = config.feeBps ?? 50;
  }

  async quote(request: PayoutRequest): Promise<PayoutQuote> {
    this.validateRequest(request);
    const feeMsats = Math.floor((request.amountMsats * this.feeBps) / 10_000);
    return {
      mintUrl: this.pickMint(request.recipientNpub),
      amountMsats: request.amountMsats,
      feeMsats,
      totalMsats: request.amountMsats + feeMsats,
    };
  }

  async execute(request: PayoutRequest): Promise<PayoutReceipt> {
    const quote = await this.quote(request);
    const ts = Date.now();
    return {
      id: `payout_${ts}_${Math.random().toString(36).slice(2, 10)}`,
      recipientNpub: request.recipientNpub,
      mintUrl: quote.mintUrl,
      amountMsats: request.amountMsats,
      tokenRef: `ecash:${quote.mintUrl}:${request.settlementRef}`,
      settlementRef: request.settlementRef,
      createdAt: ts,
    };
  }

  async verify(receipt: PayoutReceipt): Promise<boolean> {
    return receipt.amountMsats > 0 && this.mintUrls.includes(receipt.mintUrl) && receipt.tokenRef.startsWith('ecash:');
  }

  private pickMint(seed: string): string {
    let h = 0;
    for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    return this.mintUrls[h % this.mintUrls.length];
  }

  private validateRequest(request: PayoutRequest): void {
    if (!request.recipientNpub?.startsWith('npub')) throw new Error('recipientNpub must be npub');
    if (!Number.isFinite(request.amountMsats) || request.amountMsats <= 0) throw new Error('amountMsats must be > 0');
    if (!request.settlementRef) throw new Error('settlementRef is required');
  }
}
