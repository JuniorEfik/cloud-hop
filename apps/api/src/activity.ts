import type { ApiConfig } from "./config.js";
import { ApiError } from "./errors.js";
import type { ContractViewReader } from "./read-model.js";

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
  readonly score: number | null;
}

export interface ContractActivityTotals {
  readonly players: number | null;
  readonly gamesStarted: number;
  readonly verifiedScores: number;
  readonly tournamentEntries: number;
  readonly complete: boolean;
}

export interface ContractActivityFeed {
  readonly contractId: string;
  readonly updatedAt: string;
  readonly stale: boolean;
  readonly totals: ContractActivityTotals;
  readonly rows: readonly ContractActivity[];
}

type ActivityFetcher = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

interface ActivityServiceOptions {
  readonly fetcher?: ActivityFetcher;
  readonly now?: () => number;
  readonly wait?: (delayMs: number) => Promise<void>;
  readonly cacheTtlMs?: number;
  readonly totalsCacheTtlMs?: number;
  readonly failureBackoffBaseMs?: number;
  readonly failureBackoffMaxMs?: number;
  readonly reader?: ContractViewReader;
}

interface IndexedActivityPage {
  readonly cursor: string | null;
  readonly receipts: readonly unknown[];
}

const ACCOUNT_ID_PATTERN =
  /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const TRANSACTION_HASH_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const METHOD_KINDS = new Map<string, ContractActivityKind>([
  ["create_session", "session-started"],
  ["submit_verified_score", "score-recorded"],
  ["join_tournament", "tournament-joined"],
  ["abandon_session", "session-abandoned"],
]);
const TOTAL_METHODS = [
  "create_session",
  "submit_verified_score",
  "join_tournament",
] as const;
type TotalMethod = (typeof TOTAL_METHODS)[number];
const DEFAULT_CACHE_TTL_MS = 10_000;
const DEFAULT_TOTALS_CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_FAILURE_BACKOFF_BASE_MS = 5_000;
const DEFAULT_FAILURE_BACKOFF_MAX_MS = 60_000;
const MAX_ACTIVITY_ROWS = 12;
const INDEXER_PAGE_SIZE = 25;
const INDEXER_MAX_ATTEMPTS = 7;
const INDEXER_RETRY_BASE_MS = 1_000;
const INDEXER_RETRY_MAX_MS = 30_000;
const MAX_TOTAL_PAGES = 100;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;

const parseActivityPage = (value: unknown): IndexedActivityPage => {
  const body = asRecord(value);
  const meta = asRecord(body?.meta);
  const nextPage = meta?.next_page;
  if (
    body === null ||
    !Array.isArray(body.data) ||
    (nextPage !== undefined && nextPage !== null && typeof nextPage !== "string")
  ) {
    throw new Error("NearBlocks returned an invalid activity response.");
  }
  return {
    cursor: typeof nextPage === "string" ? nextPage : null,
    receipts: body.data,
  };
};

const transactionMethods = (
  value: unknown,
  contractId: string,
): readonly { readonly method: string; readonly hash: string }[] => {
  const transaction = asRecord(value);
  const transactionHash = transaction?.transaction_hash;
  if (
    transaction === null ||
    asRecord(transaction.outcome)?.status !== true ||
    transaction.receiver_account_id !== contractId ||
    typeof transactionHash !== "string" ||
    !TRANSACTION_HASH_PATTERN.test(transactionHash) ||
    !Array.isArray(transaction.actions)
  ) {
    return [];
  }
  return transaction.actions.flatMap((value) => {
    const action = asRecord(value);
    return typeof action?.method === "string" && METHOD_KINDS.has(action.method)
      ? [{ method: action.method, hash: transactionHash }]
      : [];
  });
};

