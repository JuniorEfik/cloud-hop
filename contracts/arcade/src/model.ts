export const GAME_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const VERSION_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
export const SHA256_PATTERN = /^[a-f0-9]{64}$/;
export const SECP256K1_PUBLIC_KEY_PATTERN = /^[a-f0-9]{128}$/;
export const SECP256K1_SIGNATURE_PATTERN = /^[a-f0-9]{128}$/;
export const SCORE_ATTESTATION_PROTOCOL = "near-arcade-score-v1";
export const TOURNAMENT_RESULT_PROTOCOL = "near-arcade-tournament-result-v1";

export const MIN_SESSION_TTL_NS = 60_000_000_000n;
export const MAX_SESSION_TTL_NS = 3_600_000_000_000n;
export const MIN_SESSION_STORAGE_DEPOSIT = 5_000_000_000_000_000_000_000n;
export const DAY_NS = 86_400_000_000_000n;
export const WEEK_NS = 7n * DAY_NS;
export const MIN_DEMO_TOURNAMENT_DURATION_NS = 180_000_000_000n;
export const MAX_DEMO_TOURNAMENT_DURATION_NS = 3_600_000_000_000n;
export const MAX_LEADERBOARD_ENTRIES = 100;
export const MAX_LEADERBOARD_PAGE_SIZE = 25;
export const MAX_TOURNAMENT_PARTICIPANTS = 500;
export const MAX_PLAYER_ACHIEVEMENTS = 256;
export const MAX_ACHIEVEMENT_PAGE_SIZE = 25;
export const TOURNAMENT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SCORE_MILESTONES = [1, 5, 10, 25, 50, 100] as const;

export type SessionStatus = "active" | "abandoned" | "expired" | "submitted";

export interface RulesetRecord {
  readonly gameId: string;
  readonly version: string;
  readonly rulesetHash: string;
  readonly maxScore: number;
  readonly sessionTtlNs: string;
  readonly enabled: boolean;
}

export interface GameRecord {
  readonly gameId: string;
  readonly activeRuleset: string;
  readonly enabled: boolean;
  readonly paused: boolean;
}

export interface SessionRecord {
  readonly sessionId: string;
  readonly playerId: string;
  readonly gameId: string;
  readonly rulesetVersion: string;
  readonly seed: string;
  readonly seedCommitment: string;
  readonly createdAtNs: string;
  readonly expiresAtNs: string;
  readonly status: SessionStatus;
  readonly tournamentId?: string | null;
}

export interface ScoreRecord {
  readonly sessionId: string;
  readonly playerId: string;
  readonly gameId: string;
  readonly rulesetVersion: string;
  readonly score: number;
  readonly replayHash: string;
  readonly verifierPublicKey: string;
  readonly acceptedAtNs: string;
  readonly acceptedBlockHeight?: string;
  readonly tournamentId?: string | null;
}

export interface PlayerStats {
  readonly playerId: string;
  readonly gameId: string;
  readonly totalAcceptedRuns: number;
  readonly personalBest: number;
  readonly bestRulesetVersion: string;
  readonly bestSessionId: string;
  readonly bestReplayHash: string;
  readonly bestAcceptedAtNs: string;
  readonly bestAcceptedBlockHeight: string;
  readonly latestScore: number;
  readonly latestRulesetVersion: string;
  readonly latestSessionId: string;
  readonly latestReplayHash: string;
  readonly latestAcceptedAtNs: string;
  readonly latestAcceptedBlockHeight: string;
}

export interface LeaderboardEntry {
  readonly playerId: string;
  readonly score: number;
  readonly sessionId: string;
  readonly replayHash: string;
  readonly rulesetVersion: string;
  readonly acceptedAtNs: string;
  readonly acceptedBlockHeight: string;
}

export interface RankedLeaderboardEntry extends LeaderboardEntry {
  readonly rank: number;
}

export interface StoredLeaderboard {
  readonly periodId: string;
  readonly entries: readonly LeaderboardEntry[];
}

export interface LeaderboardPage {
  readonly gameId: string;
  readonly period: "all" | "daily";
  readonly periodId: string;
  readonly total: number;
  readonly cursor: number;
  readonly nextCursor: number | null;
  readonly rows: readonly RankedLeaderboardEntry[];
}

