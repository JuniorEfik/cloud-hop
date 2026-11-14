import { RULESET_V1 } from "./ruleset.js";
import { createInitialState, stepGame } from "./simulation.js";
import type {
  GameReplay,
  ReplayValidation,
  ReplayVerification,
} from "./types.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const createReplay = (
  seed: number,
  durationTicks: number,
  flapTicks: readonly number[],
): GameReplay => ({
  formatVersion: 1,
  rulesetVersion: RULESET_V1.version,
  seed: seed >>> 0,
  durationTicks,
  flapTicks: [...flapTicks],
});

export const validateReplay = (candidate: unknown): ReplayValidation => {
  const errors: string[] = [];

  if (!isRecord(candidate)) {
    return { valid: false, errors: ["Replay must be an object."] };
  }

  if (candidate.formatVersion !== 1) {
    errors.push("Unsupported replay format version.");
  }

  if (candidate.rulesetVersion !== RULESET_V1.version) {
    errors.push("Replay ruleset does not match the active ruleset.");
  }

  if (
    !Number.isInteger(candidate.seed) ||
    typeof candidate.seed !== "number" ||
    candidate.seed < 0 ||
    candidate.seed > 0xffff_ffff
  ) {
    errors.push("Replay seed must be an unsigned 32-bit integer.");
  }

  if (
    !Number.isInteger(candidate.durationTicks) ||
    typeof candidate.durationTicks !== "number" ||
    candidate.durationTicks < 1 ||
    candidate.durationTicks > RULESET_V1.maxDurationTicks
  ) {
    errors.push("Replay duration is outside the ruleset bounds.");
  }

  if (!Array.isArray(candidate.flapTicks)) {
    errors.push("Replay flap ticks must be an array.");
  } else {
    if (candidate.flapTicks.length > RULESET_V1.maxFlapInputs) {
      errors.push("Replay contains too many flap inputs.");
    }

    let previous = -1;
    for (const tick of candidate.flapTicks) {
      if (!Number.isInteger(tick) || typeof tick !== "number") {
        errors.push("Every flap tick must be an integer.");
        break;
      }
      if (tick <= previous) {
        errors.push("Flap ticks must be strictly increasing.");
        break;
      }
      if (
        typeof candidate.durationTicks === "number" &&
        tick >= candidate.durationTicks
      ) {
        errors.push("A flap input occurs after the replay duration.");
        break;
      }
      previous = tick;
    }
  }

  return { valid: errors.length === 0, errors };
};

export const serializeReplay = (replay: GameReplay): string =>
  JSON.stringify({
    formatVersion: replay.formatVersion,
    rulesetVersion: replay.rulesetVersion,
    seed: replay.seed,
    durationTicks: replay.durationTicks,
    flapTicks: replay.flapTicks,
  });

export const verifyCompletedReplay = (candidate: unknown): ReplayVerification => {
  const validation = validateReplay(candidate);

  if (!validation.valid || !isRecord(candidate)) {
    return {
      accepted: false,
      reason: validation.errors.join(" "),
      state: null,
    };
  }

  const replay = candidate as unknown as GameReplay;
  let state = createInitialState(replay.seed);
  let inputIndex = 0;

  for (let elapsed = 0; elapsed < replay.durationTicks; elapsed += 1) {
    if (state.status !== "running") {
      return {
        accepted: false,
        reason: "Replay continues after the run reached a terminal state.",
        state,
      };
    }

    const shouldFlap = replay.flapTicks[inputIndex] === state.tick;
    if (shouldFlap) {
      inputIndex += 1;
    }
    state = stepGame(state, shouldFlap);
  }

  if (state.status === "running") {
    return {
      accepted: false,
      reason: "Completed replay does not end in a terminal state.",
      state,
    };
  }

  if (state.score > RULESET_V1.maxScore) {
    return {
      accepted: false,
      reason: "Computed score exceeds the ruleset bound.",
      state,
    };
  }

  return { accepted: true, reason: null, state };
};
