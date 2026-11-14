import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { secp256k1 } from "@noble/curves/secp256k1";
import {
  canonicalReplayBytes,
  createReplay,
  serializeRuleset,
  serializeScoreAttestation,
} from "@near-arcade/game-core";

import { config } from "../src/config.js";
import { ApiError } from "../src/errors.js";
import {
  MinuteRateLimiter,
  ReplayVerifierService,
  type ArcadeChainReader,
  type ChainRuleset,
  type ChainSession,
} from "../src/replay-verifier.js";

const privateKey = "1".padStart(64, "0");
const publicKey = Buffer.from(
  secp256k1.getPublicKey(privateKey, false).slice(1),
).toString("hex");
const nowMs = 1_000_000;
const nowNs = BigInt(nowMs) * 1_000_000n;
const seed = "00000007" + "0".repeat(56);

const ruleset: ChainRuleset = {
  gameId: "cloud-hop",
  version: "cloud-hop-v1",
  rulesetHash: createHash("sha256").update(serializeRuleset()).digest("hex"),
  maxScore: 150,
  sessionTtlNs: "900000000000",
  enabled: true,
};

const activeSession: ChainSession = {
  sessionId: "a".repeat(64),
  playerId: "pilot.testnet",
  gameId: "cloud-hop",
  rulesetVersion: "cloud-hop-v1",
  seed,
  seedCommitment: createHash("sha256").update(seed).digest("hex"),
  createdAtNs: (nowNs - 10_000_000_000n).toString(),
  expiresAtNs: (nowNs + 180_000_000_000n).toString(),
  status: "active",
};

class MemoryChainReader implements ArcadeChainReader {
  constructor(
    readonly session: ChainSession | null,
    readonly rulesetRecord: ChainRuleset | null = ruleset,
  ) {}

  async getSession(): Promise<ChainSession | null> {
    return this.session;
  }

  async getRuleset(): Promise<ChainRuleset | null> {
    return this.rulesetRecord;
  }
}

const verifierConfig = {
  ...config,
  networkId: "testnet",
  contractId: "arcade.testnet",
  verifierPrivateKey: privateKey,
  verifierPublicKey: publicKey,
  verifierConfigured: true,
  verifierAttestationTtlSeconds: 120,
} as const;

const replay = createReplay(7, 44, []);
const request = {
  playerId: activeSession.playerId,
  claimedScore: 0,
  replay,
};

const hasCode = (code: string) => (error: unknown): boolean =>
  error instanceof ApiError && error.code === code;

test("a controlled terminal replay is independently verified and signed", async () => {
  const verifier = new ReplayVerifierService(
    verifierConfig,
    new MemoryChainReader(activeSession),
  );
  const result = await verifier.verifyAndAttest(
    activeSession.sessionId,
    request,
    nowMs,
  );

  assert.equal(result.status, "verified");
  assert.equal(result.score, 0);
  assert.equal(
    result.replayHash,
    createHash("sha256").update(canonicalReplayBytes(replay)).digest("hex"),
  );
  assert.equal(result.attestation.playerId, activeSession.playerId);
  assert.equal(result.attestation.sessionId, activeSession.sessionId);

  const messageHash = createHash("sha256")
    .update(serializeScoreAttestation(result.attestation))
    .digest();
  const recovered = secp256k1.Signature.fromCompact(result.verifierSignature)
    .addRecoveryBit(result.recoveryId)
    .recoverPublicKey(messageHash)
    .toRawBytes(false)
    .slice(1);
  assert.equal(Buffer.from(recovered).toString("hex"), publicKey);
});

test("modified score, replay seed, and duration are rejected", async () => {
  const verifier = new ReplayVerifierService(
    verifierConfig,
    new MemoryChainReader(activeSession),
  );
  await assert.rejects(
    verifier.verifyAndAttest(
      activeSession.sessionId,
      { ...request, claimedScore: 1 },
      nowMs,
    ),
    hasCode("SCORE_MISMATCH"),
  );
  await assert.rejects(
    verifier.verifyAndAttest(
      activeSession.sessionId,
      { ...request, replay: { ...replay, seed: 8 } },
      nowMs,
    ),
    hasCode("REPLAY_SEED_MISMATCH"),
  );
  await assert.rejects(
    verifier.verifyAndAttest(
      activeSession.sessionId,
      { ...request, replay: { ...replay, durationTicks: 43 } },
      nowMs,
    ),
    hasCode("REPLAY_REJECTED"),
  );
});

test("expired, cross-account, and duplicate submissions fail closed", async () => {
  const expired = new ReplayVerifierService(
    verifierConfig,
    new MemoryChainReader({ ...activeSession, status: "expired" }),
  );
  await assert.rejects(
    expired.verifyAndAttest(activeSession.sessionId, request, nowMs),
    hasCode("SESSION_EXPIRED"),
  );

  const active = new ReplayVerifierService(
    verifierConfig,
    new MemoryChainReader(activeSession),
  );
  await assert.rejects(
    active.verifyAndAttest(
      activeSession.sessionId,
      { ...request, playerId: "intruder.testnet" },
      nowMs,
    ),
    hasCode("PLAYER_MISMATCH"),
  );

  const submitted = new ReplayVerifierService(
    verifierConfig,
    new MemoryChainReader({ ...activeSession, status: "submitted" }),
  );
  await assert.rejects(
    submitted.verifyAndAttest(activeSession.sessionId, request, nowMs),
    hasCode("DUPLICATE_SUBMISSION"),
  );
});

test("the replay verifier enforces a bounded per-requester rate", () => {
  const limiter = new MinuteRateLimiter(2, 1_000);
  limiter.consume("client", 10_000);
  limiter.consume("client", 10_001);
  assert.throws(() => limiter.consume("client", 10_002), hasCode("VERIFIER_RATE_LIMITED"));
  assert.doesNotThrow(() => limiter.consume("client", 12_000));
});
