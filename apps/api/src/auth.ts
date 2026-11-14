import {
  createPublicKey,
  verify,
  type JsonWebKey as NodeJsonWebKey,
} from "node:crypto";

import { ApiError } from "./errors.js";

interface JwtHeader {
  readonly alg?: unknown;
  readonly kid?: unknown;
}

interface JwtClaims {
  readonly aud?: unknown;
  readonly azp?: unknown;
  readonly exp?: unknown;
  readonly iat?: unknown;
  readonly iss?: unknown;
  readonly nbf?: unknown;
  readonly sub?: unknown;
}

type JsonWebKeyRecord = NodeJsonWebKey & { readonly kid?: string | undefined };

interface JwksResponse {
  readonly keys?: readonly JsonWebKeyRecord[];
}

const JWKS_CACHE_MS = 60 * 60 * 1_000;
const CLOCK_TOLERANCE_SECONDS = 60;

let cachedKeys: {
  readonly expiresAt: number;
  readonly keys: readonly JsonWebKeyRecord[];
} | null = null;

const invalidToken = (): ApiError =>
  new ApiError(
    401,
    "INVALID_GOOGLE_TOKEN",
    "Google sign-in proof is invalid or expired.",
  );

const decodeJson = <Value>(segment: string): Value => {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as Value;
  } catch {
    throw invalidToken();
  }
};

const readKeys = async (domain: string): Promise<readonly JsonWebKeyRecord[]> => {
  const now = Date.now();
  if (cachedKeys !== null && cachedKeys.expiresAt > now) return cachedKeys.keys;

  let response: Response;
  try {
    response = await fetch(`https://${domain}/.well-known/jwks.json`, {
      headers: { accept: "application/json" },
    });
  } catch {
    throw new ApiError(
      502,
      "AUTH_PROVIDER_UNAVAILABLE",
      "Google sign-in verification is temporarily unavailable.",
    );
  }

  if (!response.ok) {
    throw new ApiError(
      502,
      "AUTH_PROVIDER_UNAVAILABLE",
      "Google sign-in verification is temporarily unavailable.",
    );
  }

  const body = (await response.json()) as JwksResponse;
  if (!Array.isArray(body.keys) || body.keys.length === 0) {
    throw new ApiError(
      502,
      "AUTH_PROVIDER_INVALID_RESPONSE",
      "Google sign-in verification returned no signing keys.",
    );
  }

  cachedKeys = { expiresAt: now + JWKS_CACHE_MS, keys: body.keys };
  return body.keys;
};

const audienceIncludes = (audience: unknown, clientId: string): boolean =>
  audience === clientId ||
  (Array.isArray(audience) &&
    audience.every((item) => typeof item === "string") &&
    audience.includes(clientId));

export const verifyGoogleIdTokenWithKeys = async (
  token: string,
  keys: readonly JsonWebKeyRecord[],
  domain: string,
  clientId: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
): Promise<string> => {
  const segments = token.split(".");
  if (segments.length !== 3) throw invalidToken();

  const [encodedHeader, encodedClaims, encodedSignature] = segments;
  if (
    encodedHeader === undefined ||
    encodedClaims === undefined ||
    encodedSignature === undefined
  ) {
    throw invalidToken();
  }

  const header = decodeJson<JwtHeader>(encodedHeader);
  const claims = decodeJson<JwtClaims>(encodedClaims);
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    throw invalidToken();
  }

  const signingKey = keys.find((candidate) => candidate.kid === header.kid);
  if (signingKey === undefined) {
    throw invalidToken();
  }

  let signatureValid = false;
  try {
    signatureValid = verify(
      "RSA-SHA256",
      Buffer.from(`${encodedHeader}.${encodedClaims}`),
      createPublicKey({ key: signingKey, format: "jwk" }),
      Buffer.from(encodedSignature, "base64url"),
    );
  } catch {
    throw invalidToken();
  }
  if (!signatureValid) throw invalidToken();

  const issuer = `https://${domain}/`;
  if (
    claims.iss !== issuer ||
    !audienceIncludes(claims.aud, clientId) ||
    typeof claims.sub !== "string" ||
    typeof claims.exp !== "number" ||
    claims.exp < nowSeconds - CLOCK_TOLERANCE_SECONDS ||
    (typeof claims.nbf === "number" &&
      claims.nbf > nowSeconds + CLOCK_TOLERANCE_SECONDS) ||
    (typeof claims.iat === "number" &&
      claims.iat > nowSeconds + CLOCK_TOLERANCE_SECONDS) ||
    (Array.isArray(claims.aud) && claims.azp !== clientId)
  ) {
    throw invalidToken();
  }

  return claims.sub;
};

export const verifyGoogleIdToken = async (
  token: string,
  domain: string,
  clientId: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
): Promise<string> => {
  const keys = await readKeys(domain);
  try {
    return await verifyGoogleIdTokenWithKeys(
      token,
      keys,
      domain,
      clientId,
      nowSeconds,
    );
  } catch (error) {
    if (error instanceof ApiError && error.code === "INVALID_GOOGLE_TOKEN") {
      cachedKeys = null;
    }
    throw error;
  }
};
