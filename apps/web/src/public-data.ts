export type LeaderboardPeriod = "all" | "daily";

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

export interface PlayerStatsResponse {
  readonly playerId: string;
  readonly gameId: string;
  readonly stats: PlayerStats | null;
  readonly playerExplorerUrl: string;
  readonly bestBlockExplorerUrl: string | null;
  readonly latestBlockExplorerUrl: string | null;
}

export interface LeaderboardRow {
  readonly rank: number;
  readonly playerId: string;
  readonly score: number;
  readonly sessionId: string;
  readonly replayHash: string;
  readonly rulesetVersion: string;
  readonly acceptedAtNs: string;
  readonly acceptedBlockHeight: string;
  readonly playerExplorerUrl: string;
  readonly blockExplorerUrl: string | null;
}

export interface LeaderboardPage {
  readonly gameId: string;
  readonly period: LeaderboardPeriod;
  readonly periodId: string;
  readonly total: number;
  readonly cursor: number;
  readonly nextCursor: number | null;
  readonly rows: readonly LeaderboardRow[];
}

export type TournamentStatus = "scheduled" | "active" | "closed" | "finalized";

export interface Tournament {
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
  readonly status: TournamentStatus;
  readonly finalizedAtNs: string | null;
  readonly resultHash: string | null;
  readonly resultCount: number;
  readonly rewardType: "none";
  readonly rewardDescription: string;
}

