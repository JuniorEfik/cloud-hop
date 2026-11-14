import { createECDH, createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  connect,
  keyStores,
  KeyPair,
  transactions,
} from "near-api-js";

import { serializeRuleset } from "../packages/game-core/dist/src/index.js";
import { updateEnvFile } from "./env-file.mjs";

const repositoryDirectory = path.resolve(import.meta.dirname, "..");
const envPath = path.join(repositoryDirectory, ".env");
const examplePath = path.join(repositoryDirectory, ".env.example");
const wasmPath = path.join(repositoryDirectory, "contracts/arcade/build/arcade.wasm");

if (!existsSync(envPath)) {
  throw new Error("Run npm run provision:testnet before deploying the contract.");
}
process.loadEnvFile(envPath);

const networkId = process.env.NEAR_NETWORK_ID ?? "testnet";
const rpcUrl = process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com";
const explorerUrl =
  process.env.NEAR_EXPLORER_URL ?? "https://testnet.nearblocks.io";
const helperUrl =
  process.env.NEAR_TESTNET_HELPER_URL ?? "https://helper.testnet.near.org";
const sponsorAccountId = process.env.NEAR_SPONSOR_ACCOUNT_ID;
const sponsorPrivateKey = process.env.NEAR_SPONSOR_PRIVATE_KEY;
const verifierPrivateKey = process.env.NEAR_VERIFIER_PRIVATE_KEY;

if (networkId !== "testnet") throw new Error("Arcade deployment is Testnet-only.");
if (!sponsorAccountId || !sponsorPrivateKey) {
  throw new Error("The Testnet sponsor credentials are missing from .env.");
}
if (!verifierPrivateKey || !/^[a-f0-9]{64}$/.test(verifierPrivateKey)) {
  throw new Error(
    "Run npm run provision:testnet to configure the replay verifier key.",
  );
}
if (!existsSync(wasmPath)) {
  throw new Error("Build the arcade contract before deploying it.");
}

let contractId = process.env.NEAR_CONTRACT_ID;
let contractPrivateKey = process.env.NEAR_CONTRACT_PRIVATE_KEY;
let createdContractAccount = false;

