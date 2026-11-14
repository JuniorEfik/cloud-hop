import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { secp256k1 } from "@noble/curves/secp256k1";

import { parseNearAmount } from "./policy.js";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = path.resolve(sourceDirectory, "../../../..");
const envFile = process.env.ENV_FILE ?? path.join(repositoryDirectory, ".env");

if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const integer = (name: string, fallback: number, minimum: number, maximum: number) => {
  const value = Number.parseInt(process.env[name] ?? String(fallback), 10);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return value;
};

const networkId = process.env.NEAR_NETWORK_ID ?? "testnet";
if (networkId !== "testnet") {
  throw new Error("The onboarding sponsor is intentionally restricted to NEAR Testnet.");
}

const initialBalance = parseNearAmount(
  process.env.NEAR_SPONSOR_INITIAL_BALANCE_NEAR ?? "0.05",
);
const gasKeyAllowance = parseNearAmount(
  process.env.NEAR_SPONSOR_GAS_KEY_ALLOWANCE_NEAR ?? "0.05",
);
const verifierPrivateKey = process.env.NEAR_VERIFIER_PRIVATE_KEY ?? "";

if (
  verifierPrivateKey.length > 0 &&
  (!/^[a-f0-9]{64}$/.test(verifierPrivateKey) ||
    !secp256k1.utils.isValidPrivateKey(verifierPrivateKey))
) {
  throw new Error(
    "NEAR_VERIFIER_PRIVATE_KEY must be a lowercase 32-byte secp256k1 key.",
  );
}

const verifierPublicKey =
  verifierPrivateKey.length === 0
    ? ""
    : Buffer.from(secp256k1.getPublicKey(verifierPrivateKey, false).slice(1)).toString(
        "hex",
      );

if (initialBalance > parseNearAmount("0.1")) {
  throw new Error("NEAR_SPONSOR_INITIAL_BALANCE_NEAR cannot exceed 0.1.");
}
if (gasKeyAllowance > parseNearAmount("0.05")) {
  throw new Error("NEAR_SPONSOR_GAS_KEY_ALLOWANCE_NEAR cannot exceed 0.05.");
}

export const config = Object.freeze({
  networkId,
  rpcUrl: process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com",
  explorerUrl: process.env.NEAR_EXPLORER_URL ?? "https://testnet.nearblocks.io",
  contractId:
    process.env.NEAR_CONTRACT_ID ?? "near-arcade-contract-bf1dd35d6d.testnet",
  fastAuthClientId:
    process.env.NEAR_FAST_AUTH_CLIENT_ID ?? "np8paqIpMWmNbzT4xAvOOapZBjsOpptl",
  fastAuthDomain: "login.testnet.fast-auth.com",
  fastAuthContractId:
    process.env.NEAR_FAST_AUTH_CONTRACT_ID ?? "fast-auth.testnet",
  mpcContractId:
    process.env.NEAR_MPC_CONTRACT_ID ?? "v1.signer-prod.testnet",
  sponsorAccountId: process.env.NEAR_SPONSOR_ACCOUNT_ID ?? "",
  sponsorPrivateKey: process.env.NEAR_SPONSOR_PRIVATE_KEY ?? "",
  sponsorInitialBalance: initialBalance,
  sponsorGasKeyAllowance: gasKeyAllowance,
  sponsorDailyLimit: integer("NEAR_SPONSOR_DAILY_LIMIT", 100, 1, 10_000),
  sponsorPerIpDailyLimit: integer(
    "NEAR_SPONSOR_PER_IP_DAILY_LIMIT",
    3,
    1,
    100,
  ),
  relayerAccountId: process.env.NEAR_RELAYER_ACCOUNT_ID ?? "",
  relayerPrivateKey: process.env.NEAR_RELAYER_PRIVATE_KEY ?? "",
  relayerPerIpMinuteLimit: integer(
    "NEAR_RELAYER_PER_IP_MINUTE_LIMIT",
    20,
    1,
    1_000,
  ),
  relayerPerAccountMinuteLimit: integer(
    "NEAR_RELAYER_PER_ACCOUNT_MINUTE_LIMIT",
    10,
    1,
    1_000,
  ),
  relayerDailyLimit: integer("NEAR_RELAYER_DAILY_LIMIT", 500, 1, 100_000),
  relayerMaxBlockTtl: integer("NEAR_RELAYER_MAX_BLOCK_TTL", 1_000, 50, 10_000),
  verifierPrivateKey,
  verifierPublicKey,
  verifierAttestationTtlSeconds: integer(
    "NEAR_VERIFIER_ATTESTATION_TTL_SECONDS",
    120,
    30,
    300,
  ),
  verifierPerIpMinuteLimit: integer(
    "NEAR_VERIFIER_PER_IP_MINUTE_LIMIT",
    30,
    1,
    300,
  ),
  apiHost: process.env.API_HOST ?? "127.0.0.1",
  apiPort: integer(
    "API_PORT",
    Number.parseInt(process.env.PORT ?? "8787", 10),
    1,
    65_535,
  ),
  serveWeb: process.env.SERVE_WEB === "1",
  webOrigins: (process.env.WEB_ORIGINS ??
    "http://127.0.0.1:3000,http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  sponsorConfigured: Boolean(
    process.env.NEAR_SPONSOR_ACCOUNT_ID && process.env.NEAR_SPONSOR_PRIVATE_KEY,
  ),
  relayerConfigured: Boolean(
    process.env.NEAR_RELAYER_ACCOUNT_ID && process.env.NEAR_RELAYER_PRIVATE_KEY,
  ),
  verifierConfigured: Boolean(
    process.env.NEAR_CONTRACT_ID && verifierPrivateKey.length > 0,
  ),
});

export type ApiConfig = typeof config;
