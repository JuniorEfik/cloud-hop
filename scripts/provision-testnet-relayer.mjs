import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

import { KeyPair, providers } from "near-api-js";

import { updateEnvFile } from "./env-file.mjs";

const repositoryDirectory = path.resolve(import.meta.dirname, "..");
const envPath = path.join(repositoryDirectory, ".env");
const examplePath = path.join(repositoryDirectory, ".env.example");

if (existsSync(envPath)) process.loadEnvFile(envPath);

const rpcUrl = process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com";
const helperUrl =
  process.env.NEAR_TESTNET_HELPER_URL ?? "https://helper.testnet.near.org";
const existingAccountId = process.env.NEAR_RELAYER_ACCOUNT_ID;
const existingPrivateKey = process.env.NEAR_RELAYER_PRIVATE_KEY;
const provider = new providers.JsonRpcProvider({ url: rpcUrl });

const waitForAccount = async (accountId, attempts = 30, delayMs = 500) => {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await provider.query({
        request_type: "view_account",
        finality: "final",
        account_id: accountId,
      });
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw new Error(
    `Relayer account ${accountId} did not become visible through ${rpcUrl}`,
    { cause: lastError },
  );
};

if (existingAccountId && existingPrivateKey) {
  const account = await waitForAccount(existingAccountId);
  console.log(`Relayer already configured: ${existingAccountId}`);
  console.log(`Testnet balance: ${account.amount} yoctoNEAR`);
  process.exit(0);
}

const suffix = randomBytes(5).toString("hex");
const accountId = `near-arcade-relayer-${suffix}.testnet`;
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

await updateEnvFile(envPath, examplePath, {
  NEAR_RELAYER_ACCOUNT_ID: accountId,
  NEAR_RELAYER_PRIVATE_KEY: keyPair.toString(),
});

console.log(`Faucet accepted Testnet relayer request: ${accountId}`);
console.log("Stored the relayer key in .env with owner-only permissions.");

const account = await waitForAccount(accountId);

console.log(`Created faucet-funded Testnet relayer: ${accountId}`);
console.log(`Testnet balance: ${account.amount} yoctoNEAR`);
