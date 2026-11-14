import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_SESSION_TTL_NS,
  MAX_PLAYER_ACHIEVEMENTS,
  MIN_DEMO_TOURNAMENT_DURATION_NS,
  DAY_NS,
  WEEK_NS,
  MIN_SESSION_TTL_NS,
  appendAchievement,
  compareLeaderboardEntries,
  dailyPeriodId,
  effectiveSessionStatus,
  finalizeTournamentRecord,
  fromHex,
  paginateLeaderboard,
  paginateAchievements,
  paginateTournamentLeaderboard,
  rulesetKey,
  serializeScoreAttestation,
  serializeTournamentResult,
  toHex,
  validateGameId,
  validateMaxScore,
  validateRulesetHash,
  validateRulesetVersion,
  validateSessionTtl,
  validateScoreAcceptance,
  validateVerifierPublicKey,
  validateVerifierSignature,
  updatePlayerStats,
  updateTournamentEntry,
  upsertLeaderboard,
  tournamentStatusAt,
  validateTournamentId,
  validateTournamentRegistration,
  validateTournamentFinalization,
  validateTournamentSchedule,
  validateTournamentScore,
  validateTournamentSession,
  type AchievementRecord,
  type RulesetRecord,
  type ScoreRecord,
  type SessionRecord,
  type TournamentEntry,
  type TournamentRecord,
} from "../src/model.js";

const session: SessionRecord = {
  sessionId: "a".repeat(64),
  playerId: "pilot.testnet",
  gameId: "cloud-hop",
  rulesetVersion: "cloud-hop-v1",
  seed: "b".repeat(64),
  seedCommitment: "c".repeat(64),
  createdAtNs: "100",
  expiresAtNs: "200",
  status: "active",
};

const scoreRecord = (
  playerId: string,
  score: number,
  acceptedAtNs: string,
  sessionCharacter: string,
): ScoreRecord => ({
  sessionId: sessionCharacter.repeat(64),
  playerId,
  gameId: "cloud-hop",
  rulesetVersion: "cloud-hop-v1",
  score,
  replayHash: sessionCharacter.repeat(64),
  verifierPublicKey: "f".repeat(128),
  acceptedAtNs,
  acceptedBlockHeight: "123",
});

const ruleset: RulesetRecord = {
  gameId: "cloud-hop",
  version: "cloud-hop-v1",
  rulesetHash: "d".repeat(64),
  maxScore: 150,
  sessionTtlNs: "100",
  enabled: true,
};

test("registry identifiers and hashes accept the canonical values", () => {
  assert.doesNotThrow(() => validateGameId("cloud-hop"));
  assert.doesNotThrow(() => validateRulesetVersion("cloud-hop-v1"));
  assert.doesNotThrow(() => validateRulesetHash("a".repeat(64)));
  assert.doesNotThrow(() => validateMaxScore(150));
  assert.equal(rulesetKey("cloud-hop", "cloud-hop-v1"), "cloud-hop:cloud-hop-v1");
});

test("registry validation rejects malformed or dangerous values", () => {
  assert.throws(() => validateGameId("Cloud Hop"));
  assert.throws(() => validateRulesetVersion("../v1"));
  assert.throws(() => validateRulesetHash("not-a-hash"));
  assert.throws(() => validateMaxScore(0));
});

test("session TTL is bounded", () => {
  assert.equal(validateSessionTtl(MIN_SESSION_TTL_NS.toString()), MIN_SESSION_TTL_NS);
  assert.equal(validateSessionTtl(MAX_SESSION_TTL_NS.toString()), MAX_SESSION_TTL_NS);
  assert.throws(() => validateSessionTtl((MIN_SESSION_TTL_NS - 1n).toString()));
  assert.throws(() => validateSessionTtl((MAX_SESSION_TTL_NS + 1n).toString()));
});

test("active sessions become effectively expired at their deadline", () => {
  assert.equal(effectiveSessionStatus(session, 199n), "active");
  assert.equal(effectiveSessionStatus(session, 200n), "expired");
  assert.equal(
    effectiveSessionStatus({ ...session, status: "abandoned" }, 300n),
    "abandoned",
  );
});

