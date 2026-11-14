import { FastAuthClient, FastAuthSignature } from "@fast-auth-near/browser-sdk";
import type { GameReplay } from "@near-arcade/game-core";
import {
  NearConnector,
  type NearWalletBase,
} from "@hot-labs/near-connect";
import {
  connect,
  keyStores,
  KeyPair,
  transactions,
  type Near,
} from "near-api-js";

import { GoogleFastAuthProvider } from "./google-provider.js";
import {
  WalletConnectionAttemptReplacedError,
  WalletConnectionManager,
  type WalletRecoveryResult,
} from "./wallet-connection-manager.js";
import {
  GAME_ID,
  RULESET_VERSION,
  SCORE_SUBMISSION_GAS,
  SESSION_DEPOSIT_YOCTO,
  SESSION_GAS,
  TOURNAMENT_GAS,
  deriveGoogleAccountId,
  errorMessage,
  isMissingAccessKeyError,
  normalizeNearPublicKey,
  parseVerifiedReplayResponse,
  scoreRecordFromOutcome,
  sessionFromOutcome,
  successValueFromOutcome,
  tournamentEntryFromOutcome,
  transactionHashFromOutcome,
  type ChainSession,
  type ScoreSubmissionResult,
  type SessionStartResult,
  type TournamentJoinResult,
} from "./near-utils.js";

export interface ArcadeConfiguration {
  readonly networkId: "testnet";
  readonly rpcUrl: string;
  readonly explorerUrl: string;
  readonly contractId: string;
  readonly fastAuthClientId: string;
  readonly fastAuthContractId: string;
  readonly mpcContractId: string;
  readonly sponsorConfigured: boolean;
  readonly relayerConfigured: boolean;
  readonly verifierConfigured: boolean;
  readonly googleAccountParent: string;
}

export interface ConnectedIdentity {
  readonly accountId: string;
  readonly method: "wallet" | "google";
  readonly explorerUrl: string;
}

interface GoogleWalletMetadata {
  readonly userId: string;
  readonly accountId: string;
  readonly publicKey: string;
  readonly gasPublicKey: string;
}

interface AccessKeyResponse {
  readonly nonce: number | bigint;
}

interface BlockResponse {
  readonly header: { readonly height: number };
}

interface CallFunctionResponse {
  readonly result: readonly number[];
}

interface SponsoredWalletResponse extends GoogleWalletMetadata {
  readonly created: boolean;
  readonly transactionHash: string | null;
  readonly explorerUrl: string | null;
}

interface WalletFunctionCallAction {
  readonly type: "FunctionCall";
  readonly params: {
    readonly methodName: string;
    readonly args: object;
    readonly gas: string;
    readonly deposit: string;
  };
}

const GOOGLE_WALLET_STORAGE = "near-arcade:google-wallet:v1";
const AUTH_METHOD_STORAGE = "near-arcade:auth-method:v1";
const WALLET_AUTHORIZATION_STORAGE = "near-arcade:wallet-authorization:v3";
const DEVICE_KEY_PREFIX = "near-arcade:device-key:";
const FAST_AUTH_DOMAIN = "login.testnet.fast-auth.com";
const FAST_AUTH_SIGNING_AUDIENCE = "auth0.jwt.fast-auth.testnet";
const SUPPORTED_WALLET_ID = "meteor-wallet";
const WALLET_KEY_POLL_ATTEMPTS = 12;
const WALLET_KEY_POLL_INTERVAL_MS = 500;
const STALE_WALLET_ACCESS_KEY_MESSAGE =
  "This wallet's saved Testnet access key is no longer active. The stale connection was cleared. Connect the wallet again, or choose another Testnet wallet if it repeats.";

const apiBaseUrl = __PUBLIC_API_BASE_URL__.replace(/\/$/, "");
const wait = (durationMs: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, durationMs));