const parseTransactions = (
  transactions: readonly unknown[],
  contractId: string,
  explorerUrl: string,
): readonly ContractActivity[] => {
  const rows: ContractActivity[] = [];
  const seen = new Set<string>();
  for (const value of transactions) {
    const transaction = asRecord(value);
    const playerId = transaction?.predecessor_account_id;
    const timestampNs = asRecord(transaction?.block)?.block_timestamp;
    if (
      transaction === null ||
      typeof playerId !== "string" ||
      playerId.length < 2 ||
      playerId.length > 64 ||
      !ACCOUNT_ID_PATTERN.test(playerId) ||
      typeof timestampNs !== "string" ||
      !/^\d+$/.test(timestampNs)
    ) {
      continue;
    }

    for (const action of transactionMethods(transaction, contractId)) {
      const kind = METHOD_KINDS.get(action.method);
      if (kind === undefined) continue;
      const id = `${action.hash}:${kind}`;
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push({
        id,
        kind,
        playerId,
        timestampNs,
        transactionHash: action.hash,
        transactionExplorerUrl: `${explorerUrl}/txns/${action.hash}`,
        playerExplorerUrl: `${explorerUrl}/address/${encodeURIComponent(playerId)}`,
        score: null,
      });
    }
  }

  return rows
    .sort((left, right) => {
      const leftTimestamp = BigInt(left.timestampNs);
      const rightTimestamp = BigInt(right.timestampNs);
      if (leftTimestamp === rightTimestamp) return 0;
      return leftTimestamp > rightTimestamp ? -1 : 1;
    })
    .slice(0, MAX_ACTIVITY_ROWS);
};

const parseScore = (value: unknown): number | null => {
  const body = asRecord(value);
  const transaction = asRecord(body?.data);
  if (transaction === null || !Array.isArray(transaction.actions)) return null;
  for (const value of transaction.actions) {
    const action = asRecord(value);
    if (action?.method !== "submit_verified_score") continue;
    const args = asRecord(asRecord(action.args)?.args_json);
    if (
      typeof args?.score === "number" &&
      Number.isInteger(args.score) &&
      args.score >= 0 &&
      args.score <= 1_000_000
    ) {
      return args.score;
    }
  }
  return null;
};

const countTransactions = (
  transactions: readonly unknown[],
  contractId: string,
  seen: Set<string>,
  totals: { gamesStarted: number; verifiedScores: number; tournamentEntries: number },
): void => {
  for (const transaction of transactions) {
    for (const action of transactionMethods(transaction, contractId)) {
      const id = `${action.hash}:${action.method}`;
      if (seen.has(id)) continue;
      seen.add(id);
      if (action.method === "create_session") totals.gamesStarted += 1;
      if (action.method === "submit_verified_score") totals.verifiedScores += 1;
      if (action.method === "join_tournament") totals.tournamentEntries += 1;
    }
  }
};

