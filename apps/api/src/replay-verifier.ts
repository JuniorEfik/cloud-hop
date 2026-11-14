import { createHash } from "node:crypto";

import { secp256k1 } from "@noble/curves/secp256k1";
import {
  RULESET_V1,
  canonicalReplayBytes,
  gameSeedFromChainSeed,
  serializeRuleset,
  serializeScoreAttestation,
  validateReplay,
  verifyCompletedReplay,
  type GameReplay,
  type ScoreAttestation,
} from "@near-arcade/game-core";
import { providers } from "near-api-js";

import type { ApiConfig } from "./config.js";
import { ApiError } from "./errors.js";

const ACCOUNT_ID_PATTERN =
  /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_REPLAY_BYTES = 12_288;
const TIMING_GRACE_NS = 5_000_000_000n;
const MIN_ATTESTATION_WINDOW_NS = 10_000_000_000n;

export interface ChainSession {
  readonly sessionId: string;
  readonly playerId: string;
  readonly gameId: string;
  readonly rulesetVersion: string;
  readonly seed: string;
  readonly seedCommitment: string;
  readonly createdAtNs: string;
  readonly expiresAtNs: string;
  readonly status: "active" | "abandoned" | "expired" | "submitted";
}

export interface ChainRuleset {
  readonly gameId: string;
  readonly version: string;
  readonly rulesetHash: string;
  readonly maxScore: number;
  readonly sessionTtlNs: string;
  readonly enabled: boolean;
}

export interface ReplaySubmissionRequest {
  readonly playerId: string;
  readonly claimedScore: number;
  readonly replay: GameReplay;
}

export interface VerifiedReplayResponse {
  readonly status: "verified";
  readonly score: number;
  readonly replayHash: string;
  readonly replayBytes: number;
  readonly attestation: ScoreAttestation;
  readonly verifierSignature: string;
  readonly recoveryId: number;
}

export interface ArcadeChainReader {
  getSession(sessionId: string): Promise<ChainSession | null>;
  getRuleset(gameId: string, version: string): Promise<ChainRuleset | null>;
}

const decodeViewResult = <Value>(response: unknown): Value => {
  const result = (response as { result?: unknown }).result;
  if (!Array.isArray(result)) {
    throw new Error("NEAR RPC returned an invalid view result.");
  }
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(result))) as Value;
};

export class RpcArcadeChainReader implements ArcadeChainReader {
  readonly #provider: providers.JsonRpcProvider;
  readonly #contractId: string;

  constructor(rpcUrl: string, contractId: string) {
    this.#provider = new providers.JsonRpcProvider({ url: rpcUrl });
    this.#contractId = contractId;
  }

  async view<Value>(methodName: string, args: object): Promise<Value> {
    const response = await this.#provider.query({
      request_type: "call_function",
      finality: "final",
      account_id: this.#contractId,
      method_name: methodName,
      args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    });
    return decodeViewResult<Value>(response);
  }

  async getSession(sessionId: string): Promise<ChainSession | null> {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const session = await this.view<ChainSession | null>("get_session", {
        session_id: sessionId,
      });
      if (session !== null || attempt === 5) return session;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return null;
  }

  getRuleset(gameId: string, version: string): Promise<ChainRuleset | null> {
    return this.view("get_ruleset", { game_id: gameId, version });
  }
}

export class MinuteRateLimiter {
  readonly #entries = new Map<string, number[]>();

  constructor(
    readonly perKeyLimit: number,
    readonly windowMs = 60_000,
  ) {}

  consume(key: string, now = Date.now()): void {
    const cutoff = now - this.windowMs;
    const current = (this.#entries.get(key) ?? []).filter(
      (timestamp) => timestamp > cutoff,
    );
    if (current.length >= this.perKeyLimit) {
      throw new ApiError(
        429,
        "VERIFIER_RATE_LIMITED",
        "Replay verification rate limit reached.",
      );
    }
    this.#entries.set(key, [...current, now]);
  }
}

