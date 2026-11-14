import type { Ruleset } from "./types.js";

/** All positions and velocities are integer millipixels. */
export const WORLD_SCALE = 1_000;

export const RULESET_V1 = Object.freeze({
  version: "cloud-hop-v1",
  tickRate: 60,
  worldWidth: 360 * WORLD_SCALE,
  worldHeight: 640 * WORLD_SCALE,
  groundHeight: 80 * WORLD_SCALE,
  birdX: 90 * WORLD_SCALE,
  birdStartY: 268 * WORLD_SCALE,
  birdWidth: 34 * WORLD_SCALE,
  birdHeight: 26 * WORLD_SCALE,
  gravity: 380,
  flapVelocity: -6_600,
  minVelocity: -7_500,
  maxVelocity: 8_500,
  obstacleWidth: 62 * WORLD_SCALE,
  obstacleGap: 170 * WORLD_SCALE,
  obstacleSpeed: 2_800,
  obstacleSpacing: 230 * WORLD_SCALE,
  firstObstacleX: 430 * WORLD_SCALE,
  minGapTop: 70 * WORLD_SCALE,
  maxGapTop: 320 * WORLD_SCALE,
  maxDurationTicks: 60 * 180,
  maxFlapInputs: 1_800,
  maxScore: 150,
} satisfies Ruleset);

export const toPixels = (value: number): number => value / WORLD_SCALE;
