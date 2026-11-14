const ZERO_SEED_FALLBACK = 0x9e37_79b9;

export const normalizeSeed = (seed: number): number => {
  const normalized = seed >>> 0;
  return normalized === 0 ? ZERO_SEED_FALLBACK : normalized;
};

/** A small deterministic PRNG suitable for obstacle layout, not key material. */
export const nextRandom = (state: number): number => {
  let value = normalizeSeed(state);
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
};

export const randomInteger = (
  state: number,
  minimum: number,
  maximum: number,
): { readonly state: number; readonly value: number } => {
  if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || maximum < minimum) {
    throw new RangeError("Random integer bounds must be ordered integers.");
  }

  const nextState = nextRandom(state);
  const range = maximum - minimum + 1;

  return {
    state: nextState,
    value: minimum + (nextState % range),
  };
};
