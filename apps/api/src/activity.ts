import type { ApiConfig } from "./config.js";
import { ApiError } from "./errors.js";

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

type ActivityFetcher = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

interface ActivityServiceOptions {
  readonly fetcher?: ActivityFetcher;
  readonly now?: () => number;
  readonly cacheTtlMs?: number;
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
const MAX_ACTIVITY_ROWS = 12;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;

const parseTransactions = (
  value: unknown,
  explorerUrl: string,
): readonly ContractActivity[] => {
  const body = asRecord(value);
  if (body === null || !Array.isArray(body.txns)) {
    throw new Error("NearBlocks returned an invalid activity response.");
  }

  const rows: ContractActivity[] = [];
  const seen = new Set<string>();
  for (const value of body.txns) {
    const transaction = asRecord(value);
    const receiptOutcome = asRecord(transaction?.receipt_outcome);
    const playerId = transaction?.predecessor_account_id;
    const timestampNs = transaction?.block_timestamp;
    const transactionHash = transaction?.transaction_hash;
    if (
      transaction === null ||
      receiptOutcome?.status !== true ||
      typeof playerId !== "string" ||
      playerId.length < 2 ||
      playerId.length > 64 ||
      !ACCOUNT_ID_PATTERN.test(playerId) ||
      typeof timestampNs !== "string" ||
      !/^\d+$/.test(timestampNs) ||
      typeof transactionHash !== "string" ||
      !TRANSACTION_HASH_PATTERN.test(transactionHash) ||
      !Array.isArray(transaction.actions)
    ) {
      continue;
    }

    for (const value of transaction.actions) {
      const action = asRecord(value);
      const kind =
        typeof action?.method === "string"
          ? METHOD_KINDS.get(action.method)
          : undefined;
      if (kind === undefined) continue;
      const id = `${transactionHash}:${kind}`;
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push({
        id,
        kind,
        playerId,
        timestampNs,
        transactionHash,
        transactionExplorerUrl: `${explorerUrl}/txns/${transactionHash}`,
        playerExplorerUrl: `${explorerUrl}/address/${encodeURIComponent(playerId)}`,
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

export class ContractActivityService {
  readonly #config: Pick<
    ApiConfig,
    "contractId" | "explorerUrl" | "indexerUrl"
  >;
  readonly #fetcher: ActivityFetcher;
  readonly #now: () => number;
  readonly #cacheTtlMs: number;
  #cache: { readonly expiresAt: number; readonly feed: ContractActivityFeed } | null =
    null;

  constructor(config: ApiConfig, options: ActivityServiceOptions = {}) {
    this.#config = config;
    this.#fetcher = options.fetcher ?? fetch;
    this.#now = options.now ?? Date.now;
    this.#cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  }

  async getFeed(): Promise<ContractActivityFeed> {
    const now = this.#now();
    if (this.#cache !== null && this.#cache.expiresAt > now) {
      return this.#cache.feed;
    }

    try {
      const url = new URL(
        `/v1/account/${encodeURIComponent(this.#config.contractId)}/txns`,
        this.#config.indexerUrl,
      );
      url.searchParams.set("limit", "25");
      url.searchParams.set("order", "desc");
      const response = await this.#fetcher(url.toString(), {
        headers: {
          accept: "application/json",
          "user-agent": "Cloud-Hop/1.0",
        },
        signal: AbortSignal.timeout(4_500),
      });
      if (!response.ok) throw new Error(`NearBlocks returned ${response.status}.`);
      const feed: ContractActivityFeed = {
        contractId: this.#config.contractId,
        updatedAt: new Date(now).toISOString(),
        stale: false,
        rows: parseTransactions(await response.json(), this.#config.explorerUrl),
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