if (!contractId && !contractPrivateKey) {
  const keyPair = KeyPair.fromRandom("ED25519");
  contractId = `near-arcade-contract-${randomBytes(5).toString("hex")}.testnet`;
  createdContractAccount = true;
  contractPrivateKey = keyPair.toString();
  const response = await fetch(`${helperUrl}/account`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      newAccountId: contractId,
      newAccountPublicKey: keyPair.getPublicKey().toString(),
    }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Testnet helper returned ${response.status}: ${detail}`);
  }
  await updateEnvFile(envPath, examplePath, {
    NEAR_CONTRACT_ID: contractId,
    NEAR_CONTRACT_PRIVATE_KEY: contractPrivateKey,
  });
  console.log(`Created funded Testnet contract account: ${contractId}`);
} else if (!contractId || !contractPrivateKey) {
  throw new Error(
    "NEAR_CONTRACT_ID and NEAR_CONTRACT_PRIVATE_KEY must both be configured.",
  );
}

const keyStore = new keyStores.InMemoryKeyStore();
const contractKeyPair = KeyPair.fromString(contractPrivateKey);
await keyStore.setKey(networkId, contractId, contractKeyPair);
await keyStore.setKey(
  networkId,
  sponsorAccountId,
  KeyPair.fromString(sponsorPrivateKey),
);
const near = await connect({ networkId, nodeUrl: rpcUrl, deps: { keyStore } });
const contract = await near.account(contractId);
const owner = await near.account(sponsorAccountId);
const wasm = await readFile(wasmPath);

const rulesetHash = createHash("sha256").update(serializeRuleset()).digest("hex");
const verifier = createECDH("secp256k1");
verifier.setPrivateKey(Buffer.from(verifierPrivateKey, "hex"));
const verifierPublicKey = verifier
  .getPublicKey(undefined, "uncompressed")
  .subarray(1)
  .toString("hex");

const callInit = transactions.functionCall(
  "init",
  {
    owner_id: sponsorAccountId,
    ruleset_hash: rulesetHash,
    verifier_public_key: verifierPublicKey,
  },
  100_000_000_000_000n,
  0n,
);

let accountExists = true;
try {
  await near.connection.provider.query({
    request_type: "view_account",
    finality: "final",
    account_id: contractId,
  });
} catch (error) {
  accountExists = !/UNKNOWN_ACCOUNT|does not exist|doesn't exist|AccountDoesNotExist/i.test(
    String(error),
  );
  if (accountExists) throw error;
}

if (!accountExists) {
  throw new Error(
    "The configured contract account does not exist. Clear both contract values in .env to provision a replacement.",
  );
}

let initialized = !createdContractAccount;
if (accountExists && !createdContractAccount) {
  try {
    await contract.viewFunction({
      contractId,
      methodName: "get_contract_config",
      args: {},
    });
    initialized = true;
  } catch (error) {
    const message = String(error);
    initialized = !/MethodNotFound|CodeDoesNotExist|must be initialized|not initialized/i.test(
      message,
    );
  }
}

const outcome = await contract.signAndSendTransaction({
  receiverId: contractId,
  actions: [
    transactions.deployContract(wasm),
    ...(initialized ? [] : [callInit]),
  ],
});

const deployedConfig = await contract.viewFunction({
  contractId,
  methodName: "get_contract_config",
  args: {},
});
if (deployedConfig.ownerId !== sponsorAccountId) {
  throw new Error("The configured sponsor is not the deployed contract owner.");
}

let verifierOutcome = null;
if (deployedConfig.verifierPublicKey !== verifierPublicKey) {
  verifierOutcome = await owner.signAndSendTransaction({
    receiverId: contractId,
    actions: [
      transactions.functionCall(
        "set_verifier_key",
        { verifier_public_key: verifierPublicKey },
        30_000_000_000_000n,
        0n,
      ),
    ],
  });
}

let currentTournament = await contract.viewFunction({
  contractId,
  methodName: "get_current_tournament",
  args: { game_id: "cloud-hop" },
});
let finalizedTournamentOutcome = null;
if (currentTournament?.status === "closed") {
  finalizedTournamentOutcome = await owner.signAndSendTransaction({
    receiverId: contractId,
    actions: [
      transactions.functionCall(
        "finalize_tournament",
        { tournament_id: currentTournament.tournamentId },
        150_000_000_000_000n,
        0n,
      ),
    ],
  });
  currentTournament = await contract.viewFunction({
    contractId,
    methodName: "get_current_tournament",
    args: { game_id: "cloud-hop" },
  });
}

let tournamentOutcome = null;
if (currentTournament === null || currentTournament.status === "finalized") {
  const finalBlock = await near.connection.provider.block({ finality: "final" });
  const chainTimestampNs = BigInt(finalBlock.header.timestamp_nanosec);
  const startAtNs = chainTimestampNs + 20_000_000_000n;
  const registrationEndsAtNs = startAtNs + 7n * 86_400_000_000_000n;
  const tournamentId = `weekly-${(startAtNs / 1_000_000_000n).toString(36)}`;
  tournamentOutcome = await owner.signAndSendTransaction({
    receiverId: contractId,
    actions: [
      transactions.functionCall(
        "create_tournament",
        {
          tournament_id: tournamentId,
          game_id: "cloud-hop",
          ruleset_version: "cloud-hop-v1",
          start_at_ns: startAtNs.toString(),
          registration_ends_at_ns: registrationEndsAtNs.toString(),
          max_participants: 500,
          reward_description:
            "Non-transferable achievements and leaderboard recognition; no token reward.",
        },
        150_000_000_000_000n,
        0n,
      ),
    ],
  });
  currentTournament = await contract.viewFunction({
    contractId,
    methodName: "get_current_tournament",
    args: { game_id: "cloud-hop" },
  });
}

await updateEnvFile(envPath, examplePath, { NEAR_CONTRACT_ID: contractId });

console.log(`Arcade contract deployed: ${contractId}`);
console.log(`Ruleset SHA-256: ${rulesetHash}`);
console.log(`${explorerUrl}/txns/${outcome.transaction.hash}`);
if (verifierOutcome !== null) {
  console.log(
    `Verifier key configured: ${explorerUrl}/txns/${verifierOutcome.transaction.hash}`,
  );
}
if (finalizedTournamentOutcome !== null) {
  console.log(
    `Previous tournament finalized: ${explorerUrl}/txns/${finalizedTournamentOutcome.transaction.hash}`,
  );
}
if (tournamentOutcome !== null) {
  console.log(
    `Weekly tournament scheduled: ${currentTournament.tournamentId} (${explorerUrl}/txns/${tournamentOutcome.transaction.hash})`,
  );
} else if (currentTournament !== null) {
  console.log(
    `Weekly tournament retained: ${currentTournament.tournamentId} (${currentTournament.status})`,
  );
}
