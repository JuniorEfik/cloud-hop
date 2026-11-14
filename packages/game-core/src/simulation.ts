import { randomInteger } from "./rng.js";
import { RULESET_V1 } from "./ruleset.js";
import type { GameState, ObstacleState } from "./types.js";

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const spawnObstacle = (
  id: number,
  x: number,
  rngState: number,
): { readonly obstacle: ObstacleState; readonly rngState: number } => {
  const random = randomInteger(
    rngState,
    RULESET_V1.minGapTop,
    RULESET_V1.maxGapTop,
  );

  return {
    obstacle: {
      id,
      x,
      gapTop: random.value,
      passed: false,
    },
    rngState: random.state,
  };
};

export const createInitialState = (seed: number): GameState => {
  const normalizedSeed = seed >>> 0;
  const first = spawnObstacle(0, RULESET_V1.firstObstacleX, normalizedSeed);

  return {
    tick: 0,
    seed: normalizedSeed,
    rngState: first.rngState,
    birdY: RULESET_V1.birdStartY,
    birdVelocity: 0,
    score: 0,
    status: "running",
    nextObstacleId: 1,
    obstacles: [first.obstacle],
  };
};

const overlapsObstacle = (
  birdY: number,
  obstacle: ObstacleState,
): boolean => {
  const birdLeft = RULESET_V1.birdX - RULESET_V1.birdWidth / 2;
  const birdRight = RULESET_V1.birdX + RULESET_V1.birdWidth / 2;
  const birdTop = birdY - RULESET_V1.birdHeight / 2;
  const birdBottom = birdY + RULESET_V1.birdHeight / 2;
  const obstacleRight = obstacle.x + RULESET_V1.obstacleWidth;
  const gapBottom = obstacle.gapTop + RULESET_V1.obstacleGap;

  const overlapsHorizontally =
    birdRight > obstacle.x && birdLeft < obstacleRight;
  const hitsSolidSection = birdTop < obstacle.gapTop || birdBottom > gapBottom;

  return overlapsHorizontally && hitsSolidSection;
};

const hasCollision = (
  birdY: number,
  obstacles: readonly ObstacleState[],
): boolean => {
  const birdTop = birdY - RULESET_V1.birdHeight / 2;
  const birdBottom = birdY + RULESET_V1.birdHeight / 2;
  const floor = RULESET_V1.worldHeight - RULESET_V1.groundHeight;

  if (birdTop <= 0 || birdBottom >= floor) {
    return true;
  }

  return obstacles.some((obstacle) => overlapsObstacle(birdY, obstacle));
};

/**
 * Advance exactly one authoritative simulation tick.
 *
 * Update order is input, gravity, position, obstacle movement, scoring,
 * collision, obstacle lifecycle, then tick increment.
 */
export const stepGame = (state: GameState, flap: boolean): GameState => {
  if (state.status !== "running") {
    return state;
  }

  const inputVelocity = flap ? RULESET_V1.flapVelocity : state.birdVelocity;
  const birdVelocity = clamp(
    inputVelocity + RULESET_V1.gravity,
    RULESET_V1.minVelocity,
    RULESET_V1.maxVelocity,
  );
  const birdY = state.birdY + birdVelocity;

  let score = state.score;
  let obstacles = state.obstacles.map((obstacle): ObstacleState => {
    const movedX = obstacle.x - RULESET_V1.obstacleSpeed;
    const passed =
      obstacle.passed ||
      movedX + RULESET_V1.obstacleWidth <
        RULESET_V1.birdX - RULESET_V1.birdWidth / 2;

    if (!obstacle.passed && passed) {
      score += 1;
    }

    return {
      ...obstacle,
      x: movedX,
      passed,
    };
  });

  let rngState = state.rngState;
  let nextObstacleId = state.nextObstacleId;
  const lastObstacle = obstacles.at(-1);

  if (
    lastObstacle !== undefined &&
    lastObstacle.x <= RULESET_V1.worldWidth - RULESET_V1.obstacleSpacing
  ) {
    const spawned = spawnObstacle(
      nextObstacleId,
      lastObstacle.x + RULESET_V1.obstacleSpacing,
      rngState,
    );
    obstacles = [...obstacles, spawned.obstacle];
    rngState = spawned.rngState;
    nextObstacleId += 1;
  }

  obstacles = obstacles.filter(
    (obstacle) => obstacle.x + RULESET_V1.obstacleWidth >= 0,
  );

  const nextTick = state.tick + 1;
  let status: GameState["status"] = "running";

  if (hasCollision(birdY, obstacles)) {
    status = "collision";
  } else if (nextTick >= RULESET_V1.maxDurationTicks) {
    status = "timeout";
  }

  return {
    tick: nextTick,
    seed: state.seed,
    rngState,
    birdY,
    birdVelocity,
    score,
    status,
    nextObstacleId,
    obstacles,
  };
};
