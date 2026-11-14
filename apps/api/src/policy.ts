import { createHash } from "node:crypto";

import { utils } from "near-api-js";

import { ApiError } from "./errors.js";

const GOOGLE_SUBJECT_PATTERN = /^google-oauth2\|[A-Za-z0-9._~-]{3,200}$/;

export interface GoogleWalletRequest {
  readonly userId: string;
  readonly idToken: string;
  readonly publicKey: string;
  readonly gasPublicKey: string;
}

export const parseNearAmount = (value: string): bigint => {
  if (!/^\d+(?:\.\d{1,24})?$/.test(value)) {
    throw new Error("NEAR amount must be a positive decimal with at most 24 places.");
  }

  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * 10n ** 24n + BigInt(fraction.padEnd(24, "0"));
};

export const validateGoogleWalletRequest = (
  candidate: unknown,
): GoogleWalletRequest => {
  if (typeof candidate !== "object" || candidate === null) {
    throw new ApiError(400, "INVALID_REQUEST", "Request body must be an object.");
  }

  const record = candidate as Record<string, unknown>;
  const userId = record.userId;
  const idToken = record.idToken;
  const publicKey = record.publicKey;
  const gasPublicKey = record.gasPublicKey;

  if (typeof userId !== "string" || !GOOGLE_SUBJECT_PATTERN.test(userId)) {
    throw new ApiError(
      400,
      "GOOGLE_ID_REQUIRED",
      "A Google-authenticated NEAR Auth identity is required.",
    );
  }

  if (
    typeof idToken !== "string" ||
    idToken.length < 100 ||
    idToken.length > 16_384 ||
    idToken.split(".").length !== 3
  ) {
    throw new ApiError(
      400,
      "GOOGLE_TOKEN_REQUIRED",
      "A Google ID token is required.",
    );
  }

  for (const [label, value] of [
    ["FastAuth public key", publicKey],
    ["scoped gas public key", gasPublicKey],
  ] as const) {
    if (typeof value !== "string" || !value.startsWith("ed25519:")) {
      throw new ApiError(400, "INVALID_PUBLIC_KEY", `${label} must be an ed25519 key.`);
    }
    try {
      utils.PublicKey.fromString(value);
    } catch {
      throw new ApiError(400, "INVALID_PUBLIC_KEY", `${label} is malformed.`);
    }
  }

  if (publicKey === gasPublicKey) {
    throw new ApiError(
      400,
      "KEYS_MUST_DIFFER",
      "The FastAuth and scoped gas keys must be different.",
    );
  }

  return {
    userId,
    idToken,
    publicKey: publicKey as string,
    gasPublicKey: gasPublicKey as string,
  };
};

export const derivePlayerAccountId = (
  fastAuthPublicKey: string,
  sponsorAccountId: string,
): string => {
  const availableLabelLength = 64 - sponsorAccountId.length - 1;
  if (availableLabelLength < 18) {
    throw new Error("Sponsor account id is too long for safe player subaccounts.");
  }

  const digest = createHash("sha256").update(fastAuthPublicKey).digest("hex");
  const label = `g-${digest.slice(0, availableLabelLength - 2)}`;
  return `${label}.${sponsorAccountId}`;
};

export const fastAuthPathForGoogleUser = (
  userId: string,
  domain: string,
): string => `jwt#https://${domain}/#${userId}`;

export const isUnknownAccountError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error));
  return /UNKNOWN_ACCOUNT|AccountDoesNotExist|account\s+[^\s]+\s+(?:does not|doesn't) exist/i.test(
    `${error.message} ${serialized}`,
  );
};

export class DailyRateLimiter {
  readonly #entries = new Map<string, number[]>();

  constructor(
    readonly perKeyLimit: number,
    readonly globalLimit: number,
    readonly windowMs = 86_400_000,
  ) {}

  consume(key: string, now = Date.now()): void {
    const cutoff = now - this.windowMs;
    let globalCount = 0;

    for (const [entryKey, timestamps] of this.#entries) {
      const current = timestamps.filter((timestamp) => timestamp > cutoff);
      if (current.length === 0) this.#entries.delete(entryKey);
      else this.#entries.set(entryKey, current);
      globalCount += current.length;
    }

    const keyEntries = this.#entries.get(key) ?? [];
    if (keyEntries.length >= this.perKeyLimit) {
      throw new ApiError(429, "SPONSOR_RATE_LIMITED", "Account creation limit reached.");
    }
    if (globalCount >= this.globalLimit) {
      throw new ApiError(503, "SPONSOR_DAILY_LIMIT", "Daily sponsor limit reached.");
    }

    this.#entries.set(key, [...keyEntries, now]);
  }
}
