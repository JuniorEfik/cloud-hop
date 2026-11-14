import {
  connect,
  keyStores,
  KeyPair,
  transactions,
  utils,
  type Account,
  type Near,
} from "near-api-js";

import type { ApiConfig } from "./config.js";
import { verifyGoogleIdToken } from "./auth.js";
import { ApiError } from "./errors.js";
import {
  DailyRateLimiter,
  derivePlayerAccountId,
  fastAuthPathForGoogleUser,
  isUnknownAccountError,
  validateGoogleWalletRequest,
} from "./policy.js";

export interface SponsoredWalletResult {
  readonly accountId: string;
  readonly publicKey: string;
  readonly gasPublicKey: string;
  readonly created: boolean;
  readonly transactionHash: string | null;
  readonly explorerUrl: string | null;
}

type KeyPairString = `ed25519:${string}` | `secp256k1:${string}`;

interface CallFunctionResponse {
  readonly result: readonly number[];
}

export class SponsorService {
  readonly #limiter: DailyRateLimiter;
  readonly #inFlight = new Map<string, Promise<SponsoredWalletResult>>();
  #near: Near | null = null;
  #sponsor: Account | null = null;

  constructor(readonly configuration: ApiConfig) {
    this.#limiter = new DailyRateLimiter(
      configuration.sponsorPerIpDailyLimit,
      configuration.sponsorDailyLimit,
    );
  }

  async initialize(): Promise<void> {
    if (!this.configuration.sponsorConfigured) return;

    const keyStore = new keyStores.InMemoryKeyStore();
    const keyPair = KeyPair.fromString(
      this.configuration.sponsorPrivateKey as KeyPairString,
    );
    await keyStore.setKey(
      this.configuration.networkId,
      this.configuration.sponsorAccountId,
      keyPair,
    );
    this.#near = await connect({
      networkId: this.configuration.networkId,
      nodeUrl: this.configuration.rpcUrl,
      deps: { keyStore },
    });
    this.#sponsor = await this.#near.account(this.configuration.sponsorAccountId);
  }

  async createGoogleWallet(
    candidate: unknown,
    requesterKey: string,
  ): Promise<SponsoredWalletResult> {
    if (!this.configuration.sponsorConfigured || this.#near === null || this.#sponsor === null) {
      throw new ApiError(
        503,
        "SPONSOR_NOT_CONFIGURED",
        "The Testnet account-creation sponsor is not configured.",
      );
    }

    const request = validateGoogleWalletRequest(candidate);
    const verifiedUserId = await verifyGoogleIdToken(
      request.idToken,
      this.configuration.fastAuthDomain,
      this.configuration.fastAuthClientId,
    );
    if (verifiedUserId !== request.userId) {
      throw new ApiError(
        403,
        "GOOGLE_ID_MISMATCH",
        "Google sign-in proof does not match the requested identity.",
      );
    }
    const expectedPublicKey = await this.#deriveFastAuthPublicKey(request.userId);
    if (expectedPublicKey !== request.publicKey) {
      throw new ApiError(
        403,
        "FAST_AUTH_KEY_MISMATCH",
        "The public key does not match the Google identity derivation path.",
      );
    }

    const accountId = derivePlayerAccountId(
      request.publicKey,
      this.configuration.sponsorAccountId,
    );
    const existing = this.#inFlight.get(accountId);
    if (existing !== undefined) return existing;

    const operation = this.#createOrRead(
      accountId,
      request.publicKey,
      request.gasPublicKey,
      requesterKey,
    ).finally(() => this.#inFlight.delete(accountId));
    this.#inFlight.set(accountId, operation);
    return operation;
  }

  async #deriveFastAuthPublicKey(userId: string): Promise<string> {
    const path = fastAuthPathForGoogleUser(
      userId,
      this.configuration.fastAuthDomain,
    );
    const response = (await this.#near?.connection.provider.query({
      request_type: "call_function",
      finality: "final",
      account_id: this.configuration.mpcContractId,
      method_name: "derived_public_key",
      args_base64: Buffer.from(
        JSON.stringify({
          path,
          predecessor: this.configuration.fastAuthContractId,
          domain_id: 1,
        }),
      ).toString("base64"),
    })) as CallFunctionResponse | undefined;
    const derived =
      response === undefined
        ? undefined
        : JSON.parse(Buffer.from(response.result).toString("utf8"));
    if (typeof derived !== "string" || !derived.startsWith("ed25519:")) {
      throw new ApiError(
        502,
        "MPC_KEY_DERIVATION_FAILED",
        "NEAR MPC did not return an ed25519 public key.",
      );
    }
    return derived;
  }

  async #createOrRead(
    accountId: string,
    publicKey: string,
    gasPublicKey: string,
    requesterKey: string,
  ): Promise<SponsoredWalletResult> {
    const provider = this.#near?.connection.provider;
    if (provider === undefined || this.#sponsor === null) {
      throw new ApiError(503, "SPONSOR_NOT_READY", "Sponsor service is not ready.");
    }

    let accountExists = true;
    try {
      await provider.query({
        request_type: "view_account",
        finality: "final",
        account_id: accountId,
      });
    } catch (error) {
      if (!isUnknownAccountError(error)) throw error;
      accountExists = false;
    }

    if (accountExists) {
      try {
        await Promise.all([
          provider.query({
            request_type: "view_access_key",
            finality: "final",
            account_id: accountId,
            public_key: publicKey,
          }),
          provider.query({
            request_type: "view_access_key",
            finality: "final",
            account_id: accountId,
            public_key: gasPublicKey,
          }),
        ]);
        return {
          accountId,
          publicKey,
          gasPublicKey,
          created: false,
          transactionHash: null,
          explorerUrl: `${this.configuration.explorerUrl}/address/${accountId}`,
        };
      } catch {
        throw new ApiError(
          409,
          "ACCOUNT_KEY_MISMATCH",
          "The player account exists but does not contain the expected device keys.",
        );
      }
    }

    this.#limiter.consume(requesterKey);
    const outcome = await this.#sponsor.signAndSendTransaction({
      receiverId: accountId,
      actions: [
        transactions.createAccount(),
        transactions.transfer(this.configuration.sponsorInitialBalance),
        transactions.addKey(
          utils.PublicKey.fromString(publicKey),
          transactions.fullAccessKey(),
        ),
        transactions.addKey(
          utils.PublicKey.fromString(gasPublicKey),
          transactions.functionCallAccessKey(
            this.configuration.fastAuthContractId,
            ["sign"],
            this.configuration.sponsorGasKeyAllowance,
          ),
        ),
      ],
    });
    const transactionHash = outcome.transaction.hash;

    return {
      accountId,
      publicKey,
      gasPublicKey,
      created: true,
      transactionHash,
      explorerUrl: `${this.configuration.explorerUrl}/txns/${transactionHash}`,
    };
  }
}
