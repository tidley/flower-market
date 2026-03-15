import type {
  ChallengeEventPayload,
  ChallengeRuntimeView,
  CommitEventPayload,
  MarketAcceptEventPayload,
  MarketListingEventPayload,
  MarketOfferEventPayload,
  MarketSettlementEventPayload,
  MarketTransferProofEventPayload,
  MarketplaceRuntimeView,
  PublishedFlowerEvent,
  RevealEventPayload,
  SettlementEventPayload,
} from './types.ts';

export interface ParsedRuntimeEvents {
  challenges: PublishedFlowerEvent<ChallengeEventPayload>[];
  commits: PublishedFlowerEvent<CommitEventPayload>[];
  reveals: PublishedFlowerEvent<RevealEventPayload>[];
  settlements: PublishedFlowerEvent<SettlementEventPayload>[];
  listings: PublishedFlowerEvent<MarketListingEventPayload>[];
  offers: PublishedFlowerEvent<MarketOfferEventPayload>[];
  accepts: PublishedFlowerEvent<MarketAcceptEventPayload>[];
  transferProofs: PublishedFlowerEvent<MarketTransferProofEventPayload>[];
  marketSettlements: PublishedFlowerEvent<MarketSettlementEventPayload>[];
}

export function parseRuntimeEvents(events: PublishedFlowerEvent[]): ParsedRuntimeEvents {
  return {
    challenges: events.filter(isType('challenge')),
    commits: events.filter(isType('commit')),
    reveals: events.filter(isType('reveal')),
    settlements: events.filter(isType('settlement')),
    listings: events.filter(isType('market.listing')),
    offers: events.filter(isType('market.offer')),
    accepts: events.filter(isType('market.accept')),
    transferProofs: events.filter(isType('market.transfer_proof')),
    marketSettlements: events.filter(isType('market.settlement')),
  };
}

export function buildChallengeViews(parsed: ParsedRuntimeEvents): ChallengeRuntimeView[] {
  return parsed.challenges.map((challenge) => {
    const commits = parsed.commits.filter((event) => event.payload.challengeId === challenge.payload.challengeId);
    const reveals = parsed.reveals.filter((event) => event.payload.challengeId === challenge.payload.challengeId);
    const settlement = parsed.settlements.find((event) => event.payload.challengeId === challenge.payload.challengeId);

    return {
      challenge,
      commits,
      reveals,
      settlement,
      status: settlement ? 'settled' : 'open',
    };
  });
}

export function buildMarketplaceViews(parsed: ParsedRuntimeEvents): MarketplaceRuntimeView[] {
  return parsed.listings.map((listing) => {
    const offers = parsed.offers.filter((event) => event.payload.listingId === listing.payload.listingId);
    const accept = parsed.accepts.find((event) => event.payload.listingId === listing.payload.listingId);
    const transferProof = accept
      ? parsed.transferProofs.find((event) => event.payload.transferId === accept.payload.transferId)
      : undefined;
    const settlement = accept
      ? parsed.marketSettlements.find((event) => event.payload.transferId === accept.payload.transferId)
      : undefined;

    return {
      listing,
      offers,
      accept,
      transferProof,
      settlement,
    };
  });
}

function isType<T extends PublishedFlowerEvent['payload']['type']>(type: T) {
  return (event: PublishedFlowerEvent): event is Extract<PublishedFlowerEvent, { payload: { type: T } }> =>
    event.payload.type === type;
}