export type TournamentStatus =
  | "scheduled"
  | "active"
  | "closed"
  | "finalized";

export type TournamentKind = "weekly" | "demo";

export interface TournamentRecord {
  readonly tournamentId: string;
  readonly gameId: string;
  readonly rulesetVersion: string;
  readonly startAtNs: string;
  readonly endAtNs: string;
  readonly registrationEndsAtNs: string;
  readonly maxParticipants: number;
  readonly participantCount: number;
  readonly createdAtNs: string;
  readonly createdBy: string;
  readonly kind?: TournamentKind;
  readonly status: "open" | "finalized";
  readonly finalizedAtNs: string | null;
  readonly resultHash: string | null;
  readonly resultCount: number;
  readonly podium: readonly LeaderboardEntry[];
  readonly rewardType: "none";
  readonly rewardDescription: string;
}

export interface TournamentView extends Omit<TournamentRecord, "status" | "kind"> {
  readonly kind: TournamentKind;
  readonly status: TournamentStatus;
}

export interface TournamentEntry {
  readonly tournamentId: string;
  readonly playerId: string;
  readonly joinedAtNs: string;
  readonly acceptedRuns: number;
  readonly bestScore: number | null;
  readonly bestSessionId: string | null;
  readonly bestReplayHash: string | null;
  readonly bestAcceptedAtNs: string | null;
  readonly bestAcceptedBlockHeight: string | null;
}

export interface TournamentLeaderboardPage {
  readonly tournamentId: string;
  readonly total: number;
  readonly cursor: number;
  readonly nextCursor: number | null;
  readonly rows: readonly RankedLeaderboardEntry[];
}

export type AchievementKind =
  | "first-run"
  | "first-personal-best"
  | "score-milestone"
  | "tournament-participant"
  | "tournament-podium";

export interface AchievementRecord {
  readonly achievementId: string;
  readonly playerId: string;
  readonly gameId: string;
  readonly kind: AchievementKind;
  readonly title: string;
  readonly description: string;
  readonly earnedAtNs: string;
  readonly sourceSessionId: string | null;
  readonly tournamentId: string | null;
  readonly rank: number | null;
  readonly score: number | null;
}

export interface AchievementPage {
  readonly playerId: string;
  readonly total: number;
  readonly cursor: number;
  readonly nextCursor: number | null;
  readonly rows: readonly AchievementRecord[];
}

export interface AchievementAppendResult {
  readonly records: readonly AchievementRecord[];
  readonly added: boolean;
}

export interface ScoreAttestation {
  readonly networkId: string;
  readonly contractId: string;
  readonly playerId: string;
  readonly sessionId: string;
  readonly gameId: string;
  readonly rulesetVersion: string;
  readonly score: number;
  readonly replayHash: string;
  readonly expiresAtNs: string;
}

export const rulesetKey = (gameId: string, version: string): string =>
  `${gameId}:${version}`;

export const validateGameId = (gameId: string): void => {
  if (gameId.length < 2 || gameId.length > 32 || !GAME_ID_PATTERN.test(gameId)) {
    throw new Error("Game id must be 2-32 lowercase letters, numbers, or hyphens.");
  }
};

export const validateRulesetVersion = (version: string): void => {
  if (version.length < 2 || version.length > 48 || !VERSION_PATTERN.test(version)) {
    throw new Error("Ruleset version has an invalid format.");
  }
};

export const validateTournamentId = (tournamentId: string): void => {
  if (
    tournamentId.length < 2 ||
    tournamentId.length > 48 ||
    !TOURNAMENT_ID_PATTERN.test(tournamentId)
  ) {
    throw new Error(
      "Tournament id must be 2-48 lowercase letters, numbers, or hyphens.",
    );
  }
};

export const validateRulesetHash = (rulesetHash: string): void => {
  if (!SHA256_PATTERN.test(rulesetHash)) {
    throw new Error("Ruleset hash must be a lowercase SHA-256 hex digest.");
  }
};

export const validateVerifierPublicKey = (publicKey: string): void => {
  if (!SECP256K1_PUBLIC_KEY_PATTERN.test(publicKey)) {
    throw new Error(
      "Verifier public key must be a 64-byte secp256k1 key in lowercase hex.",
    );
  }
};