export interface TournamentResponse {
  readonly tournament: Tournament | null;
  readonly contractExplorerUrl: string;
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

export interface TournamentEntryResponse {
  readonly tournamentId: string;
  readonly playerId: string;
  readonly entry: TournamentEntry | null;
}

export interface TournamentLeaderboardPage {
  readonly tournamentId: string;
  readonly total: number;
  readonly cursor: number;
  readonly nextCursor: number | null;
  readonly rows: readonly LeaderboardRow[];
}

export interface Achievement {
  readonly achievementId: string;
  readonly playerId: string;
  readonly gameId: string;
  readonly kind:
    | "first-run"
    | "first-personal-best"
    | "score-milestone"
    | "tournament-participant"
    | "tournament-podium";
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
  readonly rows: readonly Achievement[];
  readonly playerExplorerUrl: string;
}

export type ContractActivityKind =
  | "session-started"
  | "score-recorded"
  | "tournament-joined"
  | "session-abandoned";

export interface ContractActivity {
  readonly id: string;
  readonly kind: ContractActivityKind;
  readonly playerId: string;
  readonly timestampNs: string;
  readonly transactionHash: string;
  readonly transactionExplorerUrl: string;
  readonly playerExplorerUrl: string;
}

export interface ContractActivityFeed {
  readonly contractId: string;
  readonly updatedAt: string;
  readonly stale: boolean;
  readonly rows: readonly ContractActivity[];
}

const apiBaseUrl = (
  typeof __PUBLIC_API_BASE_URL__ === "string"
    ? __PUBLIC_API_BASE_URL__
    : "http://127.0.0.1:8787"
).replace(/\/$/, "");
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

const isPlayerStats = (value: unknown): value is PlayerStats => {
  const record = asRecord(value);
  return (
    record !== null &&
    typeof record.playerId === "string" &&
    typeof record.gameId === "string" &&
    typeof record.totalAcceptedRuns === "number" &&
    Number.isInteger(record.totalAcceptedRuns) &&
    record.totalAcceptedRuns > 0 &&
    typeof record.personalBest === "number" &&
    Number.isInteger(record.personalBest) &&
    typeof record.bestRulesetVersion === "string" &&
    typeof record.bestSessionId === "string" &&
    SHA256_PATTERN.test(record.bestSessionId) &&
    typeof record.bestReplayHash === "string" &&
    SHA256_PATTERN.test(record.bestReplayHash) &&
    typeof record.bestAcceptedAtNs === "string" &&
    /^\d+$/.test(record.bestAcceptedAtNs) &&
    typeof record.bestAcceptedBlockHeight === "string" &&
    /^\d+$/.test(record.bestAcceptedBlockHeight) &&
    typeof record.latestScore === "number" &&
    Number.isInteger(record.latestScore) &&
    typeof record.latestRulesetVersion === "string" &&
    typeof record.latestSessionId === "string" &&
    SHA256_PATTERN.test(record.latestSessionId) &&
    typeof record.latestReplayHash === "string" &&
    SHA256_PATTERN.test(record.latestReplayHash) &&
    typeof record.latestAcceptedAtNs === "string" &&
    /^\d+$/.test(record.latestAcceptedAtNs) &&
    typeof record.latestAcceptedBlockHeight === "string" &&
    /^\d+$/.test(record.latestAcceptedBlockHeight)
  );
};

const isLeaderboardRow = (value: unknown): value is LeaderboardRow => {
  const record = asRecord(value);
  return (
    record !== null &&
    typeof record.rank === "number" &&
    Number.isInteger(record.rank) &&
    record.rank > 0 &&
    typeof record.playerId === "string" &&
    typeof record.score === "number" &&
    Number.isInteger(record.score) &&
    typeof record.sessionId === "string" &&
    SHA256_PATTERN.test(record.sessionId) &&
    typeof record.replayHash === "string" &&
    SHA256_PATTERN.test(record.replayHash) &&
    typeof record.rulesetVersion === "string" &&
    typeof record.acceptedAtNs === "string" &&
    /^\d+$/.test(record.acceptedAtNs) &&
    typeof record.acceptedBlockHeight === "string" &&
    /^\d+$/.test(record.acceptedBlockHeight) &&
    typeof record.playerExplorerUrl === "string" &&
    isNullableString(record.blockExplorerUrl)
  );
};

const isTournament = (value: unknown): value is Tournament => {
  const record = asRecord(value);
  return (
    record !== null &&
    typeof record.tournamentId === "string" &&
    typeof record.gameId === "string" &&
    typeof record.rulesetVersion === "string" &&
    typeof record.startAtNs === "string" &&
    /^\d+$/.test(record.startAtNs) &&
    typeof record.endAtNs === "string" &&
    /^\d+$/.test(record.endAtNs) &&
    typeof record.registrationEndsAtNs === "string" &&
    /^\d+$/.test(record.registrationEndsAtNs) &&
    typeof record.maxParticipants === "number" &&
    Number.isInteger(record.maxParticipants) &&
    typeof record.participantCount === "number" &&
    Number.isInteger(record.participantCount) &&
    ["scheduled", "active", "closed", "finalized"].includes(
      String(record.status),
    ) &&
    record.rewardType === "none" &&
    typeof record.rewardDescription === "string" &&
    isNullableString(record.finalizedAtNs) &&
    isNullableString(record.resultHash) &&
    typeof record.resultCount === "number" &&
    Number.isInteger(record.resultCount)
  );
};

const isTournamentEntry = (value: unknown): value is TournamentEntry => {
  const record = asRecord(value);
  return (
    record !== null &&
    typeof record.tournamentId === "string" &&
    typeof record.playerId === "string" &&
    typeof record.joinedAtNs === "string" &&
    /^\d+$/.test(record.joinedAtNs) &&
    typeof record.acceptedRuns === "number" &&
    Number.isInteger(record.acceptedRuns) &&
    (record.bestScore === null ||
      (typeof record.bestScore === "number" && Number.isInteger(record.bestScore))) &&
    isNullableString(record.bestSessionId) &&
    isNullableString(record.bestReplayHash) &&
    isNullableString(record.bestAcceptedAtNs) &&
    isNullableString(record.bestAcceptedBlockHeight)
  );
};

const isAchievement = (value: unknown): value is Achievement => {
  const record = asRecord(value);
  return (
    record !== null &&
    typeof record.achievementId === "string" &&
    typeof record.playerId === "string" &&
    typeof record.gameId === "string" &&
    [
      "first-run",
      "first-personal-best",
      "score-milestone",
      "tournament-participant",
      "tournament-podium",
    ].includes(String(record.kind)) &&
    typeof record.title === "string" &&
    typeof record.description === "string" &&
    typeof record.earnedAtNs === "string" &&
    /^\d+$/.test(record.earnedAtNs) &&
    isNullableString(record.sourceSessionId) &&
    isNullableString(record.tournamentId) &&
    (record.rank === null ||
      (typeof record.rank === "number" && Number.isInteger(record.rank))) &&
    (record.score === null ||
      (typeof record.score === "number" && Number.isInteger(record.score)))
  );
};

const isContractActivity = (value: unknown): value is ContractActivity => {
  const record = asRecord(value);
  return (
    record !== null &&
    typeof record.id === "string" &&
    [
      "session-started",
      "score-recorded",
      "tournament-joined",
      "session-abandoned",
    ].includes(String(record.kind)) &&
    typeof record.playerId === "string" &&
    typeof record.timestampNs === "string" &&
    /^\d+$/.test(record.timestampNs) &&
    typeof record.transactionHash === "string" &&
    typeof record.transactionExplorerUrl === "string" &&
    typeof record.playerExplorerUrl === "string"
  );
};

export const parsePlayerStatsResponse = (
  value: unknown,
): PlayerStatsResponse => {
  const record = asRecord(value);
  if (
    record === null ||
    typeof record.playerId !== "string" ||
    typeof record.gameId !== "string" ||
    (record.stats !== null && !isPlayerStats(record.stats)) ||
    typeof record.playerExplorerUrl !== "string" ||
    !isNullableString(record.bestBlockExplorerUrl) ||
    !isNullableString(record.latestBlockExplorerUrl)
  ) {
    throw new Error("The arcade API returned invalid player statistics.");
  }
  return record as unknown as PlayerStatsResponse;
};

export const parseLeaderboardPage = (value: unknown): LeaderboardPage => {
  const record = asRecord(value);
  if (
    record === null ||
    typeof record.gameId !== "string" ||
    (record.period !== "all" && record.period !== "daily") ||
    typeof record.periodId !== "string" ||
    typeof record.total !== "number" ||
    !Number.isInteger(record.total) ||
    typeof record.cursor !== "number" ||
    !Number.isInteger(record.cursor) ||
    (record.nextCursor !== null &&
      (typeof record.nextCursor !== "number" ||
        !Number.isInteger(record.nextCursor))) ||
    !Array.isArray(record.rows) ||
    !record.rows.every(isLeaderboardRow)
  ) {
    throw new Error("The arcade API returned an invalid leaderboard page.");
  }
  return record as unknown as LeaderboardPage;
};

export const parseTournamentResponse = (value: unknown): TournamentResponse => {
  const record = asRecord(value);
  if (
    record === null ||
    (record.tournament !== null && !isTournament(record.tournament)) ||
    typeof record.contractExplorerUrl !== "string"
  ) {
    throw new Error("The arcade API returned an invalid tournament.");
  }
  return record as unknown as TournamentResponse;
};

export const parseTournamentEntryResponse = (
  value: unknown,
): TournamentEntryResponse => {
  const record = asRecord(value);
  if (
    record === null ||
    typeof record.tournamentId !== "string" ||
    typeof record.playerId !== "string" ||
    (record.entry !== null && !isTournamentEntry(record.entry))
  ) {
    throw new Error("The arcade API returned an invalid tournament entry.");
  }
  return record as unknown as TournamentEntryResponse;
};

export const parseTournamentLeaderboardPage = (
  value: unknown,
): TournamentLeaderboardPage => {
  const record = asRecord(value);
  if (
    record === null ||
    typeof record.tournamentId !== "string" ||
    typeof record.total !== "number" ||
    !Number.isInteger(record.total) ||
    typeof record.cursor !== "number" ||
    !Number.isInteger(record.cursor) ||
    (record.nextCursor !== null &&
      (typeof record.nextCursor !== "number" ||
        !Number.isInteger(record.nextCursor))) ||
    !Array.isArray(record.rows) ||
    !record.rows.every(isLeaderboardRow)
  ) {
    throw new Error("The arcade API returned an invalid tournament ranking.");
  }
  return record as unknown as TournamentLeaderboardPage;
};

export const parseAchievementPage = (value: unknown): AchievementPage => {
  const record = asRecord(value);
  if (
    record === null ||
    typeof record.playerId !== "string" ||
    typeof record.total !== "number" ||
    !Number.isInteger(record.total) ||
    typeof record.cursor !== "number" ||
    !Number.isInteger(record.cursor) ||
    (record.nextCursor !== null &&
      (typeof record.nextCursor !== "number" ||
        !Number.isInteger(record.nextCursor))) ||
    !Array.isArray(record.rows) ||
    !record.rows.every(isAchievement) ||
    typeof record.playerExplorerUrl !== "string"
  ) {
    throw new Error("The arcade API returned invalid achievements.");
  }
  return record as unknown as AchievementPage;
};

export const parseContractActivityFeed = (
  value: unknown,
): ContractActivityFeed => {
  const record = asRecord(value);
  if (
    record === null ||
    typeof record.contractId !== "string" ||
    typeof record.updatedAt !== "string" ||
    Number.isNaN(Date.parse(record.updatedAt)) ||
    typeof record.stale !== "boolean" ||
    !Array.isArray(record.rows) ||
    !record.rows.every(isContractActivity)
  ) {
    throw new Error("The arcade API returned invalid contract activity.");
  }
  return record as unknown as ContractActivityFeed;
};

const readResponse = async (response: Response): Promise<unknown> => {
  if (response.ok) return response.json();
  try {
    const body = (await response.json()) as {
      error?: { message?: unknown };
    };
    throw new Error(
      typeof body.error?.message === "string"
        ? body.error.message
        : `The arcade API returned ${response.status}.`,
    );
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error(`The arcade API returned ${response.status}.`);
  }
};

export const loadPlayerStats = async (
  accountId: string,
): Promise<PlayerStatsResponse> => {
  const response = await fetch(
    `${apiBaseUrl}/api/v1/players/${encodeURIComponent(accountId)}/stats`,
    { headers: { accept: "application/json" } },
  );
  return parsePlayerStatsResponse(await readResponse(response));
};

export const loadLeaderboardPage = async (
  period: LeaderboardPeriod,
  cursor = 0,
  limit = 10,
): Promise<LeaderboardPage> => {
  const query = new URLSearchParams({
    period,
    cursor: String(cursor),
    limit: String(limit),
  });
  const response = await fetch(
    `${apiBaseUrl}/api/v1/leaderboards/cloud-hop?${query.toString()}`,
    { headers: { accept: "application/json" } },
  );
  return parseLeaderboardPage(await readResponse(response));
};

export const loadCurrentTournament = async (): Promise<TournamentResponse> => {
  const response = await fetch(
    `${apiBaseUrl}/api/v1/tournaments/current?gameId=cloud-hop`,
    { headers: { accept: "application/json" } },
  );
  return parseTournamentResponse(await readResponse(response));
};

export const loadTournamentEntry = async (
  tournamentId: string,
  accountId: string,
): Promise<TournamentEntryResponse> => {
  const response = await fetch(
    `${apiBaseUrl}/api/v1/tournaments/${encodeURIComponent(tournamentId)}/entries/${encodeURIComponent(accountId)}`,
    { headers: { accept: "application/json" } },
  );
  return parseTournamentEntryResponse(await readResponse(response));
};

export const loadTournamentLeaderboardPage = async (
  tournamentId: string,
  cursor = 0,
  limit = 10,
): Promise<TournamentLeaderboardPage> => {
  const query = new URLSearchParams({
    cursor: String(cursor),
    limit: String(limit),
  });
  const response = await fetch(
    `${apiBaseUrl}/api/v1/tournaments/${encodeURIComponent(tournamentId)}/leaderboard?${query.toString()}`,
    { headers: { accept: "application/json" } },
  );
  return parseTournamentLeaderboardPage(await readResponse(response));
};

export const loadPlayerAchievements = async (
  accountId: string,
  cursor = 0,
  limit = 25,
): Promise<AchievementPage> => {
  const query = new URLSearchParams({
    cursor: String(cursor),
    limit: String(limit),
  });
  const response = await fetch(
    `${apiBaseUrl}/api/v1/players/${encodeURIComponent(accountId)}/achievements?${query.toString()}`,
    { headers: { accept: "application/json" } },
  );
  return parseAchievementPage(await readResponse(response));
};

export const loadContractActivity = async (): Promise<ContractActivityFeed> => {
  const response = await fetch(`${apiBaseUrl}/api/v1/activity`, {
    headers: { accept: "application/json" },
  });
  return parseContractActivityFeed(await readResponse(response));
};

export const formatChainTimestamp = (timestampNs: string): string => {
  const milliseconds = Number(BigInt(timestampNs) / 1_000_000n);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(milliseconds));
};
