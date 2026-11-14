export type GameStatus = "running" | "collision" | "timeout";

export interface Ruleset {
  readonly version: string;
  readonly tickRate: number;
  readonly worldWidth: number;
  readonly worldHeight: number;
  readonly groundHeight: number;
  readonly birdX: number;
  readonly birdStartY: number;
  readonly birdWidth: number;
  readonly birdHeight: number;
  readonly gravity: number;
  readonly flapVelocity: number;
  readonly minVelocity: number;
  readonly maxVelocity: number;
  readonly obstacleWidth: number;
  readonly obstacleGap: number;
  readonly obstacleSpeed: number;
  readonly obstacleSpacing: number;
  readonly firstObstacleX: number;
  readonly minGapTop: number;
  readonly maxGapTop: number;
  readonly maxDurationTicks: number;
  readonly maxFlapInputs: number;
  readonly maxScore: number;
}

export interface ObstacleState {
  readonly id: number;
  readonly x: number;
  readonly gapTop: number;
  readonly passed: boolean;
}

export interface GameState {
  readonly tick: number;
  readonly seed: number;
  readonly rngState: number;
  readonly birdY: number;
  readonly birdVelocity: number;
  readonly score: number;
  readonly status: GameStatus;
  readonly nextObstacleId: number;
  readonly obstacles: readonly ObstacleState[];
}

export interface GameReplay {
  readonly formatVersion: 1;
  readonly rulesetVersion: string;
  readonly seed: number;
  readonly durationTicks: number;
  readonly flapTicks: readonly number[];
}

export interface ReplayValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export interface ReplayVerification {
  readonly accepted: boolean;
  readonly reason: string | null;
  readonly state: GameState | null;
}

export interface ScoreAttestation {
  readonly networkId: string;
  readonly contractId: string;
  readonly playerId: string;
  readonly sessionId: string;
  readonly gameId: string;
  readonly rulesetVersion: string;
  readonly score: number;
  readonly replayHash: string;
  readonly expiresAtNs: string;
}
