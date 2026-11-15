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
  readonly cacheTtlMs?: number;
  readonly totalsCacheTtlMs?: number;
  readonly reader?: ContractViewReader;
}

interface IndexedTransactionPage {
  readonly cursor: string | null;
  readonly txns: readonly unknown[];
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
const DEFAULT_CACHE_TTL_MS = 10_000;
const DEFAULT_TOTALS_CACHE_TTL_MS = 60_000;
const MAX_ACTIVITY_ROWS = 12;
const MAX_TOTAL_PAGES = 40;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;

const parseTransactionPage = (value: unknown): IndexedTransactionPage => {
  const body = asRecord(value);
  if (
    body === null ||
    !Array.isArray(body.txns) ||
    (body.cursor !== undefined &&
      body.cursor !== null &&
      typeof body.cursor !== "string")
  ) {
    throw new Error("NearBlocks returned an invalid activity response.");
  }
  return {
    cursor: typeof body.cursor === "string" ? body.cursor : null,
    txns: body.txns,
  };
};

const transactionMethods = (
  value: unknown,
): readonly { readonly method: string; readonly hash: string }[] => {
  const transaction = asRecord(value);
  const transactionHash = transaction?.transaction_hash;
  if (
    transaction === null ||
    asRecord(transaction.receipt_outcome)?.status !== true ||
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
  explorerUrl: string,
): readonly ContractActivity[] => {
  const rows: ContractActivity[] = [];
  const seen = new Set<string>();
  for (const value of transactions) {
    const transaction = asRecord(value);
    const playerId = transaction?.predecessor_account_id;
    const timestampNs = transaction?.block_timestamp;
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

    for (const action of transactionMethods(transaction)) {
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
  if (body === null || !Array.isArray(body.txns)) return null;
  for (const value of body.txns) {
    const transaction = asRecord(value);
    if (transaction === null || !Array.isArray(transaction.actions)) continue;
    for (const value of transaction.actions) {
      const action = asRecord(value);
      if (action?.method !== "submit_verified_score" || typeof action.args !== "string") {
        continue;
      }
      try {
        const args = asRecord(JSON.parse(action.args));
        if (
          typeof args?.score === "number" &&
          Number.isInteger(args.score) &&
          args.score >= 0 &&
          args.score <= 1_000_000
        ) {
          return args.score;
        }
      } catch {
        continue;
      }
    }
  }
  return null;
};

const countTransactions = (
  transactions: readonly unknown[],
  seen: Set<string>,
  totals: { gamesStarted: number; verifiedScores: number; tournamentEntries: number },
): void => {
  for (const transaction of transactions) {
    for (const action of transactionMethods(transaction)) {
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
  readonly #cacheTtlMs: number;
  readonly #totalsCacheTtlMs: number;
  readonly #reader: ContractViewReader | undefined;
  #cache: { readonly expiresAt: number; readonly feed: ContractActivityFeed } | null =
    null;
  #totalsCache: {
    readonly expiresAt: number;
    readonly totals: ContractActivityTotals;
  } | null = null;

  constructor(config: ApiConfig, options: ActivityServiceOptions = {}) {
    this.#config = config;
    this.#fetcher = options.fetcher ?? fetch;
    this.#now = options.now ?? Date.now;
    this.#cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.#totalsCacheTtlMs =
      options.totalsCacheTtlMs ?? DEFAULT_TOTALS_CACHE_TTL_MS;
    this.#reader = options.reader;
  }

  async #fetchPage(cursor: string | null = null): Promise<IndexedTransactionPage> {
    const url = new URL(
      `/v1/account/${encodeURIComponent(this.#config.contractId)}/txns`,
      this.#config.indexerUrl,
    );
    url.searchParams.set("limit", "25");
    url.searchParams.set("order", "desc");
    if (cursor !== null) url.searchParams.set("cursor", cursor);
    const response = await this.#fetcher(url.toString(), {
      headers: {
        accept: "application/json",
        "user-agent": "Cloud-Hop/1.0",
      },
      signal: AbortSignal.timeout(4_500),
    });
    if (!response.ok) throw new Error(`NearBlocks returned ${response.status}.`);
    return parseTransactionPage(await response.json());
  }

  async #scoreFor(transactionHash: string): Promise<number | null> {
    try {
      const url = new URL(
        `/v1/txns/${encodeURIComponent(transactionHash)}`,
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

  async #getTotals(
    initialPage: IndexedTransactionPage,
  ): Promise<ContractActivityTotals> {
    const now = this.#now();
    if (this.#totalsCache !== null && this.#totalsCache.expiresAt > now) {
      return this.#totalsCache.totals;
    }

    const counts = { gamesStarted: 0, verifiedScores: 0, tournamentEntries: 0 };
    const seen = new Set<string>();
    const seenCursors = new Set<string>();
    countTransactions(initialPage.txns, seen, counts);
    let cursor = initialPage.cursor;
    let pages = 1;
    let scanFailed = false;
    while (
      cursor !== null &&
      pages < MAX_TOTAL_PAGES &&
      !seenCursors.has(cursor)
    ) {
      seenCursors.add(cursor);
      let page: IndexedTransactionPage;
      try {
        page = await this.#fetchPage(cursor);
      } catch {
        scanFailed = true;
        break;
      }
      countTransactions(page.txns, seen, counts);
      cursor = page.cursor;
      pages += 1;
      if (page.txns.length === 0) cursor = null;
    }

    const totals: ContractActivityTotals = {
      players: await this.#playerTotal(),
      ...counts,
      complete: cursor === null && !scanFailed,
    };
    this.#totalsCache = {
      expiresAt: now + this.#totalsCacheTtlMs,
      totals,
    };
    return totals;
  }

  async getFeed(): Promise<ContractActivityFeed> {
    const now = this.#now();
    if (this.#cache !== null && this.#cache.expiresAt > now) {
      return this.#cache.feed;
    }

    try {
      const page = await this.#fetchPage();
      const totals = await this.#getTotals(page);
      const rows = await this.#enrichScores(
        parseTransactions(page.txns, this.#config.explorerUrl),
      );
      const feed: ContractActivityFeed = {
        contractId: this.#config.contractId,
        updatedAt: new Date(now).toISOString(),
        stale: false,
        totals,
        rows,
      };
      this.#cache = { expiresAt: now + this.#cacheTtlMs, feed };
      return feed;
    } catch {
      if (this.#cache !== null) return { ...this.#cache.feed, stale: true };
      throw new ApiError(
        503,
        "ACTIVITY_UNAVAILABLE",
        "Live contract activity is temporarily unavailable.",
      );
    }
  }
}
