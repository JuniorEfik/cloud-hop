import assert from "node:assert/strict";
import test from "node:test";

import { config } from "../src/config.js";
import { ApiError } from "../src/errors.js";
import {
  PublicReadService,
  parseLeaderboardQuery,
  parsePaginationQuery,
  validateGameId,
  validatePlayerId,
  validateTournamentId,
  type ContractViewReader,
} from "../src/read-model.js";

class FakeReader implements ContractViewReader {
  constructor(readonly responses: Record<string, unknown>) {}

  async view<Value>(methodName: string): Promise<Value> {
    return this.responses[methodName] as Value;
  }
}

const serviceConfig = {
  ...config,
  explorerUrl: "https://explorer.testnet",
} as const;

test("public read parameters validate periods, pagination, accounts, and games", () => {
  assert.deepEqual(parseLeaderboardQuery(new URLSearchParams()), {
    period: "all",
    cursor: 0,
    limit: 10,
  });
  assert.deepEqual(
    parseLeaderboardQuery(
      new URLSearchParams({ period: "daily", cursor: "10", limit: "25" }),
    ),
    { period: "daily", cursor: 10, limit: 25 },
  );
  assert.throws(
    () => parseLeaderboardQuery(new URLSearchParams({ period: "weekly" })),
    ApiError,
  );
  assert.throws(
    () => parseLeaderboardQuery(new URLSearchParams({ limit: "26" })),
    ApiError,
  );
  assert.equal(validatePlayerId("pilot.testnet"), "pilot.testnet");
  assert.equal(validateGameId("cloud-hop"), "cloud-hop");
  assert.equal(validateTournamentId("weekly-001"), "weekly-001");
  assert.deepEqual(parsePaginationQuery(new URLSearchParams({ limit: "25" })), {
    cursor: 0,
    limit: 25,
  });
  assert.throws(() => validatePlayerId("Pilot Testnet"), ApiError);
  assert.throws(() => validateGameId("../cloud-hop"), ApiError);
  assert.throws(() => validateTournamentId("Weekly 001"), ApiError);
});

test("player statistics are returned with inspectable NEAR links", async () => {
  const stats = {
    playerId: "pilot.testnet",
    gameId: "cloud-hop",
    totalAcceptedRuns: 4,
    personalBest: 8,
    bestRulesetVersion: "cloud-hop-v1",
    bestSessionId: "a".repeat(64),
    bestReplayHash: "b".repeat(64),
    bestAcceptedAtNs: "100",
    bestAcceptedBlockHeight: "123",
    latestScore: 3,
    latestRulesetVersion: "cloud-hop-v1",
    latestSessionId: "c".repeat(64),
    latestReplayHash: "d".repeat(64),
    latestAcceptedAtNs: "200",
    latestAcceptedBlockHeight: "456",
  };
  const service = new PublicReadService(
    serviceConfig,
    new FakeReader({ get_player_stats: stats }),
  );
  const response = await service.getPlayerStats("pilot.testnet");
  assert.deepEqual(response.stats, stats);
  assert.equal(
    response.bestBlockExplorerUrl,
    "https://explorer.testnet/blocks/123",
  );
  assert.equal(
    response.playerExplorerUrl,
    "https://explorer.testnet/address/pilot.testnet",
  );
});

test("leaderboard rows preserve contract rank and receive account/block links", async () => {
  const page = {
    gameId: "cloud-hop",
    period: "all",
    periodId: "all",
    total: 1,
    cursor: 0,
    nextCursor: null,
    rows: [
      {
        rank: 1,
        playerId: "pilot.testnet",
        score: 8,
        sessionId: "a".repeat(64),
        replayHash: "b".repeat(64),
        rulesetVersion: "cloud-hop-v1",
        acceptedAtNs: "100",
        acceptedBlockHeight: "123",
      },
    ],
  };
  const service = new PublicReadService(
    serviceConfig,
    new FakeReader({ get_leaderboard_page: page }),
  );
  const response = await service.getLeaderboard("cloud-hop", {
    period: "all",
    cursor: 0,
    limit: 10,
  });
  const rows = response.rows as Array<Record<string, unknown>>;
  assert.equal(rows[0]?.rank, 1);
  assert.equal(rows[0]?.blockExplorerUrl, "https://explorer.testnet/blocks/123");
  assert.equal(
    rows[0]?.playerExplorerUrl,
    "https://explorer.testnet/address/pilot.testnet",
  );
});