export const validateVerifierSignature = (signature: string): void => {
  if (!SECP256K1_SIGNATURE_PATTERN.test(signature)) {
    throw new Error(
      "Verifier signature must be a 64-byte compact signature in lowercase hex.",
    );
  }
};

export const validateMaxScore = (maxScore: number): void => {
  if (!Number.isInteger(maxScore) || maxScore < 1 || maxScore > 1_000_000) {
    throw new Error("Maximum score is outside the supported range.");
  }
};

export const validateSessionTtl = (sessionTtlNs: string): bigint => {
  if (!/^\d+$/.test(sessionTtlNs)) {
    throw new Error("Session TTL must be an integer string.");
  }

  const value = BigInt(sessionTtlNs);
  if (value < MIN_SESSION_TTL_NS || value > MAX_SESSION_TTL_NS) {
    throw new Error("Session TTL is outside the supported range.");
  }
  return value;
};

export const effectiveSessionStatus = (
  session: SessionRecord,
  timestampNs: bigint,
): SessionStatus =>
  session.status === "active" && timestampNs >= BigInt(session.expiresAtNs)
    ? "expired"
    : session.status;

export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

export const fromHex = (value: string): Uint8Array => {
  if (value.length % 2 !== 0 || !/^[a-f0-9]*$/.test(value)) {
    throw new Error("Hex input is malformed.");
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
};

export const serializeScoreAttestation = (
  attestation: ScoreAttestation,
): string =>
  JSON.stringify({
    protocol: SCORE_ATTESTATION_PROTOCOL,
    networkId: attestation.networkId,
    contractId: attestation.contractId,
    playerId: attestation.playerId,
    sessionId: attestation.sessionId,
    gameId: attestation.gameId,
    rulesetVersion: attestation.rulesetVersion,
    score: attestation.score,
    replayHash: attestation.replayHash,
    expiresAtNs: attestation.expiresAtNs,
  });

export const validateScoreAcceptance = ({
  session,
  ruleset,
  callerId,
  score,
  replayHash,
  attestationExpiresAtNs,
  nowNs,
  resultExists,
}: {
  readonly session: SessionRecord;
  readonly ruleset: RulesetRecord;
  readonly callerId: string;
  readonly score: number;
  readonly replayHash: string;
  readonly attestationExpiresAtNs: string;
  readonly nowNs: bigint;
  readonly resultExists: boolean;
}): void => {
  if (resultExists || session.status === "submitted") {
    throw new Error("Session result was already submitted.");
  }
  if (session.playerId !== callerId) {
    throw new Error("Only the session owner can submit its result.");
  }
  if (effectiveSessionStatus(session, nowNs) !== "active") {
    throw new Error("Session is not active.");
  }
  if (!Number.isInteger(score) || score < 0 || score > ruleset.maxScore) {
    throw new Error("Score is outside the ruleset bounds.");
  }
  validateRulesetHash(replayHash);
  if (!/^\d+$/.test(attestationExpiresAtNs)) {
    throw new Error("Attestation expiry must be an integer string.");
  }
  const expiry = BigInt(attestationExpiresAtNs);
  if (expiry <= nowNs) {
    throw new Error("Verifier attestation has expired.");
  }
  if (expiry > BigInt(session.expiresAtNs)) {
    throw new Error("Verifier attestation exceeds the session expiry.");
  }
};

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export const dailyPeriodId = (timestampNs: bigint): string =>
  `day-${(timestampNs / DAY_NS).toString()}`;

export const compareLeaderboardEntries = (
  left: LeaderboardEntry,
  right: LeaderboardEntry,
): number => {
  if (left.score !== right.score) return right.score - left.score;
  const leftTime = BigInt(left.acceptedAtNs);
  const rightTime = BigInt(right.acceptedAtNs);
  if (leftTime !== rightTime) return leftTime < rightTime ? -1 : 1;
  const sessionOrder = compareText(left.sessionId, right.sessionId);
  return sessionOrder !== 0
    ? sessionOrder
    : compareText(left.playerId, right.playerId);
};

export const leaderboardEntryFromScore = (
  record: ScoreRecord,
): LeaderboardEntry => ({
  playerId: record.playerId,
  score: record.score,
  sessionId: record.sessionId,
  replayHash: record.replayHash,
  rulesetVersion: record.rulesetVersion,
  acceptedAtNs: record.acceptedAtNs,
  acceptedBlockHeight: record.acceptedBlockHeight ?? "0",
});

export const updatePlayerStats = (
  current: PlayerStats | null,
  record: ScoreRecord,
): PlayerStats => {
  const candidate = leaderboardEntryFromScore(record);
  const currentBest =
    current === null
      ? null
      : {
          playerId: current.playerId,
          score: current.personalBest,
          sessionId: current.bestSessionId,
          replayHash: current.bestReplayHash,
          rulesetVersion: current.bestRulesetVersion,
          acceptedAtNs: current.bestAcceptedAtNs,
          acceptedBlockHeight: current.bestAcceptedBlockHeight,
        } satisfies LeaderboardEntry;
  const best =
    currentBest === null || compareLeaderboardEntries(candidate, currentBest) < 0
      ? candidate
      : currentBest;

  return {
    playerId: record.playerId,
    gameId: record.gameId,
    totalAcceptedRuns: (current?.totalAcceptedRuns ?? 0) + 1,
    personalBest: best.score,
    bestRulesetVersion: best.rulesetVersion,
    bestSessionId: best.sessionId,
    bestReplayHash: best.replayHash,
    bestAcceptedAtNs: best.acceptedAtNs,
    bestAcceptedBlockHeight: best.acceptedBlockHeight,
    latestScore: record.score,
    latestRulesetVersion: record.rulesetVersion,
    latestSessionId: record.sessionId,
    latestReplayHash: record.replayHash,
    latestAcceptedAtNs: record.acceptedAtNs,
    latestAcceptedBlockHeight: record.acceptedBlockHeight ?? "0",
  };
};

export const upsertLeaderboard = (
  entries: readonly LeaderboardEntry[],
  record: ScoreRecord,
  maximumEntries = MAX_LEADERBOARD_ENTRIES,
): readonly LeaderboardEntry[] => {
  const candidate = leaderboardEntryFromScore(record);
  const existing = entries.find((entry) => entry.playerId === candidate.playerId);
  if (existing !== undefined && compareLeaderboardEntries(candidate, existing) >= 0) {
    return [...entries].sort(compareLeaderboardEntries).slice(0, maximumEntries);
  }
  return [
    ...entries.filter((entry) => entry.playerId !== candidate.playerId),
    candidate,
  ]
    .sort(compareLeaderboardEntries)
    .slice(0, maximumEntries);
};

export const paginateLeaderboard = (
  gameId: string,
  period: "all" | "daily",
  periodId: string,
  entries: readonly LeaderboardEntry[],
  cursor: number,
  limit: number,
): LeaderboardPage => {
  if (!Number.isInteger(cursor) || cursor < 0) {
    throw new Error("Leaderboard cursor must be a non-negative integer.");
  }
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_LEADERBOARD_PAGE_SIZE
  ) {
    throw new Error(
      `Leaderboard page size must be between 1 and ${MAX_LEADERBOARD_PAGE_SIZE}.`,
    );
  }
  const page = entries.slice(cursor, cursor + limit);
  const next = cursor + page.length;
  return {
    gameId,
    period,
    periodId,
    total: entries.length,
    cursor,
    nextCursor: next < entries.length ? next : null,
    rows: page.map((entry, index) => ({ ...entry, rank: cursor + index + 1 })),
  };
};

