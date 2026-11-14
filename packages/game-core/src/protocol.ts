import { serializeReplay } from "./replay.js";
import { RULESET_V1 } from "./ruleset.js";
import type { GameReplay, Ruleset, ScoreAttestation } from "./types.js";

export const SCORE_ATTESTATION_PROTOCOL = "near-arcade-score-v1";

export const canonicalReplayBytes = (replay: GameReplay): Uint8Array =>
  new TextEncoder().encode(serializeReplay(replay));

export const serializeRuleset = (ruleset: Ruleset = RULESET_V1): string =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(ruleset).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  );

export const gameSeedFromChainSeed = (seed: string): number => {
  if (!/^[a-f0-9]{64}$/.test(seed)) {
    throw new Error("The on-chain session seed is invalid.");
  }
  const value = Number.parseInt(seed.slice(0, 8), 16) >>> 0;
  return value === 0 ? 1 : value;
};

export const serializeScoreAttestation = (
  attestation: ScoreAttestation,
): string =>
  JSON.stringify({
    protocol: SCORE_ATTESTATION_PROTOCOL,
    networkId: attestation.networkId,
    contractId: attestation.contractId,
    playerId: attestation.playerId,
    sessionId: attestation.sessionId,
    gameId: attestation.gameId,
    rulesetVersion: attestation.rulesetVersion,
    score: attestation.score,
    replayHash: attestation.replayHash,
    expiresAtNs: attestation.expiresAtNs,
  });
