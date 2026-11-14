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

if (networkId !== "testnet") throw new Error("The smoke test is Testnet-only.");
if (!contractId || !contractPrivateKey) {
  throw new Error("The deployed contract credentials are missing from .env.");
}

const keyStore = new keyStores.InMemoryKeyStore();
await keyStore.setKey(
  networkId,
  contractId,
  KeyPair.fromString(contractPrivateKey),
);
const near = await connect({ networkId, nodeUrl: rpcUrl, deps: { keyStore } });
const account = await near.account(contractId);

const waitForActiveTournament = async () => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const tournament = await account.viewFunction({
      contractId,
      methodName: "get_current_tournament",
      args: { game_id: "cloud-hop" },
    });
    if (tournament?.status === "active") return tournament;
    if (tournament === null || ["closed", "finalized"].includes(tournament.status)) {
      throw new Error("Deploy a current weekly tournament before running the smoke test.");
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("The scheduled weekly tournament did not become active in time.");
};

const tournament = await waitForActiveTournament();
if (
  tournament.gameId !== "cloud-hop" ||
  tournament.rulesetVersion !== "cloud-hop-v1" ||
  tournament.rewardType !== "none"
) {
  throw new Error("The current weekly tournament configuration is inconsistent.");
}
let tournamentEntryBefore = await account.viewFunction({
  contractId,
  methodName: "get_tournament_entry",
  args: { tournament_id: tournament.tournamentId, account_id: contractId },
});
let joined = null;
if (tournamentEntryBefore === null) {
  joined = await account.signAndSendTransaction({
    receiverId: contractId,
    actions: [
      transactions.functionCall(
        "join_tournament",
        { tournament_id: tournament.tournamentId },
        60_000_000_000_000n,
        0n,
      ),
    ],
  });
  tournamentEntryBefore = await account.viewFunction({
    contractId,
    methodName: "get_tournament_entry",
    args: { tournament_id: tournament.tournamentId, account_id: contractId },
  });
}
if (tournamentEntryBefore?.playerId !== contractId) {
  throw new Error("The live tournament registration was not stored.");
}
let duplicateRegistrationRejected = false;
try {
  await account.signAndSendTransaction({
    receiverId: contractId,
    actions: [
      transactions.functionCall(
        "join_tournament",
        { tournament_id: tournament.tournamentId },
        60_000_000_000_000n,
        0n,
      ),
    ],
  });
} catch (error) {
  duplicateRegistrationRejected = /already joined/i.test(String(error));
}
if (!duplicateRegistrationRejected) {
  throw new Error("The live contract did not reject duplicate tournament registration.");
}

const achievementsBefore = await account.viewFunction({
  contractId,
  methodName: "get_player_achievements",
  args: { account_id: contractId, cursor: 0, limit: 25 },
});

const statsBefore = await account.viewFunction({
  contractId,
  methodName: "get_player_stats",
  args: { account_id: contractId, game_id: "cloud-hop" },
});
const dailyBefore = await account.viewFunction({
  contractId,
  methodName: "get_leaderboard_page",
  args: { game_id: "cloud-hop", period: "daily", cursor: 0, limit: 25 },
});
const dailyBeforeEntry = dailyBefore.rows?.find(
  (entry) => entry.playerId === contractId,
);

const active = await account.viewFunction({
  contractId,
  methodName: "get_active_session",
  args: { account_id: contractId },
});
if (active?.status === "active") {
  await account.signAndSendTransaction({
    receiverId: contractId,
    actions: [
      transactions.functionCall(
        "abandon_session",
        { session_id: active.sessionId },
        30_000_000_000_000n,
        0n,
      ),
    ],
  });
}

const created = await account.signAndSendTransaction({
  receiverId: contractId,
  actions: [
    transactions.functionCall(
      "create_session",
      {
        game_id: "cloud-hop",
        ruleset_version: "cloud-hop-v1",
        tournament_id: tournament.tournamentId,
      },
      70_000_000_000_000n,
      5_000_000_000_000_000_000_000n,
    ),
  ],
});

const session = await account.viewFunction({
  contractId,
  methodName: "get_active_session",
  args: { account_id: contractId },
});
if (
  session?.status !== "active" ||
  session.playerId !== contractId ||
  session.gameId !== "cloud-hop" ||
  session.rulesetVersion !== "cloud-hop-v1" ||
  session.tournamentId !== tournament.tournamentId
) {
  throw new Error("The live contract did not return the expected bound session.");
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
  throw new Error("The controlled live replay did not finish with score 1.");
}
const replay = createReplay(gameSeed, gameState.tick, flapTicks);
const verifier = new ReplayVerifierService(config);
const verified = await verifier.verifyAndAttest(session.sessionId, {
  playerId: contractId,
  claimedScore: gameState.score,
  replay,
});

let modifiedRejected = false;
try {
  await verifier.verifyAndAttest(session.sessionId, {
    playerId: contractId,
    claimedScore: gameState.score + 1,
    replay,
  });
} catch (error) {
  modifiedRejected = error?.code === "SCORE_MISMATCH";
}
if (!modifiedRejected) {
  throw new Error("The live verifier did not reject a modified claimed score.");
}

const submitAction = transactions.functionCall(
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
);
const submitted = await account.signAndSendTransaction({
  receiverId: contractId,
  actions: [submitAction],
});

let duplicateRejected = false;
try {
  await account.signAndSendTransaction({
    receiverId: contractId,
    actions: [submitAction],
  });
} catch (error) {
  duplicateRejected = /already submitted|not active/i.test(String(error));
}
if (!duplicateRejected) {
  throw new Error("The live contract did not reject a duplicate result.");
}

