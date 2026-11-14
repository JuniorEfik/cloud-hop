import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  RULESET_V1,
  canonicalReplayBytes,
  createInitialState,
  createReplay,
  gameSeedFromChainSeed,
  serializeReplay,
  serializeRuleset,
  serializeScoreAttestation,
  stepGame,
  validateReplay,
  verifyCompletedReplay,
} from "../src/index.js";

const finishRun = (
  seed: number,
  shouldFlap: (tick: number) => boolean,
): { readonly durationTicks: number; readonly flapTicks: readonly number[] } => {
  let state = createInitialState(seed);
  const flapTicks: number[] = [];

  while (state.status === "running") {
    const flap = shouldFlap(state.tick);
    if (flap) {
      flapTicks.push(state.tick);
    }
    state = stepGame(state, flap);
  }

  return { durationTicks: state.tick, flapTicks };
};

test("the same seed and tick inputs produce the same terminal result", () => {
  const recorded = finishRun(0x1234_abcd, (tick) => tick > 0 && tick % 37 === 0);
  const replay = createReplay(
    0x1234_abcd,
    recorded.durationTicks,
    recorded.flapTicks,
  );

  const first = verifyCompletedReplay(replay);
  const second = verifyCompletedReplay(JSON.parse(serializeReplay(replay)));

  assert.equal(first.accepted, true);
  assert.deepEqual(second, first);
});

test("seeded obstacle generation is stable and seed-sensitive", () => {
  const first = createInitialState(42);
  const repeated = createInitialState(42);
  const different = createInitialState(43);

  assert.deepEqual(repeated, first);
  assert.notEqual(different.obstacles[0]?.gapTop, first.obstacles[0]?.gapTop);
});

test("ruleset v1 matches its locked no-input test vector", () => {
  let state = createInitialState(7);

  while (state.status === "running") {
    state = stepGame(state, false);
  }

  assert.deepEqual(
    {
      tick: state.tick,
      status: state.status,
      score: state.score,
      birdY: state.birdY,
      birdVelocity: state.birdVelocity,
      rngState: state.rngState,
      firstGapTop: state.obstacles[0]?.gapTop,
    },
    {
      tick: 44,
      status: "collision",
      score: 0,
      birdY: 551_140,
      birdVelocity: 8_500,
      rngState: 1_892_583,
      firstGapTop: 212_576,
    },
  );
});

test("a replay cannot stop before a terminal tick", () => {
  const recorded = finishRun(7, () => false);
  const shortened = createReplay(7, recorded.durationTicks - 1, []);
  const result = verifyCompletedReplay(shortened);

  assert.equal(result.accepted, false);
  assert.match(result.reason ?? "", /does not end/i);
});

test("a replay cannot continue after collision", () => {
  const recorded = finishRun(7, () => false);
  const extended = createReplay(7, recorded.durationTicks + 1, []);
  const result = verifyCompletedReplay(extended);

  assert.equal(result.accepted, false);
  assert.match(result.reason ?? "", /continues after/i);
});

test("replay inputs are bounded, ordered, unique, and in range", () => {
  const invalid = {
    formatVersion: 1,
    rulesetVersion: RULESET_V1.version,
    seed: 1,
    durationTicks: 10,
    flapTicks: [2, 2, 11],
  };
  const result = validateReplay(invalid);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /strictly increasing/i.test(error)));
});

test("the canonical serializer always emits fields in protocol order", () => {
  const replay = createReplay(5, 12, [1, 8]);

  assert.equal(
    serializeReplay(replay),
    '{"formatVersion":1,"rulesetVersion":"cloud-hop-v1","seed":5,"durationTicks":12,"flapTicks":[1,8]}',
  );
  assert.equal(
    createHash("sha256").update(canonicalReplayBytes(replay)).digest("hex"),
    "25b285627191baaee1146500ca8938bcf6a2f4227ab57aadf8248c790ebffbc1",
  );
});

test("chain seeds and score attestations have locked canonical encodings", () => {
  assert.equal(gameSeedFromChainSeed("12345678" + "0".repeat(56)), 0x12345678);
  assert.equal(gameSeedFromChainSeed("0".repeat(64)), 1);
  assert.throws(() => gameSeedFromChainSeed("not-a-seed"));

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
  assert.equal(
    createHash("sha256").update(serializeRuleset()).digest("hex"),
    "d5484f336a0f95a0e7b90705943f6511db29426f1621615be4cf7ed78f49e220",
  );
});