export const tournamentStatusAt = (
  tournament: TournamentRecord,
  timestampNs: bigint,
): TournamentStatus => {
  if (tournament.status === "finalized") return "finalized";
  if (timestampNs < BigInt(tournament.startAtNs)) return "scheduled";
  if (timestampNs < BigInt(tournament.endAtNs)) return "active";
  return "closed";
};

export const tournamentViewAt = (
  tournament: TournamentRecord,
  timestampNs: bigint,
): TournamentView => ({
  ...tournament,
  kind: tournament.kind ?? "weekly",
  status: tournamentStatusAt(tournament, timestampNs),
});

export const validateTournamentSchedule = ({
  startAtNs,
  endAtNs,
  registrationEndsAtNs,
  maxParticipants,
  nowNs,
  kind = "weekly",
}: {
  readonly startAtNs: string;
  readonly endAtNs: string;
  readonly registrationEndsAtNs: string;
  readonly maxParticipants: number;
  readonly nowNs: bigint;
  readonly kind?: TournamentKind;
}): void => {
  if (
    !/^\d+$/.test(startAtNs) ||
    !/^\d+$/.test(endAtNs) ||
    !/^\d+$/.test(registrationEndsAtNs)
  ) {
    throw new Error("Tournament times must be integer strings.");
  }
  const start = BigInt(startAtNs);
  const end = BigInt(endAtNs);
  const registrationEnd = BigInt(registrationEndsAtNs);
  if (start < nowNs) {
    throw new Error("Tournament start must not be in the past.");
  }
  const duration = end - start;
  if (kind === "weekly" && duration !== WEEK_NS) {
    throw new Error("Weekly tournament duration must be exactly seven days.");
  }
  if (
    kind === "demo" &&
    (duration < MIN_DEMO_TOURNAMENT_DURATION_NS ||
      duration > MAX_DEMO_TOURNAMENT_DURATION_NS)
  ) {
    throw new Error("Demo tournament duration must be between 3 and 60 minutes.");
  }
  if (registrationEnd <= nowNs || registrationEnd > end) {
    throw new Error("Tournament registration deadline is outside the window.");
  }
  if (
    !Number.isInteger(maxParticipants) ||
    maxParticipants < 1 ||
    maxParticipants > MAX_TOURNAMENT_PARTICIPANTS
  ) {
    throw new Error(
      `Tournament participants must be between 1 and ${MAX_TOURNAMENT_PARTICIPANTS}.`,
    );
  }
};