const after = await account.viewFunction({
  contractId,
  methodName: "get_active_session",
  args: { account_id: contractId },
});
const stored = await account.viewFunction({
  contractId,
  methodName: "get_session",
  args: { session_id: session.sessionId },
});
const score = await account.viewFunction({
  contractId,
  methodName: "get_score",
  args: { session_id: session.sessionId },
});
const stats = await account.viewFunction({
  contractId,
  methodName: "get_player_stats",
  args: { account_id: contractId, game_id: "cloud-hop" },
});
const personalBest = await account.viewFunction({
  contractId,
  methodName: "get_personal_best",
  args: { account_id: contractId, game_id: "cloud-hop" },
});
const allTime = await account.viewFunction({
  contractId,
  methodName: "get_leaderboard_page",
  args: { game_id: "cloud-hop", period: "all", cursor: 0, limit: 25 },
});
const daily = await account.viewFunction({
  contractId,
  methodName: "get_leaderboard_page",
  args: { game_id: "cloud-hop", period: "daily", cursor: 0, limit: 25 },
});
const tournamentEntry = await account.viewFunction({
  contractId,
  methodName: "get_tournament_entry",
  args: { tournament_id: tournament.tournamentId, account_id: contractId },
});
const tournamentLeaderboard = await account.viewFunction({
  contractId,
  methodName: "get_tournament_leaderboard_page",
  args: { tournament_id: tournament.tournamentId, cursor: 0, limit: 25 },
});
const tournamentLeaderboardEntry = tournamentLeaderboard.rows?.find(
  (entry) => entry.playerId === contractId,
);
const achievements = await account.viewFunction({
  contractId,
  methodName: "get_player_achievements",
  args: { account_id: contractId, cursor: 0, limit: 25 },
});
const allTimeEntry = allTime.rows?.find((entry) => entry.playerId === contractId);
const dailyEntry = daily.rows?.find((entry) => entry.playerId === contractId);
const expectedRuns = (statsBefore?.totalAcceptedRuns ?? 0) + 1;
const expectedBest = Math.max(statsBefore?.personalBest ?? 0, gameState.score);
const expectedDailyBest = Math.max(dailyBeforeEntry?.score ?? 0, gameState.score);
const expectedAchievementIds = [
  ...(statsBefore === null
    ? ["first-run:cloud-hop", "first-personal-best:cloud-hop"]
    : []),
  "score-milestone:cloud-hop:1",
  `tournament-participant:${tournament.tournamentId}`,
];
const achievementIdsBefore = new Set(
  achievementsBefore.rows.map((achievement) => achievement.achievementId),
);
const expectedNewAchievements = expectedAchievementIds.filter(
  (achievementId) => !achievementIdsBefore.has(achievementId),
).length;
if (
  after !== null ||
  stored?.status !== "submitted" ||
  score?.sessionId !== session.sessionId ||
  score?.playerId !== contractId ||
  score?.score !== gameState.score ||
  score?.replayHash !== verified.replayHash ||
  score?.tournamentId !== tournament.tournamentId ||
  !/^\d+$/.test(score?.acceptedBlockHeight ?? "") ||
  stats?.totalAcceptedRuns !== expectedRuns ||
  stats?.personalBest !== expectedBest ||
  personalBest?.score !== expectedBest ||
  allTimeEntry?.score !== expectedBest ||
  !Number.isInteger(allTimeEntry?.rank) ||
  dailyEntry?.score !== expectedDailyBest ||
  tournamentEntry?.acceptedRuns !== tournamentEntryBefore.acceptedRuns + 1 ||
  tournamentEntry?.bestScore !==
    Math.max(tournamentEntryBefore.bestScore ?? 0, gameState.score) ||
  tournamentLeaderboardEntry?.score !== tournamentEntry.bestScore ||
  !Number.isInteger(tournamentLeaderboardEntry?.rank) ||
  !achievements.rows.some(
    (achievement) =>
      achievement.achievementId ===
      `tournament-participant:${tournament.tournamentId}`,
  ) ||
  !achievements.rows.some(
    (achievement) => achievement.achievementId === "score-milestone:cloud-hop:1",
  ) ||
  new Set(achievements.rows.map((achievement) => achievement.achievementId)).size !==
    achievements.rows.length ||
  achievements.total !== achievementsBefore.total + expectedNewAchievements ||
  allTime.rows.filter((entry) => entry.playerId === contractId).length !== 1 ||
  daily.rows.filter((entry) => entry.playerId === contractId).length !== 1
) {
  throw new Error("The live score, profile, or leaderboard state was inconsistent.");
}

console.log(`Created live session: ${session.sessionId}`);
console.log(`${explorerUrl}/txns/${created.transaction.hash}`);
console.log(`Accepted score ${score.score}: ${explorerUrl}/txns/${submitted.transaction.hash}`);
console.log(
  `Player stats: ${stats.totalAcceptedRuns} runs, best ${stats.personalBest}; all-time rank ${allTimeEntry.rank}.`,
);
console.log(
  `Tournament ${tournament.tournamentId}: rank ${tournamentLeaderboardEntry.rank}, ${tournamentEntry.acceptedRuns} eligible runs.`,
);
if (joined !== null) {
  console.log(`Tournament registration: ${explorerUrl}/txns/${joined.transaction.hash}`);
}
console.log(
  "Modified score, duplicate submission, and duplicate tournament registration were rejected.",
);