const parseConfiguration = (candidate: unknown): ArcadeConfiguration => {
  if (typeof candidate !== "object" || candidate === null) {
    throw new Error("The arcade API returned an invalid configuration.");
  }
  const record = candidate as Record<string, unknown>;
  if (
    record.networkId !== "testnet" ||
    typeof record.rpcUrl !== "string" ||
    typeof record.explorerUrl !== "string" ||
    typeof record.contractId !== "string" ||
    typeof record.fastAuthClientId !== "string" ||
    typeof record.fastAuthContractId !== "string" ||
    typeof record.mpcContractId !== "string" ||
    typeof record.sponsorConfigured !== "boolean" ||
    typeof record.relayerConfigured !== "boolean" ||
    typeof record.verifierConfigured !== "boolean" ||
    typeof record.googleAccountParent !== "string"
  ) {
    throw new Error("The arcade API configuration is incomplete.");
  }
  return record as unknown as ArcadeConfiguration;
};

const readApiError = async (response: Response): Promise<Error> => {
  try {
    const body = (await response.json()) as {
      error?: { code?: unknown; message?: unknown };
    };
    const code = typeof body.error?.code === "string" ? body.error.code : "API_ERROR";
    const message =
      typeof body.error?.message === "string"
        ? body.error.message
        : `The arcade API returned ${response.status}.`;
    if (code === "ACCOUNT_KEY_MISMATCH") {
      return new Error(
        "This Google wallet already exists, but this browser is not enrolled. Use the original device while recovery support is being finalized.",
      );
    }
    return new Error(message);
  } catch {
    return new Error(`The arcade API returned ${response.status}.`);
  }
};

const encodeArgs = (args: object): string => {
  const bytes = new TextEncoder().encode(JSON.stringify(args));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
};

const encodeBytes = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
};

const parseStoredGoogleWallet = (): GoogleWalletMetadata | null => {
  const stored = localStorage.getItem(GOOGLE_WALLET_STORAGE);
  if (stored === null) return null;
  try {
    const value = JSON.parse(stored) as Partial<GoogleWalletMetadata>;
    if (
      typeof value.userId === "string" &&
      typeof value.accountId === "string" &&
      typeof value.publicKey === "string" &&
      typeof value.gasPublicKey === "string"
    ) {
      return value as GoogleWalletMetadata;
    }
  } catch {
    // Ignore malformed local state and require a fresh sign-in.
  }
  return null;
};

