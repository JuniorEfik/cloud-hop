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

const transaction = (
  hash: string,
  playerId: string,
  timestampNs: string,
  methods: readonly string[],
  status = true,
) => ({
  transaction_hash: hash,
  predecessor_account_id: playerId,
  block_timestamp: timestampNs,
  receipt_outcome: { status },
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
        if (url.pathname.startsWith("/v1/txns/")) {
          return new Response(
            JSON.stringify({
              txns: [
                {
                  actions: [
                    {
                      method: "submit_verified_score",
                      args: JSON.stringify({ score: 24 }),
                    },
                  ],
                },
              ],
            }),
          );
        }
        if (url.searchParams.get("cursor") === "older") {
          return new Response(
            JSON.stringify({
              txns: [
                transaction(
                  "5uVP8RJDQkNYVnujkFtAYTHUhgkgDVBBKe4ANzmoytQR",
                  "pilot.testnet",
                  "90",
                  ["join_tournament"],
                ),
              ],
            }),
          );
        }
        return new Response(
          JSON.stringify({
            cursor: "older",
            txns: [
              transaction(
                "H9mtqiSp71gaUeKstoNTE8MscuzRTW1wcaYzyckcKz25",
                "pilot.testnet",
                "200",
                ["submit_verified_score"],
              ),
              transaction(
                "34gejQAsvjaC89LoDHsRHmz5HYqTW4EM2TR5pfb9F9aj",
                "pilot.testnet",
                "100",
                ["abandon_session", "create_session"],
              ),
              transaction(
                "5uVP8RJDQkNYVnujkFtAYTHUhgkgDVBBKe4ANzmoytQR",
                "pilot.testnet",
                "90",
                ["join_tournament"],
                false,
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
  assert.equal(fetchCalls, 3);
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
          txns: [
            transaction(
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
      return response.promise;
    },
  });

  const feeds = Array.from({ length: 40 }, () => service.getFeed());
  await nextTurn();
  assert.equal(fetchCalls, 1);

  response.resolve(
    new Response(
      JSON.stringify({
        txns: [
          transaction(
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
  assert.equal(fetchCalls, 1);
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
      if (fetchCalls === 1) {
        return new Response(
          JSON.stringify({
            txns: [
              transaction(
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
  assert.equal(fetchCalls, 2);
  assert.equal(staleFeeds.every((feed) => feed.stale), true);
  assert.equal(
    staleFeeds.every((feed) => feed.rows[0]?.playerId === "first.testnet"),
    true,
  );

  refresh.resolve(
    new Response(
      JSON.stringify({
        txns: [
          transaction(
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
  assert.equal(fetchCalls, 2);
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
