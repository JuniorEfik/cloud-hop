import assert from "node:assert/strict";
import test from "node:test";

import {
  parseAchievementPage,
  parseLeaderboardPage,
  parsePlayerStatsResponse,
  parseTournamentEntryResponse,
  parseTournamentLeaderboardPage,
  parseTournamentResponse,
} from "../src/public-data.js";

const stats = {
  playerId: "pilot.testnet",
  gameId: "cloud-hop",
  totalAcceptedRuns: 2,
  personalBest: 7,
  bestRulesetVersion: "cloud-hop-v1",
  bestSessionId: "a".repeat(64),
  bestReplayHash: "b".repeat(64),
  bestAcceptedAtNs: "100",
  bestAcceptedBlockHeight: "123",
  latestScore: 4,
  latestRulesetVersion: "cloud-hop-v1",
  latestSessionId: "c".repeat(64),
  latestReplayHash: "d".repeat(64),
  latestAcceptedAtNs: "200",
  latestAcceptedBlockHeight: "456",
};

test("player statistics parser accepts complete nullable responses", () => {
  const populated = {
    playerId: "pilot.testnet",
    gameId: "cloud-hop",
    stats,
    playerExplorerUrl: "https://explorer/address/pilot.testnet",
    bestBlockExplorerUrl: "https://explorer/blocks/123",
    latestBlockExplorerUrl: "https://explorer/blocks/456",
  };
  assert.deepEqual(parsePlayerStatsResponse(populated), populated);
  assert.equal(
    parsePlayerStatsResponse({
      ...populated,
      stats: null,
      bestBlockExplorerUrl: null,
      latestBlockExplorerUrl: null,
    }).stats,
    null,
  );
  assert.throws(() =>
    parsePlayerStatsResponse({ ...populated, stats: { ...stats, totalAcceptedRuns: 0 } }),
  );
});

test("leaderboard parser preserves paginated ranked rows", () => {
  const page = {
    gameId: "cloud-hop",
    period: "daily",
    periodId: "day-10",
    total: 1,
    cursor: 0,
    nextCursor: null,
    rows: [
      {
        rank: 1,
        playerId: "pilot.testnet",
        score: 7,
        sessionId: "a".repeat(64),
        replayHash: "b".repeat(64),
        rulesetVersion: "cloud-hop-v1",
        acceptedAtNs: "100",
        acceptedBlockHeight: "123",
        playerExplorerUrl: "https://explorer/address/pilot.testnet",
        blockExplorerUrl: "https://explorer/blocks/123",
      },
    ],
  };
  assert.deepEqual(parseLeaderboardPage(page), page);
  assert.throws(() =>
    parseLeaderboardPage({ ...page, rows: [{ ...page.rows[0], rank: 0 }] }),
  );
});

test("tournament parsers preserve lifecycle, entry, and ranking state", () => {
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
  const response = {
    tournament,
    contractExplorerUrl: "https://explorer/address/contract.testnet",
  };
  assert.deepEqual(parseTournamentResponse(response), response);
  assert.throws(() =>
    parseTournamentResponse({
      ...response,
      tournament: { ...tournament, rewardType: "NEAR" },
    }),
  );

  const entryResponse = {
    tournamentId: "weekly-001",
    playerId: "pilot.testnet",
    entry: {
      tournamentId: "weekly-001",
      playerId: "pilot.testnet",
      joinedAtNs: "110",
      acceptedRuns: 0,
      bestScore: null,
      bestSessionId: null,
      bestReplayHash: null,
      bestAcceptedAtNs: null,
      bestAcceptedBlockHeight: null,
    },
  };
  assert.deepEqual(parseTournamentEntryResponse(entryResponse), entryResponse);

  const ranked = {
    tournamentId: "weekly-001",
    total: 1,
    cursor: 0,
    nextCursor: null,
    rows: [
      {
        rank: 1,
        playerId: "pilot.testnet",
        score: 7,
        sessionId: "a".repeat(64),
        replayHash: "b".repeat(64),
        rulesetVersion: "cloud-hop-v1",
        acceptedAtNs: "120",
        acceptedBlockHeight: "123",
        playerExplorerUrl: "https://explorer/address/pilot.testnet",
        blockExplorerUrl: "https://explorer/blocks/123",
      },
    ],
  };
  assert.deepEqual(parseTournamentLeaderboardPage(ranked), ranked);
});

test("achievement parser accepts non-transferable badge records", () => {
  const page = {
    playerId: "pilot.testnet",
    total: 1,
    cursor: 0,
    nextCursor: null,
    playerExplorerUrl: "https://explorer/address/pilot.testnet",
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
        score: 7,
      },
    ],
  };
  assert.deepEqual(parseAchievementPage(page), page);
  assert.throws(() =>
    parseAchievementPage({
      ...page,
      rows: [{ ...page.rows[0], earnedAtNs: "later" }],
    }),
  );
});
