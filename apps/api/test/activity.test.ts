import assert from "node:assert/strict";
import test from "node:test";

import { ContractActivityService } from "../src/activity.js";
import { config } from "../src/config.js";
import type { ContractViewReader } from "../src/read-model.js";

class FakeReader implements ContractViewReader {
  async view<Value>(): Promise<Value> {
    return { total: 1 } as Value;
  }
}

const receipt = (
  hash: string,
  playerId: string,
  timestampNs: string,
  methods: readonly string[],
  options: { readonly receiverId?: string; readonly status?: boolean } = {},
) => ({
  transaction_hash: hash,
  predecessor_account_id: playerId,
  receiver_account_id: options.receiverId ?? config.contractId,
  block: { block_timestamp: timestampNs },
  outcome: { status: options.status ?? true },
  actions: methods.map((method) => ({ action: "FUNCTION_CALL", method })),
});

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const nextTurn = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

test("contract activity maps successful arcade calls to explorer proofs", async () => {
  let fetchCalls = 0;
  const service = new ContractActivityService(
    {
      ...config,
      contractId: "arcade.testnet",
      explorerUrl: "https://explorer.testnet",
      indexerUrl: "https://indexer.testnet",
    },
    {
      now: () => Date.parse("2026-11-15T00:00:00.000Z"),
      reader: new FakeReader(),
      fetcher: async (input) => {
        fetchCalls += 1;
        const url = new URL(input);
        if (url.pathname.startsWith("/v3/txns/")) {
          return new Response(
            JSON.stringify({
              data: {
                actions: [
                  {
                    method: "submit_verified_score",
                    args: { args_json: { score: 24 } },
                  },
                ],
              },
            }),
          );
        }
        assert.equal(url.pathname, "/v3/accounts/arcade.testnet/receipts");
        assert.equal(url.searchParams.has("receiver"), false);
        assert.equal(url.searchParams.get("limit"), "25");
        assert.equal(url.searchParams.has("per_page"), false);
        const method = url.searchParams.get("method");
        if (method === "create_session") {
          return new Response(
            JSON.stringify({
              data: [
                receipt(
                  "34gejQAsvjaC89LoDHsRHmz5HYqTW4EM2TR5pfb9F9aj",
                  "pilot.testnet",
                  "100",
                  ["create_session"],
                  { receiverId: "arcade.testnet" },
                ),
                receipt(
                  "EmcFpSV4n9MmdSzeKPGybqMGsByGezT6K3ZCEhpQ9ZdN",
                  "arcade.testnet",
                  "80",
                  ["create_session"],
                  { receiverId: "elsewhere.testnet" },
                ),
              ],
            }),
          );
        }
        if (method === "submit_verified_score") {
          return new Response(
            JSON.stringify({
              data: [
                receipt(
                  "H9mtqiSp71gaUeKstoNTE8MscuzRTW1wcaYzyckcKz25",
                  "pilot.testnet",
                  "200",
                  ["submit_verified_score"],
                  { receiverId: "arcade.testnet" },
                ),
              ],
            }),
          );
        }
        if (method === "join_tournament") {
          assert.equal(url.searchParams.has("next"), false);
          return new Response(
            JSON.stringify({
              data: [
                receipt(
                  "5uVP8RJDQkNYVnujkFtAYTHUhgkgDVBBKe4ANzmoytQR",
                  "pilot.testnet",
                  "90",
                  ["join_tournament"],
                  { receiverId: "arcade.testnet" },
                ),
              ],
            }),
          );
        }
        assert.equal(method, null);
        return new Response(
          JSON.stringify({
            data: [
              receipt(
                "H9mtqiSp71gaUeKstoNTE8MscuzRTW1wcaYzyckcKz25",
                "pilot.testnet",
                "200",
                ["submit_verified_score"],
                { receiverId: "arcade.testnet" },
              ),
              receipt(
                "34gejQAsvjaC89LoDHsRHmz5HYqTW4EM2TR5pfb9F9aj",
                "pilot.testnet",
                "100",
                ["abandon_session", "create_session"],
                { receiverId: "arcade.testnet" },
              ),
              receipt(
                "5uVP8RJDQkNYVnujkFtAYTHUhgkgDVBBKe4ANzmoytQR",
                "pilot.testnet",
                "90",
                ["join_tournament"],
                { receiverId: "arcade.testnet", status: false },
              ),
              receipt(
                "EmcFpSV4n9MmdSzeKPGybqMGsByGezT6K3ZCEhpQ9ZdN",
                "arcade.testnet",
                "80",
                ["create_session"],
                { receiverId: "elsewhere.testnet" },
              ),
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    },
  );

  const feed = await service.getFeed();
  assert.equal(feed.stale, false);
  assert.deepEqual(
    feed.rows.map((row) => row.kind),
    ["score-recorded", "session-abandoned", "session-started"],
  );
  assert.equal(
    feed.rows[0]?.transactionExplorerUrl,
    "https://explorer.testnet/txns/H9mtqiSp71gaUeKstoNTE8MscuzRTW1wcaYzyckcKz25",
  );
  assert.equal(
    feed.rows[0]?.playerExplorerUrl,
    "https://explorer.testnet/address/pilot.testnet",
  );
  assert.equal(feed.rows[0]?.score, 24);
  assert.deepEqual(feed.totals, {
    players: 1,
    gamesStarted: 1,
    verifiedScores: 1,
    tournamentEntries: 1,
    complete: true,
  });

  await service.getFeed();
  assert.equal(fetchCalls, 5);
});

test("contract activity returns stale cached rows during an indexer outage", async () => {
  let now = 1_000;
  let available = true;
  const service = new ContractActivityService(config, {
    now: () => now,
    cacheTtlMs: 10,
    fetcher: async () => {
      if (!available) throw new Error("offline");
      return new Response(
        JSON.stringify({
          data: [
            receipt(
              "H9mtqiSp71gaUeKstoNTE8MscuzRTW1wcaYzyckcKz25",
              "pilot.testnet",
              "200",
              ["create_session"],
            ),
          ],
        }),
      );
    },
  });

  await service.getFeed();
  now += 11;
  available = false;
  assert.equal((await service.getFeed()).stale, true);
});

test("contract activity coalesces concurrent cold-cache refreshes", async () => {
  let fetchCalls = 0;
  const response = deferred<Response>();
  const service = new ContractActivityService(config, {
    fetcher: async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) return response.promise;
      return new Response(JSON.stringify({ data: [] }));
    },
  });

  const feeds = Array.from({ length: 40 }, () => service.getFeed());
  await nextTurn();
  assert.equal(fetchCalls, 1);

  response.resolve(
    new Response(
      JSON.stringify({
        data: [
          receipt(
            "H9mtqiSp71gaUeKstoNTE8MscuzRTW1wcaYzyckcKz25",
            "pilot.testnet",
            "200",
            ["create_session"],
          ),
        ],
      }),
    ),
  );
  const resolved = await Promise.all(feeds);
  assert.equal(fetchCalls, 4);
  assert.equal(resolved.every((feed) => feed.stale === false), true);
  assert.equal(resolved.every((feed) => feed.rows.length === 1), true);
});

test("contract activity serves stale data while one background refresh runs", async () => {
  let now = 1_000;
  let fetchCalls = 0;
  const refresh = deferred<Response>();
  const service = new ContractActivityService(config, {
    now: () => now,
    cacheTtlMs: 10,
    fetcher: async () => {
      fetchCalls += 1;
      if (fetchCalls <= 4) {
        return new Response(
          JSON.stringify({
            data: [
              receipt(
                "H9mtqiSp71gaUeKstoNTE8MscuzRTW1wcaYzyckcKz25",
                "first.testnet",
                "100",
                ["create_session"],
              ),
            ],
          }),
        );
      }
      return refresh.promise;
    },
  });

  const initial = await service.getFeed();
  assert.equal(initial.rows[0]?.playerId, "first.testnet");
  now += 11;

  const staleFeeds = await Promise.all(
    Array.from({ length: 40 }, () => service.getFeed()),
  );
  assert.equal(fetchCalls, 5);
  assert.equal(staleFeeds.every((feed) => feed.stale), true);
  assert.equal(
    staleFeeds.every((feed) => feed.rows[0]?.playerId === "first.testnet"),
    true,
  );

  refresh.resolve(
    new Response(
      JSON.stringify({
        data: [
          receipt(
            "34gejQAsvjaC89LoDHsRHmz5HYqTW4EM2TR5pfb9F9aj",
            "second.testnet",
            "200",
            ["create_session"],
          ),
        ],
      }),
    ),
  );
  await nextTurn();
  assert.equal((await service.getFeed()).rows[0]?.playerId, "second.testnet");
  assert.equal(fetchCalls, 5);
});

test("contract activity backs off repeated cold-cache failures", async () => {
  let now = 1_000;
  let fetchCalls = 0;
  const service = new ContractActivityService(config, {
    now: () => now,
    failureBackoffBaseMs: 100,
    failureBackoffMaxMs: 400,
    fetcher: async () => {
      fetchCalls += 1;
      throw new Error("offline");
    },
  });

  await assert.rejects(service.getFeed(), {
    statusCode: 503,
    code: "ACTIVITY_UNAVAILABLE",
  });
  assert.equal(fetchCalls, 1);

  const blocked = await Promise.allSettled(
    Array.from({ length: 20 }, () => service.getFeed()),
  );
  assert.equal(blocked.every((result) => result.status === "rejected"), true);
  assert.equal(fetchCalls, 1);

  now += 100;
  await assert.rejects(service.getFeed(), {
    statusCode: 503,
    code: "ACTIVITY_UNAVAILABLE",
  });
  assert.equal(fetchCalls, 2);
});

test("contract activity retries a throttled indexer request", async () => {
  let fetchCalls = 0;
  const waits: number[] = [];
  const service = new ContractActivityService(config, {
    wait: async (delayMs) => {
      waits.push(delayMs);
    },
    fetcher: async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        return new Response(null, {
          status: 429,
          headers: { "retry-after": "0" },
        });
      }
      return new Response(
        JSON.stringify({
          data: [
            receipt(
              "H9mtqiSp71gaUeKstoNTE8MscuzRTW1wcaYzyckcKz25",
              "pilot.testnet",
              "200",
              ["create_session"],
            ),
          ],
        }),
      );
    },
  });

  const feed = await service.getFeed();
  assert.equal(feed.rows.length, 1);
  assert.equal(fetchCalls, 5);
  assert.deepEqual(waits, [0]);
});

test("contract activity bounds repeated indexer throttling", async () => {
  let fetchCalls = 0;
  const waits: number[] = [];
  const service = new ContractActivityService(config, {
    wait: async (delayMs) => {
      waits.push(delayMs);
    },
    fetcher: async () => {
      fetchCalls += 1;
      return new Response(null, { status: 429 });
    },
  });

  await assert.rejects(service.getFeed(), {
    statusCode: 503,
    code: "ACTIVITY_UNAVAILABLE",
  });
  assert.equal(fetchCalls, 7);
  assert.deepEqual(waits, [1_000, 2_000, 4_000, 8_000, 16_000, 30_000]);
});

test("contract activity serves fixed lower-bound totals without a history scan", async () => {
  let fetchCalls = 0;
  const fixedTotals = {
    players: 100,
    gamesStarted: 1_255,
    verifiedScores: 806,
    tournamentEntries: 131,
    complete: false,
  } as const;
  const service = new ContractActivityService(config, {
    fixedTotals,
    indexerMaxAttempts: 2,
    fetcher: async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ data: [] }));
    },
  });

  const feed = await service.getFeed();
  assert.deepEqual(feed.totals, fixedTotals);
  assert.equal(fetchCalls, 1);
});