test("byte serialization uses lowercase, fixed-width hexadecimal", () => {
  assert.equal(toHex(new Uint8Array([0, 1, 15, 16, 255])), "00010f10ff");
  assert.deepEqual(fromHex("00010f10ff"), new Uint8Array([0, 1, 15, 16, 255]));
  assert.throws(() => fromHex("abc"));
});

test("verifier keys, signatures, and messages use locked encodings", () => {
  assert.doesNotThrow(() => validateVerifierPublicKey("a".repeat(128)));
  assert.doesNotThrow(() => validateVerifierSignature("b".repeat(128)));
  assert.throws(() => validateVerifierPublicKey("a".repeat(64)));
  assert.throws(() => validateVerifierSignature("not-a-signature"));
  assert.equal(
    serializeScoreAttestation({
      networkId: "testnet",
      contractId: "arcade.testnet",
      playerId: "pilot.testnet",
      sessionId: "a".repeat(64),
      gameId: "cloud-hop",
      rulesetVersion: "cloud-hop-v1",
      score: 7,
      replayHash: "b".repeat(64),
      expiresAtNs: "123456789",
    }),
    `{"protocol":"near-arcade-score-v1","networkId":"testnet","contractId":"arcade.testnet","playerId":"pilot.testnet","sessionId":"${"a".repeat(64)}","gameId":"cloud-hop","rulesetVersion":"cloud-hop-v1","score":7,"replayHash":"${"b".repeat(64)}","expiresAtNs":"123456789"}`,
  );
});

test("score acceptance rejects expired, cross-account, and duplicate results", () => {
  const valid = {
    session,
    ruleset,
    callerId: "pilot.testnet",
    score: 3,
    replayHash: "e".repeat(64),
    attestationExpiresAtNs: "190",
    nowNs: 150n,
    resultExists: false,
  } as const;
  assert.doesNotThrow(() => validateScoreAcceptance(valid));
  assert.throws(
    () => validateScoreAcceptance({ ...valid, callerId: "other.testnet" }),
    /session owner/i,
  );
  assert.throws(
    () => validateScoreAcceptance({ ...valid, nowNs: 200n }),
    /not active/i,
  );
  assert.throws(
    () => validateScoreAcceptance({ ...valid, resultExists: true }),
    /already submitted/i,
  );
  assert.throws(
    () =>
      validateScoreAcceptance({
        ...valid,
        session: { ...session, status: "submitted" },
      }),
    /already submitted/i,
  );
  assert.throws(
    () => validateScoreAcceptance({ ...valid, score: 151 }),
    /score.*bounds/i,
  );
  assert.throws(
    () =>
      validateScoreAcceptance({ ...valid, attestationExpiresAtNs: "201" }),
    /session expiry/i,
  );
  assert.throws(
    () =>
      validateScoreAcceptance({
        ...valid,
        nowNs: 190n,
        attestationExpiresAtNs: "190",
      }),
    /attestation has expired/i,
  );
});

test("player statistics count every run while preserving the deterministic best", () => {
  const first = scoreRecord("pilot.testnet", 5, "200", "b");
  const lower = scoreRecord("pilot.testnet", 3, "300", "c");
  const equalLater = scoreRecord("pilot.testnet", 5, "400", "d");
  const higher = scoreRecord("pilot.testnet", 8, "500", "e");

  const initial = updatePlayerStats(null, first);
  assert.equal(initial.totalAcceptedRuns, 1);
  assert.equal(initial.personalBest, 5);
  assert.equal(initial.bestSessionId, first.sessionId);

  const afterLower = updatePlayerStats(initial, lower);
  assert.equal(afterLower.totalAcceptedRuns, 2);
  assert.equal(afterLower.personalBest, 5);
  assert.equal(afterLower.bestSessionId, first.sessionId);
  assert.equal(afterLower.latestScore, 3);

  const afterEqual = updatePlayerStats(afterLower, equalLater);
  assert.equal(afterEqual.personalBest, 5);
  assert.equal(afterEqual.bestSessionId, first.sessionId);

  const afterHigher = updatePlayerStats(afterEqual, higher);
  assert.equal(afterHigher.totalAcceptedRuns, 4);
  assert.equal(afterHigher.personalBest, 8);
  assert.equal(afterHigher.bestSessionId, higher.sessionId);
});

