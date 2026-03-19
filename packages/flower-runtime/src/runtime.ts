import {
  buildSettlementEnvelope,
  settleChallengeFromProofs,
  verifyTransferProof,
} from '../../flower-contextvm/src/index.ts';
import type { PayoutAdapter } from '../../flower-payout/src/index.ts';
import { buildCommitHash, matchesCommit, payloadHash, randomId } from './crypto.ts';
import { fetchBlossomObject } from './blossom.ts';
import type {
  AutonomousRoundConfig,
  AutonomousRoundResult,
  BlossomFixture,
  ChallengeEventPayload,
  CommitEventPayload,
  PublishedFlowerEvent,
  RevealEventPayload,
  RuntimeSigner,
  SettlementEventPayload,
} from './types.ts';
import type { RelayTransport } from './relay.ts';

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export interface RuntimeParticipants {
  owner: RuntimeSigner;
  responder: RuntimeSigner;
  settler: RuntimeSigner;
}

export async function runAutonomousRound(
  transport: RelayTransport,
  blossomBaseUrl: string,
  participants: RuntimeParticipants,
  config: AutonomousRoundConfig = {},
): Promise<AutonomousRoundResult> {
  const blobId = config.blobId ?? 'demo_blob';
  const challengeId = config.challengeId ?? randomId('ch');
  const epoch = config.epoch ?? 1;
  const payoutSchedule = config.payoutSchedule ?? [15, 10, 5];
  const reliabilityBonusMsats = config.reliabilityBonusMsats ?? 1000;
  const responderReliability = config.responderReliability ?? 0.96;
  const responderLatencyMs = config.responderLatencyMs ?? 42;
  const commitLeadSeconds = config.commitLeadSeconds ?? 30;
  const revealLeadSeconds = config.revealLeadSeconds ?? 60;

  const blossom = await fetchBlossomObject(blossomBaseUrl, blobId);
  const startedAt = nowSeconds();

  const challengePayload: ChallengeEventPayload = {
    type: 'challenge',
    challengeId,
    epoch,
    contentRef: blossom.contentRef,
    merkleRoot: blossom.merkleRoot,
    leafIndex: 0,
    nonce: randomId('nonce'),
    commitDeadline: startedAt + commitLeadSeconds,
    revealDeadline: startedAt + revealLeadSeconds,
    payoutSchedule,
    reliabilityBonusMsats,
  };
  const challenge = await transport.publish(participants.owner, challengePayload);

  const revealNonce = randomId('reveal');
  const commitPayload: CommitEventPayload = {
    type: 'commit',
    challengeId,
    responder: participants.responder.npub,
    commitHash: buildCommitHash(challengeId, participants.responder.npub, blossom.leafHash, revealNonce),
    commitTs: startedAt + 1,
  };
  const commit = await transport.publish(participants.responder, commitPayload);

  const revealPayload: RevealEventPayload = {
    type: 'reveal',
    challengeId,
    responder: participants.responder.npub,
    commitTs: commitPayload.commitTs,
    revealTs: startedAt + 2,
    latencyMs: responderLatencyMs,
    reliabilityScore: responderReliability,
    leafHash: blossom.leafHash,
    proof: blossom.sampleProof,
    expectedRoot: blossom.merkleRoot,
    revealNonce,
  };
  const reveal = await transport.publish(participants.responder, revealPayload);

  const settlement = await settlePublishedChallenge(transport, participants.settler, challenge, blossom, commit, reveal);

  return {
    challenge,
    commit,
    reveal,
    settlement,
    blossom,
  };
}