test("contract activity never replaces totals with a smaller scan", async () => {
  let now = 1_000;
  let generation = 0;
  const service = new ContractActivityService(config, {
    now: () => now,
    cacheTtlMs: 10,
    totalsCacheTtlMs: 10,
    reader: new FakeReader(),
    fetcher: async (input) => {
      if (new URL(input).searchParams.get("method") === null) generation += 1;
      return new Response(
        JSON.stringify({
          data:
            generation === 1
              ? [
                  receipt(
                    "H9mtqiSp71gaUeKstoNTE8MscuzRTW1wcaYzyckcKz25",
                    "first.testnet",
                    "200",
                    ["create_session", "join_tournament"],
                  ),
                ]
              : [
                  receipt(
                    "34gejQAsvjaC89LoDHsRHmz5HYqTW4EM2TR5pfb9F9aj",
                    "second.testnet",
                    "300",
                    ["create_session"],
                  ),
                ],
        }),
      );
    },
  });

  const initial = await service.getFeed();
  assert.deepEqual(initial.totals, {
    players: 1,
    gamesStarted: 1,
    verifiedScores: 0,
    tournamentEntries: 1,
    complete: true,
  });

  now += 11;
  assert.equal((await service.getFeed()).stale, true);
  await nextTurn();
  const refreshed = await service.getFeed();
  assert.equal(refreshed.stale, false);
  assert.deepEqual(refreshed.totals, initial.totals);
});

test("contract activity rejects a cold partial history scan", async () => {
  let fetchCalls = 0;
  const service = new ContractActivityService(config, {
    fetcher: async (input) => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        return new Response(
          JSON.stringify({
            data: [
              receipt(
                "H9mtqiSp71gaUeKstoNTE8MscuzRTW1wcaYzyckcKz25",
                "pilot.testnet",
                "200",
                ["create_session"],
              ),
            ],
          }),
        );
      }
      const url = new URL(input);
      assert.equal(url.searchParams.get("method"), "create_session");
      if (fetchCalls === 2) {
        return new Response(
          JSON.stringify({
            data: [
              receipt(
                "H9mtqiSp71gaUeKstoNTE8MscuzRTW1wcaYzyckcKz25",
                "pilot.testnet",
                "200",
                ["create_session"],
              ),
            ],
            meta: { next_page: "older" },
          }),
        );
      }
      assert.equal(url.searchParams.get("next"), "older");
      throw new Error("rate limited");
    },
  });

  await assert.rejects(service.getFeed(), {
    statusCode: 503,
    code: "ACTIVITY_UNAVAILABLE",
  });
  assert.equal(fetchCalls, 3);
});
