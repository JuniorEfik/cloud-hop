import { Auth0Client, type IdToken } from "@auth0/auth0-spa-js";
import { transactions } from "near-api-js";
import type { Transaction } from "near-api-js/lib/transaction";

interface GoogleProviderOptions {
  readonly clientId: string;
  readonly domain: string;
  readonly signingAudience: string;
}

interface TransactionSignatureOptions {
  readonly transaction: Transaction;
}

interface DelegateSignatureOptions {
  readonly delegateAction: unknown;
}

interface TokenPayload {
  readonly fatxn?: unknown;
}

const decodeJwtPayload = (token: string): TokenPayload => {
  const payload = token.split(".")[1];
  if (payload === undefined) throw new Error("NEAR Auth returned an invalid token.");
  const normalized = payload.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  try {
    return JSON.parse(globalThis.atob(padded)) as TokenPayload;
  } catch {
    throw new Error("NEAR Auth returned an invalid token payload.");
  }
};

const userFromClaims = (claims: IdToken | undefined): { userId: string } => {
  if (typeof claims?.sub !== "string" || !claims.sub.startsWith("google-oauth2|")) {
    throw new Error("A Google account is required for wallet creation.");
  }
  return { userId: claims.sub };
};

export class GoogleFastAuthProvider {
  readonly #auth0: Auth0Client;
  readonly #domain: string;
  readonly #signingAudience: string;

  constructor(options: GoogleProviderOptions) {
    this.#domain = options.domain;
    this.#signingAudience = options.signingAudience;
    this.#auth0 = new Auth0Client({
      domain: options.domain,
      clientId: options.clientId,
      cacheLocation: "localstorage",
      authorizationParams: {
        connection: "google-oauth2",
      },
    });
  }

  async isLoggedIn(): Promise<boolean> {
    try {
      return await this.#auth0.isAuthenticated();
    } catch {
      return false;
    }
  }

  async login(_options?: unknown, forceSelectAccount = false): Promise<{ userId: string }> {
    await this.#auth0.loginWithPopup({
      authorizationParams: {
        connection: "google-oauth2",
        ...(forceSelectAccount ? { prompt: "select_account" as const } : {}),
      },
    });
    return userFromClaims(await this.#auth0.getIdTokenClaims());
  }

  async logout(): Promise<void> {
    await this.#auth0.logout({ openUrl: false });
  }

  async getPath(): Promise<string> {
    const user = userFromClaims(await this.#auth0.getIdTokenClaims());
    return `jwt#https://${this.#domain}/#${user.userId}`;
  }

  async getIdToken(): Promise<string> {
    const claims = await this.#auth0.getIdTokenClaims();
    userFromClaims(claims);
    if (typeof claims?.__raw !== "string") {
      throw new Error("Google sign-in proof is unavailable.");
    }
    return claims.__raw;
  }

  async requestTransactionSignature(
    options: TransactionSignatureOptions,
  ): Promise<{ userId: string }> {
    await this.#auth0.loginWithPopup({
      authorizationParams: {
        audience: this.#signingAudience,
        connection: "google-oauth2",
        scope: "openid profile email transaction:sign",
        transaction: Array.from(transactions.encodeTransaction(options.transaction)),
      },
    });
    return userFromClaims(await this.#auth0.getIdTokenClaims());
  }

  async requestDelegateActionSignature(
    options: DelegateSignatureOptions,
  ): Promise<{ userId: string }> {
    await this.#auth0.loginWithPopup({
      authorizationParams: {
        audience: this.#signingAudience,
        connection: "google-oauth2",
        scope: "openid profile email transaction:sign",
        delegateAction: Array.from(
          transactions.encodeDelegateAction(options.delegateAction as never),
        ),
      },
    });
    return userFromClaims(await this.#auth0.getIdTokenClaims());
  }

  async getSignatureRequest(): Promise<{
    user: { userId: string };
    signatureRequest: {
      guardId: string;
      verifyPayload: string;
      signPayload: Uint8Array;
    };
  }> {
    const token = await this.#auth0.getTokenSilently({
      authorizationParams: { audience: this.#signingAudience },
    });
    if (typeof token !== "string") {
      throw new Error("NEAR Auth did not return a signing token.");
    }
    const payload = decodeJwtPayload(token).fatxn;
    if (
      !Array.isArray(payload) ||
      !payload.every(
        (value) => Number.isInteger(value) && value >= 0 && value <= 255,
      )
    ) {
      throw new Error("NEAR Auth did not return a transaction signing payload.");
    }
    return {
      user: userFromClaims(await this.#auth0.getIdTokenClaims()),
      signatureRequest: {
        guardId: `jwt#https://${this.#domain}/`,
        verifyPayload: token,
        signPayload: Uint8Array.from(payload),
      },
    };
  }
}