export class ContractActivityService {
  readonly #config: Pick<
    ApiConfig,
    "contractId" | "explorerUrl" | "indexerUrl"
  >;
  readonly #fetcher: ActivityFetcher;
  readonly #now: () => number;
  readonly #wait: (delayMs: number) => Promise<void>;
  readonly #cacheTtlMs: number;
  readonly #totalsCacheTtlMs: number;
  readonly #failureBackoffBaseMs: number;
  readonly #failureBackoffMaxMs: number;
  readonly #reader: ContractViewReader | undefined;
  #cache: { readonly expiresAt: number; readonly feed: ContractActivityFeed } | null =
    null;
  #totalsCache: {
    readonly expiresAt: number;
    readonly totals: ContractActivityTotals;
  } | null = null;
  #totalsHighWater: ContractActivityTotals | null = null;
  #refreshInFlight: Promise<ContractActivityFeed> | null = null;
  #retryAt = 0;
  #consecutiveFailures = 0;

  constructor(config: ApiConfig, options: ActivityServiceOptions = {}) {
    this.#config = config;
    this.#fetcher = options.fetcher ?? fetch;
    this.#now = options.now ?? Date.now;
    this.#wait =
      options.wait ??
      ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
    this.#cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.#totalsCacheTtlMs =
      options.totalsCacheTtlMs ?? DEFAULT_TOTALS_CACHE_TTL_MS;
    this.#failureBackoffBaseMs =
      options.failureBackoffBaseMs ?? DEFAULT_FAILURE_BACKOFF_BASE_MS;
    this.#failureBackoffMaxMs =
      options.failureBackoffMaxMs ?? DEFAULT_FAILURE_BACKOFF_MAX_MS;
    if (
      this.#failureBackoffBaseMs < 0 ||
      this.#failureBackoffMaxMs < this.#failureBackoffBaseMs
    ) {
      throw new Error("Activity failure backoff configuration is invalid.");
    }
    this.#reader = options.reader;
  }

  async #fetchPage(
    cursor: string | null = null,
    method: TotalMethod | null = null,
  ): Promise<IndexedActivityPage> {
    const url = new URL(
      `/v3/accounts/${encodeURIComponent(this.#config.contractId)}/receipts`,
      this.#config.indexerUrl,
    );
    url.searchParams.set("limit", INDEXER_PAGE_SIZE.toString());
    if (cursor !== null) url.searchParams.set("next", cursor);
    if (method !== null) url.searchParams.set("method", method);
    for (let attempt = 0; attempt < INDEXER_MAX_ATTEMPTS; attempt += 1) {
      const response = await this.#fetcher(url.toString(), {
        headers: {
          accept: "application/json",
          "user-agent": "Cloud-Hop/1.0",
        },
        signal: AbortSignal.timeout(4_500),
      });
      if (response.ok) return parseActivityPage(await response.json());
      if (response.status !== 429 || attempt === INDEXER_MAX_ATTEMPTS - 1) {
        throw new Error(`NearBlocks returned ${response.status}.`);
      }
      const retryAfter = response.headers.get("retry-after");
      const retryAfterSeconds = retryAfter === null ? Number.NaN : Number(retryAfter);
      const retryDelay =
        Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
          ? Math.min(retryAfterSeconds * 1_000, INDEXER_RETRY_MAX_MS)
          : Math.min(
              INDEXER_RETRY_BASE_MS * 2 ** attempt,
              INDEXER_RETRY_MAX_MS,
            );
      await this.#wait(retryDelay);
    }
    throw new Error("NearBlocks activity retries were exhausted.");
  }

  async #scoreFor(transactionHash: string): Promise<number | null> {
    try {
      const url = new URL(
        `/v3/txns/${encodeURIComponent(transactionHash)}`,
        this.#config.indexerUrl,
      );
      const response = await this.#fetcher(url.toString(), {
        headers: {
          accept: "application/json",
          "user-agent": "Cloud-Hop/1.0",
        },
        signal: AbortSignal.timeout(4_500),
      });
      if (!response.ok) return null;
      return parseScore(await response.json());
    } catch {
      return null;
    }
  }

  async #enrichScores(
    rows: readonly ContractActivity[],
  ): Promise<readonly ContractActivity[]> {
    const enriched = [...rows];
    for (let index = 0; index < enriched.length; index += 2) {
      const batch = enriched.slice(index, index + 2);
      const resolved = await Promise.all(
        batch.map(async (row) =>
          row.kind === "score-recorded"
            ? { ...row, score: await this.#scoreFor(row.transactionHash) }
            : row,
        ),
      );
      enriched.splice(index, resolved.length, ...resolved);
    }
    return enriched;
  }

  async #playerTotal(): Promise<number | null> {
    if (this.#reader === undefined) return null;
    try {
      const page = await this.#reader.view<unknown>("get_leaderboard_page", {
        game_id: "cloud-hop",
        period: "all",
        cursor: 0,
        limit: 1,
      });
      const total = asRecord(page)?.total;
      return typeof total === "number" && Number.isInteger(total) && total >= 0
        ? total
        : null;
    } catch {
      return null;
    }
  }

  async #scanMethod(method: TotalMethod): Promise<{
    readonly count: number;
    readonly complete: boolean;
  }> {
    const counts = { gamesStarted: 0, verifiedScores: 0, tournamentEntries: 0 };
    const seen = new Set<string>();
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    while (
      pages < MAX_TOTAL_PAGES &&
      (cursor === null || !seenCursors.has(cursor))
    ) {
      let page: IndexedActivityPage;
      try {
        page = await this.#fetchPage(cursor, method);
      } catch (error) {
        throw new Error("The complete activity history could not be scanned.", {
          cause: error,
        });
      }
      countTransactions(page.receipts, this.#config.contractId, seen, counts);
      if (cursor !== null) seenCursors.add(cursor);
      cursor = page.cursor;
      pages += 1;
      if (page.receipts.length === 0) cursor = null;
      if (cursor === null) break;
    }

    const count =
      method === "create_session"
        ? counts.gamesStarted
        : method === "submit_verified_score"
          ? counts.verifiedScores
          : counts.tournamentEntries;
    return { count, complete: cursor === null };
  }

  async #getTotals(): Promise<ContractActivityTotals> {
    const now = this.#now();
    if (this.#totalsCache !== null && this.#totalsCache.expiresAt > now) {
      return this.#totalsCache.totals;
    }

    const methodCounts = new Map<
      TotalMethod,
      { readonly count: number; readonly complete: boolean }
    >();
    for (const method of TOTAL_METHODS) {
      methodCounts.set(method, await this.#scanMethod(method));
    }

    const scannedTotals: ContractActivityTotals = {
      players: await this.#playerTotal(),
      gamesStarted: methodCounts.get("create_session")?.count ?? 0,
      verifiedScores: methodCounts.get("submit_verified_score")?.count ?? 0,
      tournamentEntries: methodCounts.get("join_tournament")?.count ?? 0,
      complete: TOTAL_METHODS.every(
        (method) => methodCounts.get(method)?.complete === true,
      ),
    };
    const previous = this.#totalsHighWater;
    const totals: ContractActivityTotals =
      previous === null
        ? scannedTotals
        : {
            players:
              scannedTotals.players === null
                ? previous.players
                : previous.players === null
                  ? scannedTotals.players
                  : Math.max(previous.players, scannedTotals.players),
            gamesStarted: Math.max(
              previous.gamesStarted,
              scannedTotals.gamesStarted,
            ),
            verifiedScores: Math.max(
              previous.verifiedScores,
              scannedTotals.verifiedScores,
            ),
            tournamentEntries: Math.max(
              previous.tournamentEntries,
              scannedTotals.tournamentEntries,
            ),
            complete: scannedTotals.complete,
          };
    this.#totalsHighWater = totals;
    this.#totalsCache = {
      expiresAt: now + this.#totalsCacheTtlMs,
      totals,
    };
    return totals;
  }

  async #refreshFeed(): Promise<ContractActivityFeed> {
    const page = await this.#fetchPage();
    const totals = await this.#getTotals();
    const rows = await this.#enrichScores(
      parseTransactions(
        page.receipts,
        this.#config.contractId,
        this.#config.explorerUrl,
      ),
    );
    const refreshedAt = this.#now();
    const feed: ContractActivityFeed = {
      contractId: this.#config.contractId,
      updatedAt: new Date(refreshedAt).toISOString(),
      stale: false,
      totals,
      rows,
    };
    this.#cache = { expiresAt: refreshedAt + this.#cacheTtlMs, feed };
    return feed;
  }

  #startRefresh(): Promise<ContractActivityFeed> {
    if (this.#refreshInFlight !== null) return this.#refreshInFlight;

    const refresh = this.#refreshFeed()
      .then((feed) => {
        this.#consecutiveFailures = 0;
        this.#retryAt = 0;
        return feed;
      })
      .catch((error: unknown) => {
        this.#consecutiveFailures += 1;
        const exponent = Math.min(this.#consecutiveFailures - 1, 10);
        const delay = Math.min(
          this.#failureBackoffMaxMs,
          this.#failureBackoffBaseMs * 2 ** exponent,
        );
        this.#retryAt = this.#now() + delay;
        throw error;
      })
      .finally(() => {
        if (this.#refreshInFlight === refresh) this.#refreshInFlight = null;
      });
    this.#refreshInFlight = refresh;
    return refresh;
  }

  #unavailable(): ApiError {
    return new ApiError(
      503,
      "ACTIVITY_UNAVAILABLE",
      "Live contract activity is temporarily unavailable.",
    );
  }

  async getFeed(): Promise<ContractActivityFeed> {
    const now = this.#now();
    if (this.#cache !== null && this.#cache.expiresAt > now) {
      return this.#cache.feed;
    }

    if (this.#cache !== null) {
      if (now >= this.#retryAt && this.#refreshInFlight === null) {
        void this.#startRefresh().catch(() => undefined);
      }
      return { ...this.#cache.feed, stale: true };
    }

    if (now < this.#retryAt) throw this.#unavailable();
    try {
      return await this.#startRefresh();
    } catch {
      throw this.#unavailable();
    }
  }
}
