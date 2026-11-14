import type { ApiConfig } from "./config.js";
import { ApiError } from "./errors.js";

const ACCOUNT_ID_PATTERN =
  /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const GAME_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TOURNAMENT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export interface ContractViewReader {
  view<Value>(methodName: string, args: object): Promise<Value>;
}

export interface ChainPlayerStats {
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

export interface ChainLeaderboardRow {
  readonly rank: number;
  readonly playerId: string;
  readonly score: number;
  readonly sessionId: string;
  readonly replayHash: string;
  readonly rulesetVersion: string;
  readonly acceptedAtNs: string;
  readonly acceptedBlockHeight: string;
}

export interface ChainLeaderboardPage {
  readonly gameId: string;
  readonly period: "all" | "daily";
  readonly periodId: string;
  readonly total: number;
  readonly cursor: number;
  readonly nextCursor: number | null;
  readonly rows: readonly ChainLeaderboardRow[];
}

export interface LeaderboardQuery {
  readonly period: "all" | "daily";
  readonly cursor: number;
  readonly limit: number;
}

export interface PaginationQuery {
  readonly cursor: number;
  readonly limit: number;
}

export interface ChainTournament {
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
  readonly status: "scheduled" | "active" | "closed" | "finalized";
  readonly finalizedAtNs: string | null;
  readonly resultHash: string | null;
  readonly resultCount: number;
  readonly podium: readonly Omit<ChainLeaderboardRow, "rank">[];
  readonly rewardType: "none";
  readonly rewardDescription: string;
}

export interface ChainTournamentEntry {
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

export interface ChainTournamentLeaderboardPage {
  readonly tournamentId: string;
  readonly total: number;
  readonly cursor: number;
  readonly nextCursor: number | null;
  readonly rows: readonly ChainLeaderboardRow[];
}

export interface ChainAchievement {
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

export interface ChainAchievementPage {
  readonly playerId: string;
  readonly total: number;
  readonly cursor: number;
  readonly nextCursor: number | null;
  readonly rows: readonly ChainAchievement[];
}

const parseBoundedInteger = (
  value: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number => {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) {
    throw new ApiError(400, "INVALID_PAGINATION", `${label} must be an integer.`);
  }
  const parsed = Number.parseInt(value, 10);
  if (parsed < minimum || parsed > maximum) {
    throw new ApiError(
      400,
      "INVALID_PAGINATION",
      `${label} must be between ${minimum} and ${maximum}.`,
    );
  }
  return parsed;
};

export const parseLeaderboardQuery = (
  searchParams: URLSearchParams,
): LeaderboardQuery => {
  const period = searchParams.get("period") ?? "all";
  if (period !== "all" && period !== "daily") {
    throw new ApiError(
      400,
      "INVALID_PERIOD",
      "Leaderboard period must be all or daily.",
    );
  }
  return {
    period,
    cursor: parseBoundedInteger(
      searchParams.get("cursor"),
      0,
      0,
      99,
      "Cursor",
    ),
    limit: parseBoundedInteger(
      searchParams.get("limit"),
      10,
      1,
      25,
      "Limit",
    ),
  };
};

export const parsePaginationQuery = (
  searchParams: URLSearchParams,
): PaginationQuery => ({
  cursor: parseBoundedInteger(searchParams.get("cursor"), 0, 0, 255, "Cursor"),
  limit: parseBoundedInteger(searchParams.get("limit"), 10, 1, 25, "Limit"),
});

export const validatePlayerId = (accountId: string): string => {
  if (
    accountId.length < 2 ||
    accountId.length > 64 ||
    !ACCOUNT_ID_PATTERN.test(accountId)
  ) {
    throw new ApiError(400, "INVALID_PLAYER", "Player account id is invalid.");
  }
  return accountId;
};

export const validateGameId = (gameId: string): string => {
  if (gameId.length < 2 || gameId.length > 32 || !GAME_ID_PATTERN.test(gameId)) {
    throw new ApiError(400, "INVALID_GAME", "Game id is invalid.");
  }
  return gameId;
};

export const validateTournamentId = (tournamentId: string): string => {
  if (
    tournamentId.length < 2 ||
    tournamentId.length > 48 ||
    !TOURNAMENT_ID_PATTERN.test(tournamentId)
  ) {
    throw new ApiError(
      400,
      "INVALID_TOURNAMENT",
      "Tournament id is invalid.",
    );
  }
  return tournamentId;
};

const assertStats = (stats: ChainPlayerStats): void => {
  if (
    !Number.isInteger(stats.totalAcceptedRuns) ||
    stats.totalAcceptedRuns < 1 ||
    !Number.isInteger(stats.personalBest) ||
    !SHA256_PATTERN.test(stats.bestSessionId) ||
    !SHA256_PATTERN.test(stats.bestReplayHash) ||
    !/^\d+$/.test(stats.bestAcceptedAtNs) ||
    !/^\d+$/.test(stats.bestAcceptedBlockHeight)
  ) {
    throw new ApiError(
      503,
      "INVALID_CHAIN_STATE",
      "The contract returned invalid player statistics.",
    );
  }
};

const assertLeaderboardPage = (page: ChainLeaderboardPage): void => {
  if (
    !Number.isInteger(page.total) ||
    page.total < 0 ||
    !Number.isInteger(page.cursor) ||
    page.cursor < 0 ||
    (page.nextCursor !== null &&
      (!Number.isInteger(page.nextCursor) || page.nextCursor < 1)) ||
    !Array.isArray(page.rows)
  ) {
    throw new ApiError(
      503,
      "INVALID_CHAIN_STATE",
      "The contract returned an invalid leaderboard page.",
    );
  }
  for (const row of page.rows) {
    if (
      !Number.isInteger(row.rank) ||
      row.rank < 1 ||
      !Number.isInteger(row.score) ||
      row.score < 0 ||
      !SHA256_PATTERN.test(row.sessionId) ||
      !SHA256_PATTERN.test(row.replayHash) ||
      !/^\d+$/.test(row.acceptedAtNs) ||
      !/^\d+$/.test(row.acceptedBlockHeight)
    ) {
      throw new ApiError(
        503,
        "INVALID_CHAIN_STATE",
        "The contract returned an invalid leaderboard row.",
      );
    }
  }
};

const assertTournament = (tournament: ChainTournament): void => {
  if (
    !TOURNAMENT_ID_PATTERN.test(tournament.tournamentId) ||
    !GAME_ID_PATTERN.test(tournament.gameId) ||
    !/^\d+$/.test(tournament.startAtNs) ||
    !/^\d+$/.test(tournament.endAtNs) ||
    !/^\d+$/.test(tournament.registrationEndsAtNs) ||
    !Number.isInteger(tournament.maxParticipants) ||
    tournament.maxParticipants < 1 ||
    !Number.isInteger(tournament.participantCount) ||
    tournament.participantCount < 0 ||
    tournament.participantCount > tournament.maxParticipants ||
    !["scheduled", "active", "closed", "finalized"].includes(
      tournament.status,
    ) ||
    tournament.rewardType !== "none" ||
    !Array.isArray(tournament.podium) ||
    (tournament.resultHash !== null && !SHA256_PATTERN.test(tournament.resultHash))
  ) {
    throw new ApiError(
      503,
      "INVALID_CHAIN_STATE",
      "The contract returned an invalid tournament.",
    );
  }
};

const assertTournamentEntry = (entry: ChainTournamentEntry): void => {
  if (
    !TOURNAMENT_ID_PATTERN.test(entry.tournamentId) ||
    !/^\d+$/.test(entry.joinedAtNs) ||
    !Number.isInteger(entry.acceptedRuns) ||
    entry.acceptedRuns < 0 ||
    (entry.bestScore !== null &&
      (!Number.isInteger(entry.bestScore) ||
        entry.bestSessionId === null ||
        !SHA256_PATTERN.test(entry.bestSessionId) ||
        entry.bestReplayHash === null ||
        !SHA256_PATTERN.test(entry.bestReplayHash)))
  ) {
    throw new ApiError(
      503,
      "INVALID_CHAIN_STATE",
      "The contract returned an invalid tournament entry.",
    );
  }
};

const assertAchievementPage = (page: ChainAchievementPage): void => {
  if (
    !Number.isInteger(page.total) ||
    page.total < 0 ||
    !Number.isInteger(page.cursor) ||
    page.cursor < 0 ||
    !Array.isArray(page.rows)
  ) {
    throw new ApiError(
      503,
      "INVALID_CHAIN_STATE",
      "The contract returned an invalid achievement page.",
    );
  }
  for (const achievement of page.rows) {
    if (
      typeof achievement.achievementId !== "string" ||
      typeof achievement.title !== "string" ||
      !/^\d+$/.test(achievement.earnedAtNs) ||
      (achievement.sourceSessionId !== null &&
        !SHA256_PATTERN.test(achievement.sourceSessionId)) ||
      (achievement.tournamentId !== null &&
        !TOURNAMENT_ID_PATTERN.test(achievement.tournamentId))
    ) {
      throw new ApiError(
        503,
        "INVALID_CHAIN_STATE",
        "The contract returned an invalid achievement.",
      );
    }
  }
};

export class PublicReadService {
  readonly #config: ApiConfig;
  readonly #reader: ContractViewReader;

