import { createECDH, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

import { KeyPair, providers } from "near-api-js";

import { updateEnvFile } from "./env-file.mjs";

const repositoryDirectory = path.resolve(import.meta.dirname, "..");
const envPath = path.join(repositoryDirectory, ".env");
const examplePath = path.join(repositoryDirectory, ".env.example");

if (existsSync(envPath)) process.loadEnvFile(envPath);

const rpcUrl = process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com";
const helperUrl = process.env.NEAR_TESTNET_HELPER_URL ?? "https://helper.testnet.near.org";
const existingAccountId = process.env.NEAR_SPONSOR_ACCOUNT_ID;
const existingPrivateKey = process.env.NEAR_SPONSOR_PRIVATE_KEY;
const existingVerifierPrivateKey = process.env.NEAR_VERIFIER_PRIVATE_KEY;
const provider = new providers.JsonRpcProvider({ url: rpcUrl });

const updates = {};
if (!existingVerifierPrivateKey) {
  const verifier = createECDH("secp256k1");
  verifier.generateKeys();
  updates.NEAR_VERIFIER_PRIVATE_KEY = verifier.getPrivateKey().toString("hex");
}

if (existingAccountId && existingPrivateKey) {
  if (Object.keys(updates).length > 0) {
    await updateEnvFile(envPath, examplePath, updates);
    console.log("Generated a server-only replay verifier key.");
  }
  const account = await provider.query({
    request_type: "view_account",
    finality: "final",
    account_id: existingAccountId,
  });
  console.log(`Sponsor already configured: ${existingAccountId}`);
  console.log(`Testnet balance: ${account.amount} yoctoNEAR`);
  process.exit(0);
}

const suffix = randomBytes(5).toString("hex");
const accountId = `near-arcade-sponsor-${suffix}.testnet`;
const keyPair = KeyPair.fromRandom("ED25519");

const response = await fetch(`${helperUrl}/account`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify({
    newAccountId: accountId,
    newAccountPublicKey: keyPair.getPublicKey().toString(),
  }),
});

if (!response.ok) {
  const detail = (await response.text()).slice(0, 500);
  throw new Error(`Testnet helper returned ${response.status}: ${detail}`);
}

const account = await provider.query({
  request_type: "view_account",
  finality: "final",
  account_id: accountId,
});

await updateEnvFile(envPath, examplePath, {
  ...updates,
  NEAR_SPONSOR_ACCOUNT_ID: accountId,
  NEAR_SPONSOR_PRIVATE_KEY: keyPair.toString(),
  NEAR_SPONSOR_GAS_KEY_ALLOWANCE_NEAR: "0.05",
});

console.log(`Created funded Testnet sponsor: ${accountId}`);
console.log(`Testnet balance: ${account.amount} yoctoNEAR`);
console.log("Stored sponsor and verifier secrets in .env with owner-only permissions.");
