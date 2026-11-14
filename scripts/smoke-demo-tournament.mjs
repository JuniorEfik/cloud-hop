import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

import { connect, keyStores, KeyPair, transactions } from "near-api-js";

import { config } from "../apps/api/dist/src/config.js";
import { ReplayVerifierService } from "../apps/api/dist/src/replay-verifier.js";
import {
  createInitialState,
  createReplay,
  gameSeedFromChainSeed,
  RULESET_V1,
  serializeRuleset,
  stepGame,
} from "../packages/game-core/dist/src/index.js";

const repositoryDirectory = path.resolve(import.meta.dirname, "..");
const envPath = path.join(repositoryDirectory, ".env");
if (!existsSync(envPath)) throw new Error("The .env file is missing.");
process.loadEnvFile(envPath);

const networkId = process.env.NEAR_NETWORK_ID ?? "testnet";
const rpcUrl = process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com";
const explorerUrl =
  process.env.NEAR_EXPLORER_URL ?? "https://testnet.nearblocks.io";
const contractId = process.env.NEAR_CONTRACT_ID;
const contractPrivateKey = process.env.NEAR_CONTRACT_PRIVATE_KEY;
const ownerId = process.env.NEAR_SPONSOR_ACCOUNT_ID;
const ownerPrivateKey = process.env.NEAR_SPONSOR_PRIVATE_KEY;

if (
  networkId !== "testnet" ||
  !contractId ||
  !contractPrivateKey ||
  !ownerId ||
  !ownerPrivateKey
) {
  throw new Error("Complete Testnet contract and owner credentials are required.");
}

const keyStore = new keyStores.InMemoryKeyStore();
await keyStore.setKey(
  networkId,
  contractId,
  KeyPair.fromString(contractPrivateKey),
);
await keyStore.setKey(networkId, ownerId, KeyPair.fromString(ownerPrivateKey));
const near = await connect({ networkId, nodeUrl: rpcUrl, deps: { keyStore } });
const player = await near.account(contractId);
const owner = await near.account(ownerId);
const gameId = "cloud-hop-demo";
const rulesetVersion = "cloud-hop-v1";
const demoDurationNs = 300_000_000_000n;

const view = (methodName, args) =>
  player.viewFunction({ contractId, methodName, args });

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const waitForStatus = async (tournamentId, expected, attempts) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const tournament = await view("get_tournament", {
      tournament_id: tournamentId,
    });
    if (tournament?.status === expected) return tournament;
    if (tournament?.status === "finalized" && expected !== "finalized") {
      throw new Error("Demo tournament finalized before the expected checkpoint.");
    }
    if (attempt % 4 === 0) {
      console.log(
        `Waiting for ${tournamentId} to become ${expected}; current status ${tournament?.status ?? "missing"}.`,
      );
    }
    await sleep(5_000);
  }
  throw new Error(`Demo tournament did not become ${expected} in time.`);
};

const finalizeAndVerify = async (tournamentId) => {
  const transaction = await owner.signAndSendTransaction({
    receiverId: contractId,
    actions: [
      transactions.functionCall(
        "finalize_tournament",
        { tournament_id: tournamentId },
        180_000_000_000_000n,
        0n,
      ),
    ],
  });
  const finalized = await view("get_tournament", {
    tournament_id: tournamentId,
  });
  if (
    finalized?.status !== "finalized" ||
    !/^[a-f0-9]{64}$/.test(finalized.resultHash ?? "") ||
    finalized.resultCount !== 1 ||
    finalized.podium?.[0]?.playerId !== contractId ||
    finalized.podium?.[0]?.score !== 1
  ) {
    throw new Error("The accelerated demo finalization record is invalid.");
  }

  let rewriteRejected = false;
  try {
    await owner.signAndSendTransaction({
      receiverId: contractId,
      actions: [
        transactions.functionCall(
          "finalize_tournament",
          { tournament_id: tournamentId },
          180_000_000_000_000n,
          0n,
        ),
      ],
    });
  } catch (error) {
    rewriteRejected = /already finalized/i.test(String(error));
  }
  if (!rewriteRejected) {
    throw new Error("The accelerated demo did not reject finalization rewrite.");
  }
  return { finalized, transaction };
};

const rulesetHash = createHash("sha256")
  .update(serializeRuleset())
  .digest("hex");
