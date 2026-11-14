import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { KeyPair, transactions } from "near-api-js";

import { ApiError } from "../src/errors.js";
import { derivePlayerAccountId } from "../src/policy.js";
import {
  decodeAndValidateFastAuthRequest,
  decodeAndValidateSignedDelegate,
  normalizeRelayOutcome,
} from "../src/relayer.js";

const contractId = "arcade.testnet";
const sponsorAccountId = "arcade-sponsor.testnet";

const encodeSignedDelegate = (
  delegateAction: object,
  keyPair: ReturnType<typeof KeyPair.fromRandom>,
): string => {
  const message = transactions.encodeDelegateAction(delegateAction as never);
  const digest = createHash("sha256").update(message).digest();
  const signature = keyPair.sign(digest).signature;
  return Buffer.from(
    transactions.encodeSignedDelegate({
      delegateAction,
      signature: new transactions.Signature({ keyType: 0, data: signature } as never),
    } as never),
  ).toString("base64");
};

const signedDelegate = (
  methodName = "create_session",
  args: object = {
    game_id: "cloud-hop",
    ruleset_version: "cloud-hop-v1",
    tournament_id: null,
  },
  gas = 70_000_000_000_000n,
  deposit = 5_000_000_000_000_000_000_000n,
) => {
  const keyPair = KeyPair.fromRandom("ED25519");
  const delegateAction = {
    senderId: "pilot.testnet",
    receiverId: contractId,
    actions: [transactions.functionCall(methodName, args, gas, deposit)],
    nonce: 1n,
    maxBlockHeight: 1_000n,
    publicKey: keyPair.getPublicKey(),
  };
  return {
    body: { signedDelegateAction: encodeSignedDelegate(delegateAction, keyPair) },
    publicKey: keyPair.getPublicKey().toString(),
  };
};

test("valid Meteor session delegates pass the bounded relay policy", () => {
  const candidate = signedDelegate();
  const decoded = decodeAndValidateSignedDelegate(candidate.body, contractId);
  assert.equal(decoded.signedDelegate.delegateAction.senderId, "pilot.testnet");
  assert.equal(decoded.publicKey, candidate.publicKey);
});

const googleSigningRequest = (alterPayload = false) => {
  const accountKey = KeyPair.fromRandom("ED25519");
  const accountId = derivePlayerAccountId(
    accountKey.getPublicKey().toString(),
    sponsorAccountId,
  );
  const arcadeDelegate = {
    senderId: accountId,
    receiverId: contractId,
    actions: [
      transactions.functionCall(
        "create_session",
        {
          game_id: "cloud-hop",
          ruleset_version: "cloud-hop-v1",
          tournament_id: null,
        },
        70_000_000_000_000n,
        5_000_000_000_000_000_000_000n,
      ),
    ],
    nonce: 1n,
    maxBlockHeight: 1_000n,
    publicKey: accountKey.getPublicKey(),
  };
  const arcadeMessage = transactions.encodeDelegateAction(arcadeDelegate as never);
  const signPayload = Buffer.from(arcadeMessage);
  if (alterPayload) signPayload[0] = signPayload[0]! ^ 1;
  return {
    accountId,
    body: {
      arcadeDelegateAction: Buffer.from(arcadeMessage).toString("base64"),
      signatureRequest: {
        guardId: "jwt#https://login.testnet.fast-auth.com/",
        verifyPayload: `${"a".repeat(40)}.${"b".repeat(80)}.${"c".repeat(40)}`,
        signPayload: Array.from(signPayload),
        algorithm: "eddsa",
      },
    },
  };
};

test("Google FastAuth signing is sponsored only for its matching arcade delegate", () => {
  const candidate = googleSigningRequest();
  const decoded = decodeAndValidateFastAuthRequest(candidate.body, {
    contractId,
    fastAuthDomain: "login.testnet.fast-auth.com",
    sponsorAccountId,
  });
  assert.equal(decoded.accountId, candidate.accountId);
  assert.deepEqual(decoded.args.sign_payload, candidate.body.signatureRequest.signPayload);

  assert.throws(
    () =>
      decodeAndValidateFastAuthRequest(googleSigningRequest(true).body, {
        contractId,
        fastAuthDomain: "login.testnet.fast-auth.com",
        sponsorAccountId,
      }),
    (error: unknown) =>
      error instanceof ApiError && error.code === "FAST_AUTH_PAYLOAD_MISMATCH",
  );
});

test("relay policy rejects non-arcade methods and excessive costs", () => {
  assert.throws(
    () =>
      decodeAndValidateSignedDelegate(
        signedDelegate("set_global_pause", { paused: false }).body,
        contractId,
      ),
    (error: unknown) =>
      error instanceof ApiError && error.code === "DELEGATE_ACTION_NOT_ALLOWED",
  );
  assert.throws(
    () =>
      decodeAndValidateSignedDelegate(
        signedDelegate(
          "create_session",
          {
            game_id: "cloud-hop",
            ruleset_version: "cloud-hop-v1",
            tournament_id: null,
          },
          70_000_000_000_001n,
        ).body,
        contractId,
      ),
    (error: unknown) =>
      error instanceof ApiError && error.code === "DELEGATE_COST_NOT_ALLOWED",
  );
});

test("relay policy rejects altered signatures and unexpected arguments", () => {
  const candidate = signedDelegate();
  const bytes = Buffer.from(candidate.body.signedDelegateAction, "base64");
  const finalByte = bytes.length - 1;
  bytes[finalByte] = bytes[finalByte]! ^ 1;
  assert.throws(
    () =>
      decodeAndValidateSignedDelegate(
        { signedDelegateAction: bytes.toString("base64") },
        contractId,
      ),
    (error: unknown) =>
      error instanceof ApiError && error.code === "INVALID_DELEGATE_SIGNATURE",
  );
  assert.throws(
    () =>
      decodeAndValidateSignedDelegate(
        signedDelegate("join_tournament", {
          tournament_id: "weekly-one",
          unauthorized: true,
        }, 60_000_000_000_000n, 0n).body,
        contractId,
      ),
    (error: unknown) =>
      error instanceof ApiError && error.code === "INVALID_RELAY_ARGS",
  );
});

test("relay outcomes expose the inner arcade receipt and reject inner failures", () => {
  const outcome = {
    status: { SuccessValue: "" },
    transaction: { hash: "transaction-hash" },
    receipts_outcome: [
      {
        outcome: {
          executor_id: "pilot.testnet",
          status: { SuccessValue: "" },
        },
      },
      {
        outcome: {
          executor_id: contractId,
          status: { SuccessValue: "encoded-contract-result" },
        },
      },
    ],
  };
  assert.equal(
    normalizeRelayOutcome(outcome, contractId).status.SuccessValue,
    "encoded-contract-result",
  );

  assert.throws(
    () =>
      normalizeRelayOutcome(
        {
          ...outcome,
          receipts_outcome: [
            {
              outcome: {
                executor_id: contractId,
                status: {
                  Failure: {
                    ActionError: {
                      kind: { FunctionCallError: { ExecutionError: "Arcade is paused." } },
                    },
                  },
                },
              },
            },
          ],
        },
        contractId,
      ),
    (error: unknown) =>
      error instanceof ApiError &&
      error.code === "RELAY_EXECUTION_FAILED" &&
      /Arcade is paused/.test(error.message),
  );
});