export const validateReplaySubmission = (
  candidate: unknown,
): ReplaySubmissionRequest => {
  if (typeof candidate !== "object" || candidate === null) {
    throw new ApiError(400, "INVALID_REQUEST", "Request body must be an object.");
  }
  const record = candidate as Record<string, unknown>;
  const playerId = record.playerId;
  const claimedScore = record.claimedScore;
  const replay = record.replay;

  if (
    typeof playerId !== "string" ||
    playerId.length < 2 ||
    playerId.length > 64 ||
    !ACCOUNT_ID_PATTERN.test(playerId)
  ) {
    throw new ApiError(400, "INVALID_PLAYER", "Player account id is invalid.");
  }
  if (
    typeof claimedScore !== "number" ||
    !Number.isInteger(claimedScore) ||
    claimedScore < 0 ||
    claimedScore > RULESET_V1.maxScore
  ) {
    throw new ApiError(400, "INVALID_SCORE", "Claimed score is out of bounds.");
  }
  const replayValidation = validateReplay(replay);
  if (!replayValidation.valid) {
    throw new ApiError(
      422,
      "INVALID_REPLAY",
      replayValidation.errors.join(" "),
    );
  }

  return {
    playerId,
    claimedScore,
    replay: replay as GameReplay,
  };
};

const hashHex = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");

const assertSessionShape = (session: ChainSession): void => {
  if (
    !SHA256_PATTERN.test(session.sessionId) ||
    !SHA256_PATTERN.test(session.seed) ||
    !SHA256_PATTERN.test(session.seedCommitment) ||
    !/^\d+$/.test(session.createdAtNs) ||
    !/^\d+$/.test(session.expiresAtNs)
  ) {
    throw new ApiError(
      503,
      "INVALID_CHAIN_STATE",
      "The contract returned an invalid session record.",
    );
  }
};

export class ReplayVerifierService {
  readonly #config: ApiConfig;
  readonly #chain: ArcadeChainReader;
  readonly #privateKey: string;
  readonly #localRulesetHash: string;

  constructor(
    config: ApiConfig,
    chain: ArcadeChainReader = new RpcArcadeChainReader(
      config.rpcUrl,
      config.contractId,
    ),
  ) {
    this.#config = config;
    this.#chain = chain;
    this.#privateKey = config.verifierPrivateKey;
    this.#localRulesetHash = hashHex(serializeRuleset());
  }