test("leaderboards keep one row per player with stable score and time ordering", () => {
  const lateFive = scoreRecord("late.testnet", 5, "300", "d");
  const seven = scoreRecord("winner.testnet", 7, "500", "e");
  const earlyFive = scoreRecord("early.testnet", 5, "100", "c");
  const sameTimeLowerSession = scoreRecord("alpha.testnet", 5, "100", "a");

  let entries = upsertLeaderboard([], lateFive);
  entries = upsertLeaderboard(entries, seven);
  entries = upsertLeaderboard(entries, earlyFive);
  entries = upsertLeaderboard(entries, sameTimeLowerSession);

  assert.deepEqual(
    entries.map((entry) => entry.playerId),
    ["winner.testnet", "alpha.testnet", "early.testnet", "late.testnet"],
  );
  assert.equal(compareLeaderboardEntries(entries[0]!, entries[1]!), -2);

  entries = upsertLeaderboard(
    entries,
    scoreRecord("winner.testnet", 2, "600", "f"),
  );
  assert.equal(entries.filter((entry) => entry.playerId === "winner.testnet").length, 1);
  assert.equal(entries[0]?.score, 7);

  const bounded = upsertLeaderboard(entries, scoreRecord("new.testnet", 9, "700", "b"), 3);
  assert.equal(bounded.length, 3);
  assert.equal(bounded[0]?.playerId, "new.testnet");
});

test("daily periods and leaderboard pages are deterministic and bounded", () => {
  assert.equal(dailyPeriodId(0n), "day-0");
  assert.equal(dailyPeriodId(DAY_NS - 1n), "day-0");
  assert.equal(dailyPeriodId(DAY_NS), "day-1");

  const entries = [
    scoreRecord("one.testnet", 3, "100", "a"),
    scoreRecord("two.testnet", 2, "200", "b"),
    scoreRecord("three.testnet", 1, "300", "c"),
  ].map((record) => ({
    playerId: record.playerId,
    score: record.score,
    sessionId: record.sessionId,
    replayHash: record.replayHash,
    rulesetVersion: record.rulesetVersion,
    acceptedAtNs: record.acceptedAtNs,
    acceptedBlockHeight: record.acceptedBlockHeight ?? "0",
  }));
  const page = paginateLeaderboard("cloud-hop", "all", "all", entries, 1, 2);
  assert.deepEqual(page.rows.map((row) => row.rank), [2, 3]);
  assert.equal(page.nextCursor, null);
  assert.throws(() =>
    paginateLeaderboard("cloud-hop", "all", "all", entries, -1, 2),
  );
  assert.throws(() =>
    paginateLeaderboard("cloud-hop", "all", "all", entries, 0, 26),
  );
});

const tournament: TournamentRecord = {
  tournamentId: "weekly-001",
  gameId: "cloud-hop",
  rulesetVersion: "cloud-hop-v1",
  startAtNs: "1000",
  endAtNs: (1000n + WEEK_NS).toString(),
  registrationEndsAtNs: (1000n + WEEK_NS).toString(),
  maxParticipants: 100,
  participantCount: 1,
  createdAtNs: "900",
  createdBy: "operator.testnet",
  status: "open",
  finalizedAtNs: null,
  resultHash: null,
  resultCount: 0,
  podium: [],
  rewardType: "none",
  rewardDescription: "Badges and leaderboard recognition only.",
};

const tournamentEntry: TournamentEntry = {
  tournamentId: tournament.tournamentId,
  playerId: "pilot.testnet",
  joinedAtNs: "950",
  acceptedRuns: 0,
  bestScore: null,
  bestSessionId: null,
  bestReplayHash: null,
  bestAcceptedAtNs: null,
  bestAcceptedBlockHeight: null,
};