export const validateTournamentRegistration = ({
  tournament,
  nowNs,
  alreadyJoined,
}: {
  readonly tournament: TournamentRecord;
  readonly nowNs: bigint;
  readonly alreadyJoined: boolean;
}): void => {
  if (alreadyJoined) throw new Error("Player already joined this tournament.");
  if (tournament.status === "finalized" || nowNs >= BigInt(tournament.endAtNs)) {
    throw new Error("Tournament registration is closed.");
  }
  if (nowNs >= BigInt(tournament.registrationEndsAtNs)) {
    throw new Error("Tournament registration deadline has passed.");
  }
  if (tournament.participantCount >= tournament.maxParticipants) {
    throw new Error("Tournament participant limit was reached.");
  }
};

export const validateTournamentSession = ({
  tournament,
  entry,
  gameId,
  rulesetVersion,
  nowNs,
}: {
  readonly tournament: TournamentRecord;
  readonly entry: TournamentEntry | null;
  readonly gameId: string;
  readonly rulesetVersion: string;
  readonly nowNs: bigint;
}): void => {
  if (tournamentStatusAt(tournament, nowNs) !== "active") {
    throw new Error("Tournament is not active.");
  }
  if (entry === null) throw new Error("Join the tournament before starting a run.");
  if (
    tournament.gameId !== gameId ||
    tournament.rulesetVersion !== rulesetVersion
  ) {
    throw new Error("Tournament game or ruleset does not match the session.");
  }
};

export const validateTournamentScore = ({
  tournament,
  entry,
  session,
  nowNs,
}: {
  readonly tournament: TournamentRecord;
  readonly entry: TournamentEntry | null;
  readonly session: SessionRecord;
  readonly nowNs: bigint;
}): void => {
  if (session.tournamentId !== tournament.tournamentId) {
    throw new Error("Session is not bound to this tournament.");
  }
  validateTournamentSession({
    tournament,
    entry,
    gameId: session.gameId,
    rulesetVersion: session.rulesetVersion,
    nowNs,
  });
  if (BigInt(session.createdAtNs) < BigInt(tournament.startAtNs)) {
    throw new Error("Tournament session predates the tournament window.");
  }
};