export async function settlePublishedChallenge(
  transport: RelayTransport,
  settler: RuntimeSigner,
  challenge: PublishedFlowerEvent<ChallengeEventPayload>,
  blossom: BlossomFixture,
  knownCommit?: PublishedFlowerEvent<CommitEventPayload>,
  knownReveal?: PublishedFlowerEvent<RevealEventPayload>,
  payoutAdapter?: PayoutAdapter,
): Promise<PublishedFlowerEvent<SettlementEventPayload>> {
  const events = await transport.list({ challengeId: challenge.payload.challengeId });
  const commits = dedupeById(
    events
      .filter((event): event is PublishedFlowerEvent<CommitEventPayload> => event.payload.type === 'commit')
      .concat(knownCommit ? [knownCommit] : []),
  );
  const reveals = dedupeById(
    events
      .filter((event): event is PublishedFlowerEvent<RevealEventPayload> => event.payload.type === 'reveal')
      .concat(knownReveal ? [knownReveal] : []),
  );

  const materializedReveals = reveals
    .map((event) => {
      const commit = commits.find(
        (candidate) =>
          candidate.payload.challengeId === event.payload.challengeId &&
          candidate.payload.responder === event.payload.responder,
      );
      if (!commit) {
        return null;
      }

      if (!matchesCommit(commit.payload, event.payload.leafHash, event.payload.revealNonce)) {
        return null;
      }

      return {
        responder: event.payload.responder,
        commitTs: event.payload.commitTs,
        revealTs: event.payload.revealTs,
        latencyMs: event.payload.latencyMs,
        reliabilityScore: event.payload.reliabilityScore,
        leafHash: event.payload.leafHash,
        proof: event.payload.proof,
        expectedRoot: event.payload.expectedRoot,
      };
    })
    .filter((value): value is NonNullable<typeof value> => value !== null);

  const settlementOutput = settleChallengeFromProofs(
    {
      challengeId: challenge.payload.challengeId,
      epoch: challenge.payload.epoch,
      payoutSchedule: challenge.payload.payoutSchedule,
      reliabilityBonusMsats: challenge.payload.reliabilityBonusMsats,
      merkleRoot: challenge.payload.merkleRoot,
      commitDeadline: challenge.payload.commitDeadline,
      revealDeadline: challenge.payload.revealDeadline,
    },
    materializedReveals,
  );

  if (!verifyTransferProof({ sampleLeafHash: blossom.sampleLeafHash, sampleProof: blossom.sampleProof, merkleRoot: blossom.merkleRoot })) {
    throw new Error(`Blossom proof fixture for ${blossom.blobId} is invalid`);
  }

  const envelope = buildSettlementEnvelope(
    { name: 'flower-runtime', version: '0.1.0' },
    {
      challengeId: challenge.payload.challengeId,
      contentRef: challenge.payload.contentRef,
      merkleRoot: challenge.payload.merkleRoot,
      revealCount: materializedReveals.length,
    },
    settlementOutput,
  );

  const winners = settlementOutput.winners.map((winner) => ({
    responder: winner.responder,
    rank: winner.rank,
    baseSats: winner.baseSats,
    bonusMsats: winner.bonusMsats,
    totalMsats: winner.totalMsats,
  }));

  const payoutFailures: string[] = [];
  const payoutReceipts = payoutAdapter
    ? (
        await Promise.all(
          winners.map(async (winner) => {
            try {
              const receipt = await payoutAdapter.execute({
                recipientNpub: winner.responder,
                amountMsats: winner.totalMsats,
                settlementRef: challenge.payload.challengeId,
                memo: `flower payout rank ${winner.rank}`,
              });
              return {
                responder: winner.responder,
                amountMsats: winner.totalMsats,
                mintUrl: receipt.mintUrl,
                tokenRef: receipt.tokenRef,
                payoutId: receipt.id,
              };
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              payoutFailures.push(`payout_failed:${winner.responder}:${message}`);
              return null;
            }
          }),
        )
      ).filter((value): value is NonNullable<typeof value> => value !== null)
    : undefined;

  const settlementPayload: SettlementEventPayload = {
    type: 'settlement',
    challengeId: challenge.payload.challengeId,
    epoch: challenge.payload.epoch,
    programHash: envelope.programHash,
    inputHash: envelope.inputHash,
    outputHash: envelope.outputHash,
    winners,
    excluded: [...settlementOutput.excluded, ...payoutFailures],
    payoutReceipts,
  };

  return transport.publish(settler, settlementPayload);
}

function dedupeById<T extends PublishedFlowerEvent>(events: T[]): T[] {
  return [...new Map(events.map((event) => [event.id, event])).values()];
}

export function summarizeRound(result: AutonomousRoundResult): string {
  const summary = {
    challengeId: result.challenge.payload.challengeId,
    relayChallengeEventId: result.challenge.id,
    relaySettlementEventId: result.settlement.id,
    blossomSource: result.blossom.sourceUrl,
    winners: result.settlement.payload.winners,
    excluded: result.settlement.payload.excluded,
    settlementHashes: {
      programHash: result.settlement.payload.programHash,
      inputHash: result.settlement.payload.inputHash,
      outputHash: result.settlement.payload.outputHash,
    },
    publishHashes: {
      challenge: payloadHash(result.challenge.payload),
      commit: payloadHash(result.commit.payload),
      reveal: payloadHash(result.reveal.payload),
      settlement: payloadHash(result.settlement.payload),
    },
  };

  return JSON.stringify(summary, null, 2);
}