let ruleset = await view("get_ruleset", {
  game_id: gameId,
  version: rulesetVersion,
});
let rulesetTransaction = null;
if (ruleset === null) {
  rulesetTransaction = await owner.signAndSendTransaction({
    receiverId: contractId,
    actions: [
      transactions.functionCall(
        "register_ruleset",
        {
          game_id: gameId,
          version: rulesetVersion,
          ruleset_hash: rulesetHash,
          max_score: RULESET_V1.maxScore,
          session_ttl_ns: "900000000000",
          activate: true,
        },
        60_000_000_000_000n,
        0n,
      ),
    ],
  });
  ruleset = await view("get_ruleset", {
    game_id: gameId,
    version: rulesetVersion,
  });
}
if (ruleset?.rulesetHash !== rulesetHash) {
  throw new Error("The demo game ruleset does not match the verifier build.");
}

let current = await view("get_current_tournament", { game_id: gameId });
if (current?.status === "closed") {
  const resumed = await finalizeAndVerify(current.tournamentId);
  console.log(`Finalized accelerated demo: ${resumed.finalized.tournamentId}`);
  console.log(`Result hash: ${resumed.finalized.resultHash}`);
  console.log(
    `Finalization: ${explorerUrl}/txns/${resumed.transaction.transaction.hash}`,
  );
  console.log("Finalization rewrite was rejected on Testnet.");
  process.exit(0);
}
if (current?.status === "finalized") {
  console.log(`Accelerated demo already finalized: ${current.tournamentId}`);
  console.log(`Result hash: ${current.resultHash}`);
  process.exit(0);
}

let tournamentTransaction = null;
if (current === null) {
  const finalBlock = await near.connection.provider.block({ finality: "final" });
  const chainTimestampNs = BigInt(finalBlock.header.timestamp_nanosec);
  const startAtNs = chainTimestampNs + 20_000_000_000n;
  const endAtNs = startAtNs + demoDurationNs;
  const tournamentId = `demo-${(startAtNs / 1_000_000_000n).toString(36)}`;
  tournamentTransaction = await owner.signAndSendTransaction({
    receiverId: contractId,
    actions: [
      transactions.functionCall(
        "create_tournament",
        {
          tournament_id: tournamentId,
          game_id: gameId,
          ruleset_version: rulesetVersion,
          start_at_ns: startAtNs.toString(),
          registration_ends_at_ns: endAtNs.toString(),
          max_participants: 10,
          reward_description:
            "Accelerated Testnet lifecycle proof; no token reward.",
          tournament_kind: "demo",
          duration_ns: demoDurationNs.toString(),
        },
        180_000_000_000_000n,
        0n,
      ),
    ],
  });
  current = await view("get_current_tournament", { game_id: gameId });
}

if (
  current === null ||
  current.kind !== "demo" ||
  current.gameId !== gameId ||
  BigInt(current.endAtNs) - BigInt(current.startAtNs) !== demoDurationNs ||
  current.rewardType !== "none"
) {
  throw new Error("The accelerated demo tournament configuration is invalid.");
}

let entry = await view("get_tournament_entry", {
  tournament_id: current.tournamentId,
  account_id: contractId,
});
let joinTransaction = null;
if (entry === null) {
  joinTransaction = await player.signAndSendTransaction({
    receiverId: contractId,
    actions: [
      transactions.functionCall(
        "join_tournament",
        { tournament_id: current.tournamentId },
        60_000_000_000_000n,
        0n,
      ),
    ],
  });
  entry = await view("get_tournament_entry", {
    tournament_id: current.tournamentId,
    account_id: contractId,
  });
}
if (entry?.playerId !== contractId) {
  throw new Error("The accelerated tournament registration is missing.");
}

current = await waitForStatus(current.tournamentId, "active", 30);