const tournament = {
  tournamentId: "weekly-001",
  gameId: "cloud-hop",
  rulesetVersion: "cloud-hop-v1",
  startAtNs: "100",
  endAtNs: "200",
  registrationEndsAtNs: "190",
  maxParticipants: 100,
  participantCount: 1,
  createdAtNs: "90",
  createdBy: "operator.testnet",
  status: "active",
  finalizedAtNs: null,
  resultHash: null,
  resultCount: 0,
  podium: [],
  rewardType: "none",
  rewardDescription: "Badges only.",
};

test("current tournament and entries preserve free reward and eligibility state", async () => {
  const entry = {
    tournamentId: "weekly-001",
    playerId: "pilot.testnet",
    joinedAtNs: "110",
    acceptedRuns: 0,
    bestScore: null,
    bestSessionId: null,
    bestReplayHash: null,
    bestAcceptedAtNs: null,
    bestAcceptedBlockHeight: null,
  };
  const service = new PublicReadService(
    serviceConfig,
    new FakeReader({
      get_current_tournament: tournament,
      get_tournament_entry: entry,
    }),
  );
  const current = await service.getCurrentTournament("cloud-hop");
  assert.deepEqual(current.tournament, tournament);
  assert.equal(
    current.contractExplorerUrl,
    `https://explorer.testnet/address/${serviceConfig.contractId}`,
  );
  const response = await service.getTournamentEntry(
    "weekly-001",
    "pilot.testnet",
  );
  assert.deepEqual(response.entry, entry);
});

test("tournament rankings and achievements expose validated chain records", async () => {
  const tournamentPage = {
    tournamentId: "weekly-001",
    total: 1,
    cursor: 0,
    nextCursor: null,
    rows: [
      {
        rank: 1,
        playerId: "pilot.testnet",
        score: 8,
        sessionId: "a".repeat(64),
        replayHash: "b".repeat(64),
        rulesetVersion: "cloud-hop-v1",
        acceptedAtNs: "120",
        acceptedBlockHeight: "123",
      },
    ],
  };
  const achievementPage = {
    playerId: "pilot.testnet",
    total: 1,
    cursor: 0,
    nextCursor: null,
    rows: [
      {
        achievementId: "first-run:cloud-hop",
        playerId: "pilot.testnet",
        gameId: "cloud-hop",
        kind: "first-run",
        title: "First verified run",
        description: "Recorded a replay-verified run on NEAR.",
        earnedAtNs: "120",
        sourceSessionId: "a".repeat(64),
        tournamentId: null,
        rank: null,
        score: 8,
      },
    ],
  };
  const service = new PublicReadService(
    serviceConfig,
    new FakeReader({
      get_tournament_leaderboard_page: tournamentPage,
      get_player_achievements: achievementPage,
    }),
  );
  const ranking = await service.getTournamentLeaderboard("weekly-001", {
    cursor: 0,
    limit: 10,
  });
  const rows = ranking.rows as Array<Record<string, unknown>>;
  assert.equal(rows[0]?.blockExplorerUrl, "https://explorer.testnet/blocks/123");

  const achievements = await service.getPlayerAchievements("pilot.testnet", {
    cursor: 0,
    limit: 10,
  });
  assert.deepEqual(achievements.rows, achievementPage.rows);
  assert.equal(
    achievements.playerExplorerUrl,
    "https://explorer.testnet/address/pilot.testnet",
  );
});