  constructor(config: ApiConfig, reader: ContractViewReader) {
    this.#config = config;
    this.#reader = reader;
  }

  async getPlayerStats(accountId: string): Promise<Record<string, unknown>> {
    const playerId = validatePlayerId(accountId);
    let stats: ChainPlayerStats | null;
    try {
      stats = await this.#reader.view("get_player_stats", {
        account_id: playerId,
        game_id: "cloud-hop",
      });
    } catch {
      throw new ApiError(
        503,
        "CHAIN_UNAVAILABLE",
        "Player statistics could not be read from NEAR.",
      );
    }
    if (stats !== null) assertStats(stats);
    return {
      playerId,
      gameId: "cloud-hop",
      stats,
      playerExplorerUrl: `${this.#config.explorerUrl}/address/${encodeURIComponent(playerId)}`,
      bestBlockExplorerUrl:
        stats === null || stats.bestAcceptedBlockHeight === "0"
          ? null
          : `${this.#config.explorerUrl}/blocks/${stats.bestAcceptedBlockHeight}`,
      latestBlockExplorerUrl:
        stats === null || stats.latestAcceptedBlockHeight === "0"
          ? null
          : `${this.#config.explorerUrl}/blocks/${stats.latestAcceptedBlockHeight}`,
    };
  }