if (entry.acceptedRuns === 0) {
  const activeSession = await view("get_active_session", { account_id: contractId });
  if (activeSession?.status === "active") {
    await player.signAndSendTransaction({
      receiverId: contractId,
      actions: [
        transactions.functionCall(
          "abandon_session",
          { session_id: activeSession.sessionId },
          30_000_000_000_000n,
          0n,
        ),
      ],
    });
  }

  await player.signAndSendTransaction({
    receiverId: contractId,
    actions: [
      transactions.functionCall(
        "create_session",
        {
          game_id: gameId,
          ruleset_version: rulesetVersion,
          tournament_id: current.tournamentId,
        },
        70_000_000_000_000n,
        5_000_000_000_000_000_000_000n,
      ),
    ],
  });
  const session = await view("get_active_session", { account_id: contractId });
  if (
    session?.status !== "active" ||
    session.gameId !== gameId ||
    session.tournamentId !== current.tournamentId
  ) {
    throw new Error("The accelerated demo session was not bound correctly.");
  }

  const gameSeed = gameSeedFromChainSeed(session.seed);
  let gameState = createInitialState(gameSeed);
  const flapTicks = [];
  while (gameState.status === "running") {
    const nextObstacle = gameState.obstacles.find(
      (obstacle) =>
        obstacle.x + RULESET_V1.obstacleWidth >=
        RULESET_V1.birdX - RULESET_V1.birdWidth / 2,
    );
    const targetY =
      nextObstacle !== undefined && nextObstacle.x < 300_000
        ? nextObstacle.gapTop + RULESET_V1.obstacleGap / 2
        : RULESET_V1.birdStartY;
    const flap =
      gameState.score < 1 &&
      gameState.birdY > targetY + 8_000 &&
      gameState.birdVelocity > -2_500;
    if (flap) flapTicks.push(gameState.tick);
    gameState = stepGame(gameState, flap);
  }
  if (gameState.score !== 1) {
    throw new Error("The accelerated demo replay did not finish with score 1.");
  }
  const replay = createReplay(gameSeed, gameState.tick, flapTicks);
  const verified = await new ReplayVerifierService(config).verifyAndAttest(
    session.sessionId,
    { playerId: contractId, claimedScore: gameState.score, replay },
  );
  await player.signAndSendTransaction({
    receiverId: contractId,
    actions: [
      transactions.functionCall(
        "submit_verified_score",
        {
          session_id: session.sessionId,
          score: verified.score,
          replay_hash: verified.replayHash,
          attestation_expires_at_ns: verified.attestation.expiresAtNs,
          verifier_signature: verified.verifierSignature,
          recovery_id: verified.recoveryId,
        },
        180_000_000_000_000n,
        0n,
      ),
    ],
  });
}

entry = await view("get_tournament_entry", {
  tournament_id: current.tournamentId,
  account_id: contractId,
});
const board = await view("get_tournament_leaderboard_page", {
  tournament_id: current.tournamentId,
  cursor: 0,
  limit: 10,
});
if (
  entry?.acceptedRuns < 1 ||
  entry.bestScore !== 1 ||
  board.rows?.[0]?.playerId !== contractId ||
  board.rows?.[0]?.rank !== 1
) {
  throw new Error("The accelerated demo ranking is inconsistent.");
}

current = await waitForStatus(current.tournamentId, "closed", 80);
let lateSessionRejected = false;
try {
  await player.signAndSendTransaction({
    receiverId: contractId,
    actions: [
      transactions.functionCall(
        "create_session",
        {
          game_id: gameId,
          ruleset_version: rulesetVersion,
          tournament_id: current.tournamentId,
        },
        70_000_000_000_000n,
        5_000_000_000_000_000_000_000n,
      ),
    ],
  });
} catch (error) {
  lateSessionRejected = /not active/i.test(String(error));
}
if (!lateSessionRejected) {
  throw new Error("The accelerated demo did not reject a late session.");
}

const { finalized, transaction: finalizedTransaction } =
  await finalizeAndVerify(current.tournamentId);

console.log(`Finalized accelerated demo: ${finalized.tournamentId}`);
console.log(`Result hash: ${finalized.resultHash}`);
console.log(
  `Finalization: ${explorerUrl}/txns/${finalizedTransaction.transaction.hash}`,
);
if (rulesetTransaction !== null) {
  console.log(
    `Demo ruleset: ${explorerUrl}/txns/${rulesetTransaction.transaction.hash}`,
  );
}
if (tournamentTransaction !== null) {
  console.log(
    `Demo tournament: ${explorerUrl}/txns/${tournamentTransaction.transaction.hash}`,
  );
}
if (joinTransaction !== null) {
  console.log(
    `Demo registration: ${explorerUrl}/txns/${joinTransaction.transaction.hash}`,
  );
}
console.log("Late session and finalization rewrite were rejected on Testnet.");