test("weekly tournament schedules and derived states are immutable and bounded", () => {
  assert.doesNotThrow(() => validateTournamentId("weekly-001"));
  assert.throws(() => validateTournamentId("Weekly 001"));
  assert.doesNotThrow(() =>
    validateTournamentSchedule({
      startAtNs: "1000",
      endAtNs: (1000n + WEEK_NS).toString(),
      registrationEndsAtNs: (1000n + WEEK_NS).toString(),
      maxParticipants: 100,
      nowNs: 900n,
    }),
  );
  assert.throws(() =>
    validateTournamentSchedule({
      startAtNs: "1000",
      endAtNs: (1000n + WEEK_NS - 1n).toString(),
      registrationEndsAtNs: "1200",
      maxParticipants: 100,
      nowNs: 900n,
    }),
  );
  assert.equal(tournamentStatusAt(tournament, 999n), "scheduled");
  assert.equal(tournamentStatusAt(tournament, 1000n), "active");
  assert.equal(tournamentStatusAt(tournament, BigInt(tournament.endAtNs)), "closed");
  assert.equal(
    tournamentStatusAt({ ...tournament, status: "finalized" }, 999n),
    "finalized",
  );

  assert.doesNotThrow(() =>
    validateTournamentSchedule({
      startAtNs: "1000",
      endAtNs: (1000n + MIN_DEMO_TOURNAMENT_DURATION_NS).toString(),
      registrationEndsAtNs: (
        1000n + MIN_DEMO_TOURNAMENT_DURATION_NS
      ).toString(),
      maxParticipants: 10,
      nowNs: 900n,
      kind: "demo",
    }),
  );
  assert.throws(
    () =>
      validateTournamentSchedule({
        startAtNs: "1000",
        endAtNs: (
          1000n + MIN_DEMO_TOURNAMENT_DURATION_NS - 1n
        ).toString(),
        registrationEndsAtNs: "1200",
        maxParticipants: 10,
        nowNs: 900n,
        kind: "demo",
      }),
    /3 and 60 minutes/i,
  );
});

test("registration rejects duplicates, late joins, and participant overflow", () => {
  assert.doesNotThrow(() =>
    validateTournamentRegistration({
      tournament,
      nowNs: 999n,
      alreadyJoined: false,
    }),
  );
  assert.throws(
    () =>
      validateTournamentRegistration({
        tournament,
        nowNs: 999n,
        alreadyJoined: true,
      }),
    /already joined/i,
  );
  assert.throws(
    () =>
      validateTournamentRegistration({
        tournament,
        nowNs: BigInt(tournament.registrationEndsAtNs),
        alreadyJoined: false,
      }),
    /closed|deadline/i,
  );
  assert.throws(() =>
    validateTournamentRegistration({
      tournament: { ...tournament, participantCount: 100 },
      nowNs: 999n,
      alreadyJoined: false,
    }),
  );
});

test("tournament sessions and scores require active, registered, matching runs", () => {
  const activeNow = 1100n;
  assert.doesNotThrow(() =>
    validateTournamentSession({
      tournament,
      entry: tournamentEntry,
      gameId: "cloud-hop",
      rulesetVersion: "cloud-hop-v1",
      nowNs: activeNow,
    }),
  );
  assert.throws(() =>
    validateTournamentSession({
      tournament,
      entry: null,
      gameId: "cloud-hop",
      rulesetVersion: "cloud-hop-v1",
      nowNs: activeNow,
    }),
  );
  assert.throws(() =>
    validateTournamentSession({
      tournament,
      entry: tournamentEntry,
      gameId: "cloud-hop",
      rulesetVersion: "cloud-hop-v2",
      nowNs: activeNow,
    }),
  );
  const boundSession: SessionRecord = {
    ...session,
    createdAtNs: "1050",
    expiresAtNs: "1200",
    tournamentId: tournament.tournamentId,
  };
  assert.doesNotThrow(() =>
    validateTournamentScore({
      tournament,
      entry: tournamentEntry,
      session: boundSession,
      nowNs: activeNow,
    }),
  );
  assert.throws(
    () =>
      validateTournamentScore({
        tournament,
        entry: tournamentEntry,
        session: boundSession,
        nowNs: BigInt(tournament.endAtNs),
      }),
    /not active/i,
  );
});

