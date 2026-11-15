import assert from "node:assert/strict";
import test from "node:test";

import { ContractActivityService } from "../src/activity.js";
import { config } from "../src/config.js";

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
      fetcher: async () => {
        fetchCalls += 1;
        return new Response(
          JSON.stringify({
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

  await service.getFeed();
  assert.equal(fetchCalls, 1);
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
