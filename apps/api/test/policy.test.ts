import assert from "node:assert/strict";
import test from "node:test";

import { KeyPair } from "near-api-js";

import { ApiError } from "../src/errors.js";
import {
  DailyRateLimiter,
  derivePlayerAccountId,
  fastAuthPathForGoogleUser,
  isUnknownAccountError,
  parseNearAmount,
  validateGoogleWalletRequest,
} from "../src/policy.js";

test("NEAR decimal amounts convert without floating-point loss", () => {
  assert.equal(parseNearAmount("1"), 10n ** 24n);
  assert.equal(parseNearAmount("0.05"), 50_000_000_000_000_000_000_000n);
  assert.equal(parseNearAmount("0.000000000000000000000001"), 1n);
  assert.throws(() => parseNearAmount("0.0000000000000000000000001"));
});

test("Google wallet requests require distinct valid ed25519 keys", () => {
  const accountKey = KeyPair.fromRandom("ED25519").getPublicKey().toString();
  const gasKey = KeyPair.fromRandom("ED25519").getPublicKey().toString();
  const idToken = `${"a".repeat(40)}.${"b".repeat(80)}.${"c".repeat(40)}`;
  assert.deepEqual(
    validateGoogleWalletRequest({
      userId: "google-oauth2|123456789",
      idToken,
      publicKey: accountKey,
      gasPublicKey: gasKey,
    }),
    {
      userId: "google-oauth2|123456789",
      idToken,
      publicKey: accountKey,
      gasPublicKey: gasKey,
    },
  );
  assert.throws(
    () =>
      validateGoogleWalletRequest({
        userId: "email|123",
        idToken,
        publicKey: accountKey,
        gasPublicKey: gasKey,
      }),
    ApiError,
  );
  assert.throws(
    () =>
      validateGoogleWalletRequest({
        userId: "google-oauth2|123456789",
        idToken,
        publicKey: accountKey,
        gasPublicKey: accountKey,
      }),
    ApiError,
  );
});

test("sponsored account ids are deterministic subaccounts and stay bounded", () => {
  const accountId = derivePlayerAccountId(
    "ed25519:11111111111111111111111111111111",
    "arcade-sponsor.testnet",
  );
  assert.match(accountId, /^g-[a-f0-9]+\.arcade-sponsor\.testnet$/);
  assert.ok(accountId.length <= 64);
  assert.equal(
    derivePlayerAccountId(
      "ed25519:11111111111111111111111111111111",
      "arcade-sponsor.testnet",
    ),
    accountId,
  );
});

test("FastAuth paths bind the testnet issuer and Google subject", () => {
  assert.equal(
    fastAuthPathForGoogleUser(
      "google-oauth2|123",
      "login.testnet.fast-auth.com",
    ),
    "jwt#https://login.testnet.fast-auth.com/#google-oauth2|123",
  );
});

test("missing accounts are distinguished from missing access keys", () => {
  assert.equal(
    isUnknownAccountError(
      new Error("Account player.testnet doesn't exist while viewing account"),
    ),
    true,
  );
  assert.equal(
    isUnknownAccountError(
      new Error("Access key ed25519:abc does not exist for player.testnet"),
    ),
    false,
  );
});

test("daily limiter enforces per-requester and global budgets", () => {
  const limiter = new DailyRateLimiter(2, 3, 1_000);
  limiter.consume("a", 10_000);
  limiter.consume("a", 10_001);
  assert.throws(() => limiter.consume("a", 10_002), /limit/i);
  limiter.consume("b", 10_003);
  assert.throws(() => limiter.consume("c", 10_004), /Daily sponsor/i);
  assert.doesNotThrow(() => limiter.consume("a", 12_000));
});