  async verifyAndAttest(
    sessionId: string,
    candidate: unknown,
    nowMs = Date.now(),
  ): Promise<VerifiedReplayResponse> {
    if (!SHA256_PATTERN.test(sessionId)) {
      throw new ApiError(400, "INVALID_SESSION_ID", "Session id is invalid.");
    }
    if (!this.#config.verifierConfigured || this.#privateKey.length === 0) {
      throw new ApiError(
        503,
        "VERIFIER_NOT_CONFIGURED",
        "Replay verification is not configured.",
      );
    }

    const request = validateReplaySubmission(candidate);
    let session: ChainSession | null;
    let ruleset: ChainRuleset | null;
    try {
      session = await this.#chain.getSession(sessionId);
      if (session === null) {
        throw new ApiError(404, "SESSION_NOT_FOUND", "Session was not found.");
      }
      assertSessionShape(session);
      ruleset = await this.#chain.getRuleset(
        session.gameId,
        session.rulesetVersion,
      );
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        503,
        "CHAIN_UNAVAILABLE",
        "The session could not be confirmed on NEAR.",
      );
    }

    if (session.status === "submitted") {
      throw new ApiError(
        409,
        "DUPLICATE_SUBMISSION",
        "This session already has an accepted result.",
      );
    }
    if (session.status === "expired") {
      throw new ApiError(409, "SESSION_EXPIRED", "This session has expired.");
    }
    if (session.status !== "active") {
      throw new ApiError(409, "SESSION_NOT_ACTIVE", "This session is not active.");
    }
    if (session.playerId !== request.playerId) {
      throw new ApiError(
        403,
        "PLAYER_MISMATCH",
        "The session belongs to a different NEAR account.",
      );
    }
    if (
      ruleset === null ||
      !ruleset.enabled ||
      ruleset.gameId !== session.gameId ||
      ruleset.version !== session.rulesetVersion ||
      ruleset.rulesetHash !== this.#localRulesetHash ||
      ruleset.maxScore !== RULESET_V1.maxScore ||
      (session.gameId !== "cloud-hop" && session.gameId !== "cloud-hop-demo") ||
      session.rulesetVersion !== RULESET_V1.version
    ) {
      throw new ApiError(
        409,
        "RULESET_MISMATCH",
        "The on-chain ruleset does not match this verifier build.",
      );
    }
    if (hashHex(session.seed) !== session.seedCommitment) {
      throw new ApiError(
        409,
        "SEED_COMMITMENT_MISMATCH",
        "The session seed does not match its on-chain commitment.",
      );
    }

    const nowNs = BigInt(nowMs) * 1_000_000n;
    const createdAtNs = BigInt(session.createdAtNs);
    const expiresAtNs = BigInt(session.expiresAtNs);
    if (nowNs >= expiresAtNs) {
      throw new ApiError(409, "SESSION_EXPIRED", "This session has expired.");
    }
    if (createdAtNs > nowNs + TIMING_GRACE_NS) {
      throw new ApiError(
        409,
        "INVALID_SESSION_TIME",
        "The session timestamp is ahead of the verifier clock.",
      );
    }
    const replayDurationNs =
      (BigInt(request.replay.durationTicks) * 1_000_000_000n) /
      BigInt(RULESET_V1.tickRate);
    if (replayDurationNs > nowNs - createdAtNs + TIMING_GRACE_NS) {
      throw new ApiError(
        422,
        "IMPOSSIBLE_DURATION",
        "The replay completed faster than its simulated duration.",
      );
    }

    const expectedSeed = gameSeedFromChainSeed(session.seed);
    if (request.replay.seed !== expectedSeed) {
      throw new ApiError(
        422,
        "REPLAY_SEED_MISMATCH",
        "Replay seed does not match the on-chain session.",
      );
    }
    const replayBytes = canonicalReplayBytes(request.replay);
    if (replayBytes.byteLength > MAX_REPLAY_BYTES) {
      throw new ApiError(413, "REPLAY_TOO_LARGE", "Canonical replay is too large.");
    }
    const verification = verifyCompletedReplay(request.replay);
    if (!verification.accepted || verification.state === null) {
      throw new ApiError(
        422,
        "REPLAY_REJECTED",
        verification.reason ?? "Replay did not reproduce a terminal run.",
      );
    }
    if (verification.state.score !== request.claimedScore) {
      throw new ApiError(
        422,
        "SCORE_MISMATCH",
        "Claimed score does not match the independently replayed score.",
      );
    }

    const replayHash = hashHex(replayBytes);
    const requestedExpiry =
      nowNs + BigInt(this.#config.verifierAttestationTtlSeconds) * 1_000_000_000n;
    const attestationExpiry =
      requestedExpiry < expiresAtNs ? requestedExpiry : expiresAtNs;
    if (attestationExpiry - nowNs < MIN_ATTESTATION_WINDOW_NS) {
      throw new ApiError(
        409,
        "SESSION_EXPIRING",
        "The session is too close to expiry for a score transaction.",
      );
    }
    const attestation: ScoreAttestation = {
      networkId: this.#config.networkId,
      contractId: this.#config.contractId,
      playerId: session.playerId,
      sessionId: session.sessionId,
      gameId: session.gameId,
      rulesetVersion: session.rulesetVersion,
      score: verification.state.score,
      replayHash,
      expiresAtNs: attestationExpiry.toString(),
    };
    const messageHash = createHash("sha256")
      .update(serializeScoreAttestation(attestation))
      .digest();
    const signature = secp256k1.sign(messageHash, this.#privateKey, {
      lowS: true,
    });

    return {
      status: "verified",
      score: verification.state.score,
      replayHash,
      replayBytes: replayBytes.byteLength,
      attestation,
      verifierSignature: signature.toCompactHex(),
      recoveryId: signature.recovery,
    };
  }
}