export const loadArcadeConfiguration = async (): Promise<ArcadeConfiguration> => {
  const response = await fetch(`${apiBaseUrl}/api/v1/game/config`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw await readApiError(response);
  return parseConfiguration(await response.json());
};

export class NearArcadeClient {
  readonly configuration: ArcadeConfiguration;
  readonly #keyStore: keyStores.BrowserLocalStorageKeyStore;
  readonly #listeners = new Set<(identity: ConnectedIdentity | null) => void>();
  readonly #connector: NearConnector;
  readonly #walletConnections: WalletConnectionManager;
  readonly #near: Near;
  readonly #googleProvider: GoogleFastAuthProvider;
  readonly #fastAuth: FastAuthClient<GoogleFastAuthProvider>;

  #identity: ConnectedIdentity | null = null;
  #wallet: NearWalletBase | null = null;
  #walletPublicKey: string | null = null;
  #verifiedWalletPublicKey: string | null = null;
  #googleSigner: Awaited<ReturnType<FastAuthClient<GoogleFastAuthProvider>["getSigner"]>> | null =
    null;

  private constructor(
    configuration: ArcadeConfiguration,
    near: Near,
    keyStore: keyStores.BrowserLocalStorageKeyStore,
    connector: NearConnector,
    googleProvider: GoogleFastAuthProvider,
    fastAuth: FastAuthClient<GoogleFastAuthProvider>,
  ) {
    this.configuration = configuration;
    this.#near = near;
    this.#keyStore = keyStore;
    this.#connector = connector;
    this.#walletConnections = new WalletConnectionManager({
      connector,
      storage: localStorage,
      dismissConnectorUi: () => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      },
    });
    this.#googleProvider = googleProvider;
    this.#fastAuth = fastAuth;
    connector.on("wallet:signOut", () => {
      if (this.#identity?.method === "wallet") this.#setIdentity(null);
      localStorage.removeItem(WALLET_AUTHORIZATION_STORAGE);
      this.#wallet = null;
      this.#walletPublicKey = null;
      this.#verifiedWalletPublicKey = null;
    });
  }

  static async create(configuration: ArcadeConfiguration): Promise<NearArcadeClient> {
    const keyStore = new keyStores.BrowserLocalStorageKeyStore(
      localStorage,
      DEVICE_KEY_PREFIX,
    );
    const near = await connect({
      networkId: configuration.networkId,
      nodeUrl: configuration.rpcUrl,
      deps: { keyStore },
    });
    const applicationScript = document.querySelector<HTMLScriptElement>(
      'script[type="module"][src="/app.js"]',
    );
    const cspNonce = applicationScript?.nonce;
    if (!cspNonce) {
      throw new Error("The wallet connector CSP nonce is unavailable.");
    }
    const connector = new NearConnector({
      network: configuration.networkId,
      providers: { testnet: [configuration.rpcUrl] },
      autoConnect: false,
      cspNonce,
      footerBranding: null,
    });
    const retainSupportedWallet = (): void => {
      connector.wallets = connector.wallets.filter(
        (wallet) => wallet.manifest.id === SUPPORTED_WALLET_ID,
      );
    };
    connector.on("selector:walletsChanged", retainSupportedWallet);
    await connector.whenManifestLoaded;
    retainSupportedWallet();
    if (connector.wallets.length === 0) {
      throw new Error("The Meteor wallet integration is currently unavailable.");
    }
    const googleProvider = new GoogleFastAuthProvider({
      clientId: configuration.fastAuthClientId,
      domain: FAST_AUTH_DOMAIN,
      signingAudience: FAST_AUTH_SIGNING_AUDIENCE,
    });
    const fastAuth = new FastAuthClient(googleProvider, near.connection, {
      fastAuthContractId: configuration.fastAuthContractId,
      mpcContractId: configuration.mpcContractId,
    });
    const client = new NearArcadeClient(
      configuration,
      near,
      keyStore,
      connector,
      googleProvider,
      fastAuth,
    );
    await client.#restore();
    return client;
  }

  get identity(): ConnectedIdentity | null {
    return this.#identity;
  }

  onIdentityChanged(listener: (identity: ConnectedIdentity | null) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#identity);
    return () => this.#listeners.delete(listener);
  }

  async resetWalletConnection(): Promise<WalletRecoveryResult> {
    const recovery = await this.#walletConnections.cancel();
    localStorage.removeItem(WALLET_AUTHORIZATION_STORAGE);
    this.#wallet = null;
    this.#walletPublicKey = null;
    this.#verifiedWalletPublicKey = null;
    return recovery;
  }

  async connectWallet(): Promise<ConnectedIdentity> {
    try {
      const connection = await this.#walletConnections.connect();
      const { wallet, accounts } = connection;
      const account = accounts[0];
      if (account === undefined) throw new Error("The wallet returned no NEAR account.");
      this.#wallet = wallet;
      this.#walletPublicKey = account.publicKey ?? this.#walletPublicKey;
      await this.#confirmWalletAccessKey(wallet, account.accountId, true);
      this.#walletConnections.assertActive(connection);
      const identity: ConnectedIdentity = {
        accountId: account.accountId,
        method: "wallet",
        explorerUrl: `${this.configuration.explorerUrl}/address/${account.accountId}`,
      };
      localStorage.setItem(WALLET_AUTHORIZATION_STORAGE, account.accountId);
      this.#setIdentity(identity);
      return identity;
    } catch (error) {
      if (!(error instanceof WalletConnectionAttemptReplacedError)) {
        this.#wallet = null;
        this.#walletPublicKey = null;
        this.#verifiedWalletPublicKey = null;
      }
      throw error;
    }
  }

  async connectGoogle(): Promise<ConnectedIdentity> {
    if (
      !this.configuration.sponsorConfigured ||
      this.configuration.googleAccountParent.length === 0
    ) {
      throw new Error("Google wallet creation is not configured on this deployment.");
    }

    const user = await this.#googleProvider.login(undefined, true);
    const idToken = await this.#googleProvider.getIdToken();
    const signer = await this.#fastAuth.getSigner();
    const publicKey = (await signer.getPublicKey("ed25519")).toString();
    const accountId = await deriveGoogleAccountId(
      publicKey,
      this.configuration.googleAccountParent,
    );

    let gasKey = (await this.#keyStore.getKey(
      this.configuration.networkId,
      accountId,
    )) as KeyPair | null;
    if (gasKey === null) {
      gasKey = KeyPair.fromRandom("ED25519");
      await this.#keyStore.setKey(
        this.configuration.networkId,
        accountId,
        gasKey,
      );
    }
    const gasPublicKey = gasKey.getPublicKey().toString();

    const response = await fetch(`${apiBaseUrl}/api/v1/onboarding/google-wallet`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        userId: user.userId,
        idToken,
        publicKey,
        gasPublicKey,
      }),
    });
    if (!response.ok) throw await readApiError(response);
    const wallet = (await response.json()) as SponsoredWalletResponse;
    if (
      wallet.accountId !== accountId ||
      wallet.publicKey !== publicKey ||
      wallet.gasPublicKey !== gasPublicKey
    ) {
      throw new Error("The sponsor returned unexpected wallet details.");
    }

    const metadata: GoogleWalletMetadata = {
      userId: user.userId,
      accountId,
      publicKey,
      gasPublicKey,
    };
    localStorage.setItem(GOOGLE_WALLET_STORAGE, JSON.stringify(metadata));
    this.#googleSigner = signer;
    const identity: ConnectedIdentity = {
      accountId,
      method: "google",
      explorerUrl:
        wallet.explorerUrl ?? `${this.configuration.explorerUrl}/address/${accountId}`,
    };
    this.#setIdentity(identity);
    return identity;
  }

  async disconnect(): Promise<void> {
    if (this.#identity?.method === "wallet" && this.#wallet !== null) {
      await this.#walletConnections.disconnect(this.#wallet);
    } else if (this.#identity?.method === "google") {
      await this.#googleProvider.logout();
    }
    this.#wallet = null;
    this.#walletPublicKey = null;
    this.#verifiedWalletPublicKey = null;
    this.#googleSigner = null;
    this.#setIdentity(null);
  }

  async createSession(tournamentId: string | null = null): Promise<SessionStartResult> {
    const identity = this.#identity;
    if (identity === null) throw new Error("Connect a NEAR account before starting.");
    if (this.configuration.contractId.length === 0) {
      throw new Error("The arcade contract has not been deployed yet.");
    }
    if (
      tournamentId !== null &&
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tournamentId)
    ) {
      throw new Error("The selected tournament id is invalid.");
    }

    const activeSession = await this.#getActiveSession(identity.accountId);
    const outcome =
      identity.method === "wallet"
        ? await this.#createWalletSession(
            identity.accountId,
            activeSession,
            tournamentId,
          )
        : await this.#createGoogleSession(
            identity.accountId,
            activeSession,
            tournamentId,
          );
    const session = sessionFromOutcome(outcome);
    const transactionHash = transactionHashFromOutcome(outcome);
    return {
      session,
      transactionHash,
      explorerUrl: `${this.configuration.explorerUrl}/txns/${transactionHash}`,
    };
  }

  async joinTournament(tournamentId: string): Promise<TournamentJoinResult> {
    const identity = this.#identity;
    if (identity === null) {
      throw new Error("Connect a NEAR account before joining a tournament.");
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tournamentId)) {
      throw new Error("The tournament id is invalid.");
    }
    const args = { tournament_id: tournamentId };
    const outcome =
      identity.method === "wallet"
        ? await this.#sendWalletActions(identity.accountId, [
            {
              type: "FunctionCall",
              params: {
                methodName: "join_tournament",
                args,
                gas: TOURNAMENT_GAS,
                deposit: "0",
              },
            },
          ])
        : await this.#sendGoogleActions(identity.accountId, [
            transactions.functionCall(
              "join_tournament",
              args,
              BigInt(TOURNAMENT_GAS),
              0n,
            ),
          ]);
    const entry = tournamentEntryFromOutcome(outcome);
    if (
      entry.tournamentId !== tournamentId ||
      entry.playerId !== identity.accountId
    ) {
      throw new Error("The confirmed tournament entry is unexpected.");
    }
    const transactionHash = transactionHashFromOutcome(outcome);
    return {
      entry,
      transactionHash,
      explorerUrl: `${this.configuration.explorerUrl}/txns/${transactionHash}`,
    };
  }

  async submitReplay(
    sessionId: string,
    replay: GameReplay,
    claimedScore: number,
  ): Promise<ScoreSubmissionResult> {
    const identity = this.#identity;
    if (identity === null) {
      throw new Error("Connect a NEAR account before submitting a score.");
    }
    if (!this.configuration.verifierConfigured) {
      throw new Error("Replay verification is not configured on this deployment.");
    }
    if (!/^[a-f0-9]{64}$/.test(sessionId)) {
      throw new Error("The active session id is invalid.");
    }

    const response = await fetch(
      `${apiBaseUrl}/api/v1/runs/${encodeURIComponent(sessionId)}/replay`,
      {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          playerId: identity.accountId,
          claimedScore,
          replay,
        }),
      },
    );
    if (!response.ok) throw await readApiError(response);
    const verified = parseVerifiedReplayResponse(await response.json());
    if (
      verified.score !== claimedScore ||
      verified.attestation.score !== claimedScore ||
      verified.attestation.sessionId !== sessionId ||
      verified.attestation.playerId !== identity.accountId ||
      verified.attestation.contractId !== this.configuration.contractId ||
      verified.attestation.replayHash !== verified.replayHash
    ) {
      throw new Error("The replay verifier attested unexpected run details.");
    }

    const args = {
      session_id: sessionId,
      score: verified.score,
      replay_hash: verified.replayHash,
      attestation_expires_at_ns: verified.attestation.expiresAtNs,
      verifier_signature: verified.verifierSignature,
      recovery_id: verified.recoveryId,
    };
    const outcome =
      identity.method === "wallet"
        ? await this.#submitWalletScore(identity.accountId, args)
        : await this.#submitGoogleScore(identity.accountId, args);
    const record = scoreRecordFromOutcome(outcome);
    if (
      record.sessionId !== sessionId ||
      record.playerId !== identity.accountId ||
      record.score !== verified.score ||
      record.replayHash !== verified.replayHash
    ) {
      throw new Error("The confirmed score record does not match the verified run.");
    }
    const transactionHash = transactionHashFromOutcome(outcome);
    return {
      record,
      replayHash: verified.replayHash,
      replayBytes: verified.replayBytes,
      transactionHash,
      explorerUrl: `${this.configuration.explorerUrl}/txns/${transactionHash}`,
    };
  }

  async #restore(): Promise<void> {
    await this.#connector.whenManifestLoaded.catch(() => undefined);
    const preferredMethod = localStorage.getItem(AUTH_METHOD_STORAGE);

    if (preferredMethod === "wallet") {
      if (localStorage.getItem(WALLET_AUTHORIZATION_STORAGE) === null) {
        localStorage.removeItem(AUTH_METHOD_STORAGE);
        await this.#walletConnections.clearUnconfirmedSelection();
        return;
      }
      if (await this.#restoreWallet()) return;
      localStorage.removeItem(AUTH_METHOD_STORAGE);
      await this.#walletConnections.clearUnconfirmedSelection();
      return;
    }

    await this.#walletConnections.clearUnconfirmedSelection();
    await this.#restoreGoogle();
  }

  async #restoreWallet(): Promise<boolean> {
    try {
      const { wallet, accounts } = await this.#walletConnections.restore();
      const account = accounts[0];
      if (account === undefined) return false;
      if (
        localStorage.getItem(WALLET_AUTHORIZATION_STORAGE) !== account.accountId
      ) {
        await this.#invalidateWalletConnection(wallet);
        return false;
      }
      this.#wallet = wallet;
      this.#walletPublicKey = account.publicKey ?? null;
      if (!(await this.#walletAccessKeyExists(account.accountId))) {
        await this.#invalidateWalletConnection(wallet);
        return false;
      }
      this.#setIdentity({
        accountId: account.accountId,
        method: "wallet",
        explorerUrl: `${this.configuration.explorerUrl}/address/${account.accountId}`,
      });
      return true;
    } catch {
      this.#wallet = null;
      this.#walletPublicKey = null;
      this.#verifiedWalletPublicKey = null;
      return false;
    }
  }

  async #restoreGoogle(): Promise<boolean> {
    const metadata = parseStoredGoogleWallet();
    if (metadata === null || !(await this.#googleProvider.isLoggedIn())) return false;
    try {
      const key = (await this.#keyStore.getKey(
        this.configuration.networkId,
        metadata.accountId,
      )) as KeyPair | null;
      if (key === null || key.getPublicKey().toString() !== metadata.gasPublicKey) {
        return false;
      }
      const signer = await this.#fastAuth.getSigner();
      if ((await signer.getPublicKey("ed25519")).toString() !== metadata.publicKey) {
        return false;
      }
      this.#googleSigner = signer;
      this.#setIdentity({
        accountId: metadata.accountId,
        method: "google",
        explorerUrl: `${this.configuration.explorerUrl}/address/${metadata.accountId}`,
      });
      return true;
    } catch {
      return false;
    }
  }

  async #getActiveSession(accountId: string): Promise<ChainSession | null> {
    const response = (await this.#near.connection.provider.query({
      request_type: "call_function",
      finality: "final",
      account_id: this.configuration.contractId,
      method_name: "get_active_session",
      args_base64: encodeArgs({ account_id: accountId }),
    })) as unknown as CallFunctionResponse;
    const decoded = new TextDecoder().decode(Uint8Array.from(response.result));
    const value = JSON.parse(decoded) as ChainSession | null;
    return value?.status === "active" ? value : null;
  }

  async #walletAccessKeyExists(accountId: string): Promise<boolean> {
    const publicKey = this.#walletPublicKey;
    if (publicKey === null) return true;
    try {
      await this.#near.connection.provider.query({
        request_type: "view_access_key",
        finality: "optimistic",
        account_id: accountId,
        public_key: publicKey,
      });
      this.#verifiedWalletPublicKey = publicKey;
      return true;
    } catch (error) {
      if (isMissingAccessKeyError(error)) return false;
      throw error;
    }
  }

  async #confirmWalletAccessKey(
    wallet: NearWalletBase,
    accountId: string,
    waitForPropagation: boolean,
  ): Promise<void> {
    if (
      this.#walletPublicKey === null ||
      this.#verifiedWalletPublicKey === this.#walletPublicKey
    ) {
      return;
    }
    const attempts = waitForPropagation ? WALLET_KEY_POLL_ATTEMPTS : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (await this.#walletAccessKeyExists(accountId)) return;
      if (attempt + 1 < attempts) await wait(WALLET_KEY_POLL_INTERVAL_MS);
    }
    await this.#invalidateWalletConnection(wallet);
    throw new Error(STALE_WALLET_ACCESS_KEY_MESSAGE);
  }

  async #invalidateWalletConnection(wallet: NearWalletBase): Promise<void> {
    await this.#walletConnections.invalidate(wallet);
    localStorage.removeItem(WALLET_AUTHORIZATION_STORAGE);
    this.#wallet = null;
    this.#walletPublicKey = null;
    this.#verifiedWalletPublicKey = null;
    if (this.#identity?.method === "wallet") this.#setIdentity(null);
  }

  async #sendWalletActions(
    accountId: string,
    actions: WalletFunctionCallAction[],
  ): Promise<unknown> {
    const wallet = this.#wallet ?? (await this.#connector.wallet());
    await this.#confirmWalletAccessKey(wallet, accountId, true);
    if (!this.configuration.relayerConfigured) {
      throw new Error("Gas sponsorship is not configured on this deployment.");
    }
    try {
      const signed = await wallet.signDelegateActions({
        network: "testnet",
        signerId: accountId,
        delegateActions: [
          {
            receiverId: this.configuration.contractId,
            actions,
          },
        ],
      });
      const signedDelegateAction = signed.signedDelegateActions[0];
      if (
        signed.signedDelegateActions.length !== 1 ||
        typeof signedDelegateAction !== "string" ||
        signedDelegateAction.length === 0
      ) {
        throw new Error("Meteor returned an invalid delegated transaction.");
      }
      const response = await fetch(`${apiBaseUrl}/api/v1/relay/arcade`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ signedDelegateAction }),
      });
      if (!response.ok) throw await readApiError(response);
      const relayed = (await response.json()) as { outcome?: unknown };
      if (relayed.outcome === undefined) {
        throw new Error("The gas relayer returned an invalid transaction result.");
      }
      return relayed.outcome;
    } catch (error) {
      if (!isMissingAccessKeyError(error)) throw error;
      await this.#invalidateWalletConnection(wallet);
      throw new Error(STALE_WALLET_ACCESS_KEY_MESSAGE);
    }
  }

  async #createWalletSession(
    accountId: string,
    activeSession: ChainSession | null,
    tournamentId: string | null,
  ): Promise<unknown> {
    const actions: WalletFunctionCallAction[] = [];
    if (activeSession !== null) {
      actions.push({
        type: "FunctionCall",
        params: {
          methodName: "abandon_session",
          args: { session_id: activeSession.sessionId },
          gas: "30000000000000",
          deposit: "0",
        },
      });
    }
    actions.push({
      type: "FunctionCall",
      params: {
        methodName: "create_session",
        args: {
          game_id: GAME_ID,
          ruleset_version: RULESET_VERSION,
          tournament_id: tournamentId,
        },
        gas: SESSION_GAS,
        deposit: SESSION_DEPOSIT_YOCTO,
      },
    });
    return this.#sendWalletActions(accountId, actions);
  }

  async #createGoogleSession(
    accountId: string,
    activeSession: ChainSession | null,
    tournamentId: string | null,
  ): Promise<unknown> {
    const actions = [];
    if (activeSession !== null) {
      actions.push(
        transactions.functionCall(
          "abandon_session",
          { session_id: activeSession.sessionId },
          30_000_000_000_000n,
          0n,
        ),
      );
    }
    actions.push(
      transactions.functionCall(
        "create_session",
        {
          game_id: GAME_ID,
          ruleset_version: RULESET_VERSION,
          tournament_id: tournamentId,
        },
        BigInt(SESSION_GAS),
        BigInt(SESSION_DEPOSIT_YOCTO),
      ),
    );

    return this.#sendGoogleActions(accountId, actions);
  }

  async #submitWalletScore(
    accountId: string,
    args: object,
  ): Promise<unknown> {
    return this.#sendWalletActions(accountId, [
      {
        type: "FunctionCall",
        params: {
          methodName: "submit_verified_score",
          args,
          gas: SCORE_SUBMISSION_GAS,
          deposit: "0",
        },
      },
    ]);
  }

  async #submitGoogleScore(accountId: string, args: object): Promise<unknown> {
    return this.#sendGoogleActions(accountId, [
      transactions.functionCall(
        "submit_verified_score",
        args,
        BigInt(SCORE_SUBMISSION_GAS),
        0n,
      ),
    ]);
  }

  async #sendGoogleActions(
    accountId: string,
    actions: ReturnType<typeof transactions.functionCall>[],
  ): Promise<unknown> {
    const signer = this.#googleSigner ?? (await this.#fastAuth.getSigner());
    this.#googleSigner = signer;
    const publicKey = normalizeNearPublicKey(
      await signer.getPublicKey("ed25519"),
    );
    const delegateAction = await this.#createDelegateAction(
      accountId,
      publicKey,
      this.configuration.contractId,
      actions,
    );
    await signer.requestDelegateActionSignature({ delegateAction });
    const { signatureRequest } = await signer.getSignatureRequest();
    const signatureOutcome = await this.#relayFastAuthSignature(
      delegateAction,
      signatureRequest,
    );
    const signature = FastAuthSignature.fromBase64(
      successValueFromOutcome(signatureOutcome),
    );
    const signedDelegate = {
      delegateAction,
      signature: new transactions.Signature({
        keyType: publicKey.keyType,
        data: signature.recover("ed25519"),
      }),
    };
    return this.#relaySignedDelegate(
      "/api/v1/relay/arcade",
      signedDelegate,
    );
  }

  async #createDelegateAction(
    accountId: string,
    publicKey: ReturnType<typeof normalizeNearPublicKey>,
    receiverId: string,
    actions: ReturnType<typeof transactions.functionCall>[],
  ): Promise<{
    readonly senderId: string;
    readonly receiverId: string;
    readonly actions: ReturnType<typeof transactions.functionCall>[];
    readonly nonce: bigint;
    readonly maxBlockHeight: bigint;
    readonly publicKey: ReturnType<typeof normalizeNearPublicKey>;
  }> {
    const [accessKey, block] = await Promise.all([
      this.#near.connection.provider.query({
        request_type: "view_access_key",
        finality: "optimistic",
        account_id: accountId,
        public_key: publicKey.toString(),
      }) as unknown as Promise<AccessKeyResponse>,
      this.#near.connection.provider.block({ finality: "final" }) as Promise<BlockResponse>,
    ]);
    return {
      senderId: accountId,
      receiverId,
      actions,
      nonce: BigInt(accessKey.nonce) + 1n,
      maxBlockHeight: BigInt(block.header.height) + 200n,
      publicKey,
    };
  }

  async #signDelegateWithKeyPair(
    delegateAction: Parameters<typeof transactions.encodeDelegateAction>[0],
    keyPair: KeyPair,
  ): Promise<unknown> {
    const message = transactions.encodeDelegateAction(delegateAction);
    const messageBytes = new Uint8Array(message.byteLength);
    messageBytes.set(message);
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", messageBytes.buffer),
    );
    const signed = keyPair.sign(digest);
    return {
      delegateAction,
      signature: new transactions.Signature({
        keyType: signed.publicKey.keyType,
        data: signed.signature,
      }),
    };
  }

  async #relayFastAuthSignature(
    delegateAction: Parameters<typeof transactions.encodeDelegateAction>[0],
    signatureRequest: {
      readonly guardId: string;
      readonly verifyPayload: string;
      readonly signPayload: Uint8Array;
    },
  ): Promise<unknown> {
    const response = await fetch(`${apiBaseUrl}/api/v1/relay/google-sign`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        arcadeDelegateAction: encodeBytes(
          transactions.encodeDelegateAction(delegateAction),
        ),
        signatureRequest: {
          guardId: signatureRequest.guardId,
          verifyPayload: signatureRequest.verifyPayload,
          signPayload: Array.from(signatureRequest.signPayload),
          algorithm: "eddsa",
        },
      }),
    });
    if (!response.ok) throw await readApiError(response);
    const relayed = (await response.json()) as { outcome?: unknown };
    if (relayed.outcome === undefined) {
      throw new Error("The gas relayer returned an invalid FastAuth result.");
    }
    return relayed.outcome;
  }

  async #relaySignedDelegate(
    pathname: string,
    signedDelegate: unknown,
    extra: Record<string, string> = {},
  ): Promise<unknown> {
    const response = await fetch(`${apiBaseUrl}${pathname}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        signedDelegateAction: encodeBytes(
          transactions.encodeSignedDelegate(signedDelegate as never),
        ),
        ...extra,
      }),
    });
    if (!response.ok) throw await readApiError(response);
    const relayed = (await response.json()) as { outcome?: unknown };
    if (relayed.outcome === undefined) {
      throw new Error("The gas relayer returned an invalid transaction result.");
    }
    return relayed.outcome;
  }

  #setIdentity(identity: ConnectedIdentity | null): void {
    this.#identity = identity;
    if (identity === null) localStorage.removeItem(AUTH_METHOD_STORAGE);
    else localStorage.setItem(AUTH_METHOD_STORAGE, identity.method);
    if (identity?.method !== "wallet") {
      localStorage.removeItem(WALLET_AUTHORIZATION_STORAGE);
    }
    for (const listener of this.#listeners) listener(identity);
  }
}

export const describeNearError = (error: unknown): string => {
  const message = errorMessage(error);
  if (/User rejected|rejected by user|cancelled|closed popup/i.test(message)) {
    return "The request was cancelled. Nothing was submitted.";
  }
  if (/already has an active session/i.test(message)) {
    return "Your previous session is still active. Try again after it is abandoned.";
  }
  return message;
};