  async getLeaderboard(
    gameId: string,
    query: LeaderboardQuery,
  ): Promise<Record<string, unknown>> {
    const validatedGameId = validateGameId(gameId);
    let page: ChainLeaderboardPage;
    try {
      page = await this.#reader.view("get_leaderboard_page", {
        game_id: validatedGameId,
        period: query.period,
        cursor: query.cursor,
        limit: query.limit,
      });
    } catch {
      throw new ApiError(
        503,
        "CHAIN_UNAVAILABLE",
        "The leaderboard could not be read from NEAR.",
      );
    }
    assertLeaderboardPage(page);
    if (
      page.gameId !== validatedGameId ||
      page.period !== query.period ||
      page.cursor !== query.cursor
    ) {
      throw new ApiError(
        503,
        "INVALID_CHAIN_STATE",
        "The contract returned a mismatched leaderboard page.",
      );
    }
    return {
      ...page,
      rows: page.rows.map((row) => ({
        ...row,
        playerExplorerUrl: `${this.#config.explorerUrl}/address/${encodeURIComponent(row.playerId)}`,
        blockExplorerUrl:
          row.acceptedBlockHeight === "0"
            ? null
            : `${this.#config.explorerUrl}/blocks/${row.acceptedBlockHeight}`,
      })),
    };
  }

  async getTournament(tournamentId: string): Promise<Record<string, unknown>> {
    const validatedId = validateTournamentId(tournamentId);
    let tournament: ChainTournament | null;
    try {
      tournament = await this.#reader.view("get_tournament", {
        tournament_id: validatedId,
      });
    } catch {
      throw new ApiError(
        503,
        "CHAIN_UNAVAILABLE",
        "The tournament could not be read from NEAR.",
      );
    }
    if (tournament !== null) assertTournament(tournament);
    return {
      tournament,
      contractExplorerUrl: `${this.#config.explorerUrl}/address/${encodeURIComponent(this.#config.contractId)}`,
    };
  }

  async getCurrentTournament(gameId: string): Promise<Record<string, unknown>> {
    const validatedGameId = validateGameId(gameId);
    let tournament: ChainTournament | null;
    try {
      tournament = await this.#reader.view("get_current_tournament", {
        game_id: validatedGameId,
      });
    } catch {
      throw new ApiError(
        503,
        "CHAIN_UNAVAILABLE",
        "The current tournament could not be read from NEAR.",
      );
    }
    if (tournament !== null) assertTournament(tournament);
    return {
      tournament,
      contractExplorerUrl: `${this.#config.explorerUrl}/address/${encodeURIComponent(this.#config.contractId)}`,
    };
  }

  async getTournamentEntry(
    tournamentId: string,
    accountId: string,
  ): Promise<Record<string, unknown>> {
    const validatedTournamentId = validateTournamentId(tournamentId);
    const playerId = validatePlayerId(accountId);
    let entry: ChainTournamentEntry | null;
    try {
      entry = await this.#reader.view("get_tournament_entry", {
        tournament_id: validatedTournamentId,
        account_id: playerId,
      });
    } catch {
      throw new ApiError(
        503,
        "CHAIN_UNAVAILABLE",
        "The tournament entry could not be read from NEAR.",
      );
    }
    if (entry !== null) assertTournamentEntry(entry);
    return { tournamentId: validatedTournamentId, playerId, entry };
  }

  async getTournamentLeaderboard(
    tournamentId: string,
    query: PaginationQuery,
  ): Promise<Record<string, unknown>> {
    const validatedId = validateTournamentId(tournamentId);
    let page: ChainTournamentLeaderboardPage;
    try {
      page = await this.#reader.view("get_tournament_leaderboard_page", {
        tournament_id: validatedId,
        cursor: query.cursor,
        limit: query.limit,
      });
    } catch {
      throw new ApiError(
        503,
        "CHAIN_UNAVAILABLE",
        "The tournament leaderboard could not be read from NEAR.",
      );
    }
    assertLeaderboardPage({
      ...page,
      gameId: "cloud-hop",
      period: "all",
      periodId: validatedId,
    });
    if (page.tournamentId !== validatedId || page.cursor !== query.cursor) {
      throw new ApiError(
        503,
        "INVALID_CHAIN_STATE",
        "The contract returned a mismatched tournament leaderboard.",
      );
    }
    return {
      ...page,
      rows: page.rows.map((row) => ({
        ...row,
        playerExplorerUrl: `${this.#config.explorerUrl}/address/${encodeURIComponent(row.playerId)}`,
        blockExplorerUrl:
          row.acceptedBlockHeight === "0"
            ? null
            : `${this.#config.explorerUrl}/blocks/${row.acceptedBlockHeight}`,
      })),
    };
  }

  async getPlayerAchievements(
    accountId: string,
    query: PaginationQuery,
  ): Promise<Record<string, unknown>> {
    const playerId = validatePlayerId(accountId);
    let page: ChainAchievementPage;
    try {
      page = await this.#reader.view("get_player_achievements", {
        account_id: playerId,
        cursor: query.cursor,
        limit: query.limit,
      });
    } catch {
      throw new ApiError(
        503,
        "CHAIN_UNAVAILABLE",
        "Player achievements could not be read from NEAR.",
      );
    }
    assertAchievementPage(page);
    if (page.playerId !== playerId || page.cursor !== query.cursor) {
      throw new ApiError(
        503,
        "INVALID_CHAIN_STATE",
        "The contract returned a mismatched achievement page.",
      );
    }
    return {
      ...page,
      playerExplorerUrl: `${this.#config.explorerUrl}/address/${encodeURIComponent(playerId)}`,
    };
  }
}