export const validateTournamentFinalization = (
  tournament: TournamentRecord,
  nowNs: bigint,
): void => {
  if (tournament.status === "finalized") {
    throw new Error("Tournament is already finalized.");
  }
  if (tournamentStatusAt(tournament, nowNs) !== "closed") {
    throw new Error("Tournament must be closed before finalization.");
  }
};

export const serializeTournamentResult = (
  tournament: TournamentRecord,
  entries: readonly LeaderboardEntry[],
): string =>
  JSON.stringify({
    protocol: TOURNAMENT_RESULT_PROTOCOL,
    kind: tournament.kind ?? "weekly",
    tournamentId: tournament.tournamentId,
    gameId: tournament.gameId,
    rulesetVersion: tournament.rulesetVersion,
    startAtNs: tournament.startAtNs,
    endAtNs: tournament.endAtNs,
    entries,
  });

export const finalizeTournamentRecord = (
  tournament: TournamentRecord,
  entries: readonly LeaderboardEntry[],
  resultHash: string,
  nowNs: bigint,
): TournamentRecord => {
  validateTournamentFinalization(tournament, nowNs);
  validateRulesetHash(resultHash);
  return {
    ...tournament,
    status: "finalized",
    finalizedAtNs: nowNs.toString(),
    resultHash,
    resultCount: entries.length,
    podium: entries.slice(0, 3),
  };
};

export const updateTournamentEntry = (
  current: TournamentEntry,
  record: ScoreRecord,
): TournamentEntry => {
  const candidate = leaderboardEntryFromScore(record);
  const currentBest: LeaderboardEntry | null =
    current.bestScore === null ||
    current.bestSessionId === null ||
    current.bestReplayHash === null ||
    current.bestAcceptedAtNs === null ||
    current.bestAcceptedBlockHeight === null
      ? null
      : {
          playerId: current.playerId,
          score: current.bestScore,
          sessionId: current.bestSessionId,
          replayHash: current.bestReplayHash,
          rulesetVersion: record.rulesetVersion,
          acceptedAtNs: current.bestAcceptedAtNs,
          acceptedBlockHeight: current.bestAcceptedBlockHeight,
        };
  const best =
    currentBest === null || compareLeaderboardEntries(candidate, currentBest) < 0
      ? candidate
      : currentBest;
  return {
    ...current,
    acceptedRuns: current.acceptedRuns + 1,
    bestScore: best.score,
    bestSessionId: best.sessionId,
    bestReplayHash: best.replayHash,
    bestAcceptedAtNs: best.acceptedAtNs,
    bestAcceptedBlockHeight: best.acceptedBlockHeight,
  };
};

export const paginateTournamentLeaderboard = (
  tournamentId: string,
  entries: readonly LeaderboardEntry[],
  cursor: number,
  limit: number,
): TournamentLeaderboardPage => {
  const page = paginateLeaderboard(
    "tournament",
    "all",
    tournamentId,
    entries,
    cursor,
    limit,
  );
  return {
    tournamentId,
    total: page.total,
    cursor: page.cursor,
    nextCursor: page.nextCursor,
    rows: page.rows,
  };
};

export const appendAchievement = (
  records: readonly AchievementRecord[],
  achievement: AchievementRecord,
): AchievementAppendResult => {
  if (records.some((record) => record.achievementId === achievement.achievementId)) {
    return { records, added: false };
  }
  if (records.length >= MAX_PLAYER_ACHIEVEMENTS) {
    return { records, added: false };
  }
  return { records: [achievement, ...records], added: true };
};

export const paginateAchievements = (
  playerId: string,
  records: readonly AchievementRecord[],
  cursor: number,
  limit: number,
): AchievementPage => {
  if (!Number.isInteger(cursor) || cursor < 0) {
    throw new Error("Achievement cursor must be a non-negative integer.");
  }
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_ACHIEVEMENT_PAGE_SIZE
  ) {
    throw new Error(
      `Achievement page size must be between 1 and ${MAX_ACHIEVEMENT_PAGE_SIZE}.`,
    );
  }
  const rows = records.slice(cursor, cursor + limit);
  const next = cursor + rows.length;
  return {
    playerId,
    total: records.length,
    cursor,
    nextCursor: next < records.length ? next : null,
    rows,
  };
};