test("tournament ranking keeps one best row and paginates absolute ranks", () => {
  const first = { ...scoreRecord("pilot.testnet", 4, "1100", "a"), tournamentId: "weekly-001" };
  const lower = { ...scoreRecord("pilot.testnet", 2, "1200", "b"), tournamentId: "weekly-001" };
  const afterFirst = updateTournamentEntry(tournamentEntry, first);
  const afterLower = updateTournamentEntry(afterFirst, lower);
  assert.equal(afterLower.acceptedRuns, 2);
  assert.equal(afterLower.bestScore, 4);
  assert.equal(afterLower.bestSessionId, first.sessionId);

  const rows = upsertLeaderboard(
    upsertLeaderboard([], first),
    scoreRecord("rival.testnet", 3, "1000", "c"),
  );
  const page = paginateTournamentLeaderboard("weekly-001", rows, 1, 1);
  assert.equal(page.rows[0]?.rank, 2);
  assert.equal(page.rows[0]?.playerId, "rival.testnet");
});

test("finalization freezes a deterministic bounded result and rejects rewrites", () => {
  const entries = [
    scoreRecord("winner.testnet", 8, "1100", "a"),
    scoreRecord("runner.testnet", 5, "1200", "b"),
  ].map((record) => ({
    playerId: record.playerId,
    score: record.score,
    sessionId: record.sessionId,
    replayHash: record.replayHash,
    rulesetVersion: record.rulesetVersion,
    acceptedAtNs: record.acceptedAtNs,
    acceptedBlockHeight: record.acceptedBlockHeight ?? "0",
  }));
  const closedAt = BigInt(tournament.endAtNs);
  assert.throws(
    () => validateTournamentFinalization(tournament, closedAt - 1n),
    /must be closed/i,
  );
  assert.match(
    serializeTournamentResult(tournament, entries),
    /^\{"protocol":"near-arcade-tournament-result-v1"/,
  );
  const finalized = finalizeTournamentRecord(
    tournament,
    entries,
    "e".repeat(64),
    closedAt,
  );
  assert.equal(finalized.status, "finalized");
  assert.equal(finalized.resultCount, 2);
  assert.deepEqual(finalized.podium, entries);
  assert.throws(
    () =>
      finalizeTournamentRecord(
        finalized,
        [...entries].reverse(),
        "f".repeat(64),
        closedAt + 1n,
      ),
    /already finalized/i,
  );
});

test("achievements are non-duplicating, bounded, and paginated newest first", () => {
  const achievement: AchievementRecord = {
    achievementId: "first-run:cloud-hop",
    playerId: "pilot.testnet",
    gameId: "cloud-hop",
    kind: "first-run",
    title: "First verified run",
    description: "Recorded a replay-verified run on NEAR.",
    earnedAtNs: "2000",
    sourceSessionId: "a".repeat(64),
    tournamentId: null,
    rank: null,
    score: 4,
  };
  const first = appendAchievement([], achievement);
  assert.equal(first.added, true);
  const duplicate = appendAchievement(first.records, achievement);
  assert.equal(duplicate.added, false);
  assert.equal(duplicate.records.length, 1);

  const podium: AchievementRecord = {
    ...achievement,
    achievementId: "tournament-podium:weekly-001:1",
    kind: "tournament-podium",
    title: "Weekly champion",
    tournamentId: "weekly-001",
    rank: 1,
  };
  const records = appendAchievement(first.records, podium).records;
  const page = paginateAchievements("pilot.testnet", records, 0, 1);
  assert.equal(page.total, 2);
  assert.equal(page.rows[0]?.achievementId, podium.achievementId);
  assert.equal(page.nextCursor, 1);
  assert.throws(() => paginateAchievements("pilot.testnet", records, 0, 26));

  const capped = Array.from({ length: MAX_PLAYER_ACHIEVEMENTS }, (_, index) => ({
    ...achievement,
    achievementId: `badge-${index}`,
  }));
  const overflow = appendAchievement(capped, podium);
  assert.equal(overflow.added, false);
  assert.equal(overflow.records.length, MAX_PLAYER_ACHIEVEMENTS);
});
