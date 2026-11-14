import assert from "node:assert/strict";
import test from "node:test";
import { transactions } from "near-api-js";

import {
  deriveGoogleAccountId,
  gameSeedFromChainSeed,
  isMissingAccessKeyError,
  normalizeNearPublicKey,
  parseVerifiedReplayResponse,
  scoreRecordFromOutcome,
  sessionFromOutcome,
  tournamentEntryFromOutcome,
  transactionHashFromOutcome,
} from "../src/near-utils.js";

test("FastAuth public-key strings normalize before transaction serialization", () => {
  const publicKey = normalizeNearPublicKey(
    "ed25519:11111111111111111111111111111111",
  );
  const transaction = transactions.createTransaction(
    "player.testnet",
    publicKey,
    "arcade.testnet",
    1n,
    [],
    new Uint8Array(32),
  );

  assert.equal(publicKey.toString(), "ed25519:11111111111111111111111111111111");
  assert.doesNotThrow(() => transactions.encodeTransaction(transaction));
});

const session = {
  sessionId: "a".repeat(64),
  playerId: "player.testnet",
  gameId: "cloud-hop",
  rulesetVersion: "cloud-hop-v1",
  seed: "12345678" + "0".repeat(56),
  seedCommitment: "b".repeat(64),
  createdAtNs: "1",
  expiresAtNs: "2",
  status: "active",
};

test("contract outcomes decode a typed session and transaction hash", () => {
  const outcome = {
    status: {
      SuccessValue: Buffer.from(JSON.stringify(session)).toString("base64"),
    },
    transaction: { hash: "tx-hash" },
  };
  assert.deepEqual(sessionFromOutcome(outcome), session);
  assert.equal(transactionHashFromOutcome(outcome), "tx-hash");
});

test("chain seeds map deterministically to the 32-bit game seed", () => {
  assert.equal(gameSeedFromChainSeed(session.seed), 0x12345678);
  assert.equal(gameSeedFromChainSeed("0".repeat(64)), 1);
  assert.throws(() => gameSeedFromChainSeed("not-a-seed"));
});

test("Google player ids match the bounded sponsor subaccount format", async () => {
  const accountId = await deriveGoogleAccountId(
    "ed25519:11111111111111111111111111111111",
    "arcade-sponsor.testnet",
  );
  assert.match(accountId, /^g-[a-f0-9]+\.arcade-sponsor\.testnet$/);
  assert.ok(accountId.length <= 64);
});

test("missing access-key failures are recognized across wallet and RPC shapes", () => {
  assert.equal(
    isMissingAccessKeyError(
      new Error(
        "Can't complete the action because access key ed25519:missing doesn't exist",
      ),
    ),
    true,
  );
  assert.equal(
    isMissingAccessKeyError({ type: "AccessKeyDoesNotExist" }),
    true,
  );
  assert.equal(isMissingAccessKeyError(new Error("User rejected")), false);
});

test("verifier and contract score responses decode only complete records", () => {
  const attestation = {
    networkId: "testnet",
    contractId: "arcade.testnet",
    playerId: "player.testnet",
    sessionId: "a".repeat(64),
    gameId: "cloud-hop",
    rulesetVersion: "cloud-hop-v1",
    score: 3,
    replayHash: "b".repeat(64),
    expiresAtNs: "123456789",
  };
  const verified = {
    status: "verified",
    score: 3,
    replayHash: "b".repeat(64),
    replayBytes: 120,
    attestation,
    verifierSignature: "c".repeat(128),
    recoveryId: 1,
  };
  assert.deepEqual(parseVerifiedReplayResponse(verified), verified);
  assert.throws(() =>
    parseVerifiedReplayResponse({ ...verified, verifierSignature: "invalid" }),
  );

  const scoreRecord = {
    sessionId: attestation.sessionId,
    playerId: attestation.playerId,
    gameId: attestation.gameId,
    rulesetVersion: attestation.rulesetVersion,
    score: attestation.score,
    replayHash: attestation.replayHash,
    verifierPublicKey: "d".repeat(128),
    acceptedAtNs: "123456700",
  };
  const outcome = {
    status: {
      SuccessValue: Buffer.from(JSON.stringify(scoreRecord)).toString("base64"),
    },
  };
  assert.deepEqual(scoreRecordFromOutcome(outcome), scoreRecord);
});

test("tournament join outcomes decode account-bound entries", () => {
  const entry = {
    tournamentId: "weekly-001",
    playerId: "player.testnet",
    joinedAtNs: "123",
    acceptedRuns: 0,
    bestScore: null,
    bestSessionId: null,
    bestReplayHash: null,
    bestAcceptedAtNs: null,
    bestAcceptedBlockHeight: null,
  };
  const outcome = {
    status: {
      SuccessValue: Buffer.from(JSON.stringify(entry)).toString("base64"),
    },
  };
  assert.deepEqual(tournamentEntryFromOutcome(outcome), entry);
  assert.throws(() =>
    tournamentEntryFromOutcome({
      status: {
        SuccessValue: Buffer.from(
          JSON.stringify({ ...entry, joinedAtNs: "later" }),
        ).toString("base64"),
      },
    }),
  );
});
