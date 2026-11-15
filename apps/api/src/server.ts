import { randomBytes, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "./config.js";
import { ContractActivityService } from "./activity.js";
import { ApiError } from "./errors.js";
import { RelayerService } from "./relayer.js";
import { SponsorService } from "./sponsor.js";
import {
  MinuteRateLimiter,
  ReplayVerifierService,
  RpcArcadeChainReader,
} from "./replay-verifier.js";
import {
  parseLeaderboardQuery,
  parsePaginationQuery,
  PublicReadService,
} from "./read-model.js";

const sponsor = new SponsorService(config);
const relayer = new RelayerService(config);
const initialization = Promise.all([
  sponsor.initialize(),
  relayer.initialize(),
]);
const chainReader = new RpcArcadeChainReader(config.rpcUrl, config.contractId);
const replayVerifier = new ReplayVerifierService(config, chainReader);
const publicReads = new PublicReadService(config, chainReader);
const contractActivity = new ContractActivityService(config);
const replayLimiter = new MinuteRateLimiter(config.verifierPerIpMinuteLimit);
const webOutputDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../web/dist",
);
const webContentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".webp", "image/webp"],
]);
const webClientRoutes = new Set([
  "/",
  "/play",
  "/dashboard",
  "/tournaments",
  "/leaderboard",
  "/profile",
  "/how-it-works",
  "/settings",
]);

const applyApiSecurityHeaders = (response: ServerResponse): void => {
  response.setHeader(
    "content-security-policy",
    "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  );
  response.setHeader("cross-origin-resource-policy", "cross-origin");
  response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
};

const applyWebSecurityHeaders = (
  response: ServerResponse,
  cspNonce: string,
): void => {
  response.setHeader(
    "content-security-policy",
    [
      "default-src 'self'",
      "base-uri 'none'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      `script-src 'self' 'nonce-${cspNonce}'`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https: wss:",
      "frame-src https:",
      "worker-src 'self' blob:",
    ].join("; "),
  );
  response.setHeader("cross-origin-opener-policy", "same-origin-allow-popups");
  response.setHeader("cross-origin-resource-policy", "same-origin");
  response.setHeader(
    "permissions-policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
};

const serveWebAsset = async (
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  cspNonce: string,
): Promise<void> => {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400, {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    }).end("Bad request");
    return;
  }
  const requestedPath = decodedPath === "/" ? "/index.html" : decodedPath;
  const filePath = path.resolve(webOutputDirectory, `.${requestedPath}`);
  if (!filePath.startsWith(`${webOutputDirectory}${path.sep}`)) {
    response.writeHead(403, {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    }).end("Forbidden");
    return;
  }
  try {
    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) throw new Error("Not a file");
    if (path.extname(filePath) === ".html") {
      const renderedHtml = (await readFile(filePath, "utf8")).replaceAll(
        "__CSP_NONCE__",
        cspNonce,
      );
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-length": String(Buffer.byteLength(renderedHtml)),
        "cache-control": "no-store",
      });
      if (request.method === "HEAD") response.end();
      else response.end(renderedHtml);
      return;
    }
    response.writeHead(200, {
      "content-type":
        webContentTypes.get(path.extname(filePath)) ?? "application/octet-stream",
      "content-length": String(fileStats.size),
      "cache-control": "no-store",
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(filePath).pipe(response);
  } catch {
    const normalizedPath =
      decodedPath === "/" ? decodedPath : decodedPath.replace(/\/+$/, "");
    if (webClientRoutes.has(normalizedPath)) {
      const indexPath = path.join(webOutputDirectory, "index.html");
      const renderedIndex = (await readFile(indexPath, "utf8")).replaceAll(
        "__CSP_NONCE__",
        cspNonce,
      );
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-length": String(Buffer.byteLength(renderedIndex)),
        "cache-control": "no-store",
      });
      if (request.method === "HEAD") response.end();
      else response.end(renderedIndex);
      return;
    }
    response.writeHead(404, {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    }).end("Not found");
  }
};

const sendJson = (
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
): void => {
  response.setHeader("cache-control", "no-store");
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
};

const readJsonBody = async (
  request: IncomingMessage,
  maximumBytes = 16_384,
): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maximumBytes) {
      throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
    }
    chunks.push(buffer);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
};

const applyCors = (request: IncomingMessage, response: ServerResponse): boolean => {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  const host = request.headers.host;
  const forwardedHeader = request.headers["x-forwarded-proto"];
  const forwardedProtocol = (
    Array.isArray(forwardedHeader) ? forwardedHeader[0] : forwardedHeader
  )
    ?.split(",")[0]
    ?.trim();
  const sameOrigin =
    host !== undefined &&
    (origin === `http://${host}` ||
      origin === `https://${host}` ||
      (forwardedProtocol === "http" || forwardedProtocol === "https"
        ? origin === `${forwardedProtocol}://${host}`
        : false));
  const localFallbackOrigin = /^http:\/\/(?:127\.0\.0\.1|localhost):(?:300\d|3010)$/.test(
    origin,
  );
  if (!config.webOrigins.includes(origin) && !localFallbackOrigin && !sameOrigin) {
    return false;
  }

  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("vary", "origin");
  response.setHeader("access-control-allow-headers", "content-type");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-max-age", "600");
  return true;
};

const requesterKey = (request: IncomingMessage): string => {
  const netlifyIp = request.headers["x-nf-client-connection-ip"];
  if (typeof netlifyIp === "string" && netlifyIp.length > 0) return netlifyIp;
  const forwarded = request.headers["x-forwarded-for"];
  const firstForwarded = (Array.isArray(forwarded) ? forwarded[0] : forwarded)
    ?.split(",")[0]
    ?.trim();
  return firstForwarded || request.socket.remoteAddress || "unknown";
};

export const server = createServer(async (request, response) => {
  const requestId = randomUUID();
  const cspNonce = randomBytes(18).toString("base64");
  response.setHeader("x-request-id", requestId);

  try {
    await initialization;
    const url = new URL(request.url ?? "/", "http://api.local");
    const webRequest =
      config.serveWeb &&
      (request.method === "GET" || request.method === "HEAD") &&
      !url.pathname.startsWith("/api/");
    if (webRequest) applyWebSecurityHeaders(response, cspNonce);
    else applyApiSecurityHeaders(response);
    response.setHeader("cache-control", "no-store");

    if (!webRequest && !applyCors(request, response)) {
      throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "Request origin is not allowed.");
    }
    if (!webRequest && request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/health") {
      sendJson(response, 200, {
        ok: true,
        networkId: config.networkId,
        sponsorConfigured: config.sponsorConfigured,
        relayerConfigured: config.relayerConfigured,
        contractConfigured: Boolean(config.contractId),
        verifierConfigured: config.verifierConfigured,
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/game/config") {
      sendJson(response, 200, {
        networkId: config.networkId,
        rpcUrl: config.rpcUrl,
        explorerUrl: config.explorerUrl,
        contractId: config.contractId,
        fastAuthClientId: config.fastAuthClientId,
        fastAuthContractId: config.fastAuthContractId,
        mpcContractId: config.mpcContractId,
        sponsorConfigured: config.sponsorConfigured,
        relayerConfigured: config.relayerConfigured,
        verifierConfigured: config.verifierConfigured,
        googleAccountParent: config.sponsorConfigured
          ? config.sponsorAccountId
          : "",
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/activity") {
      sendJson(response, 200, await contractActivity.getFeed());
      return;
    }

    const playerStatsRoute = url.pathname.match(
      /^\/api\/v1\/players\/([^/]+)\/stats$/,
    );
    if (request.method === "GET" && playerStatsRoute !== null) {
      const encodedAccountId = playerStatsRoute[1];
      if (encodedAccountId === undefined) {
        throw new ApiError(400, "INVALID_PLAYER", "Player account id is invalid.");
      }
      let accountId: string;
      try {
        accountId = decodeURIComponent(encodedAccountId);
      } catch {
        throw new ApiError(400, "INVALID_PLAYER", "Player account id is invalid.");
      }
      sendJson(response, 200, await publicReads.getPlayerStats(accountId));
      return;
    }

    const leaderboardRoute = url.pathname.match(
      /^\/api\/v1\/leaderboards\/([^/]+)$/,
    );
    if (request.method === "GET" && leaderboardRoute !== null) {
      const encodedGameId = leaderboardRoute[1];
      if (encodedGameId === undefined) {
        throw new ApiError(400, "INVALID_GAME", "Game id is invalid.");
      }
      let gameId: string;
      try {
        gameId = decodeURIComponent(encodedGameId);
      } catch {
        throw new ApiError(400, "INVALID_GAME", "Game id is invalid.");
      }
      const query = parseLeaderboardQuery(url.searchParams);
      sendJson(response, 200, await publicReads.getLeaderboard(gameId, query));
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === "/api/v1/tournaments/current"
    ) {
      sendJson(
        response,
        200,
        await publicReads.getCurrentTournament(
          url.searchParams.get("gameId") ?? "cloud-hop",
        ),
      );
      return;
    }

    const tournamentEntryRoute = url.pathname.match(
      /^\/api\/v1\/tournaments\/([^/]+)\/entries\/([^/]+)$/,
    );
    if (request.method === "GET" && tournamentEntryRoute !== null) {
      const tournamentId = tournamentEntryRoute[1];
      const accountId = tournamentEntryRoute[2];
      if (tournamentId === undefined || accountId === undefined) {
        throw new ApiError(400, "INVALID_TOURNAMENT", "Tournament entry is invalid.");
      }
      let decodedTournamentId: string;
      let decodedAccountId: string;
      try {
        decodedTournamentId = decodeURIComponent(tournamentId);
        decodedAccountId = decodeURIComponent(accountId);
      } catch {
        throw new ApiError(400, "INVALID_TOURNAMENT", "Tournament entry is invalid.");
      }
      sendJson(
        response,
        200,
        await publicReads.getTournamentEntry(
          decodedTournamentId,
          decodedAccountId,
        ),
      );
      return;
    }

    const tournamentLeaderboardRoute = url.pathname.match(
      /^\/api\/v1\/tournaments\/([^/]+)\/leaderboard$/,
    );
    if (request.method === "GET" && tournamentLeaderboardRoute !== null) {
      const tournamentId = tournamentLeaderboardRoute[1];
      if (tournamentId === undefined) {
        throw new ApiError(400, "INVALID_TOURNAMENT", "Tournament id is invalid.");
      }
      let decodedTournamentId: string;
      try {
        decodedTournamentId = decodeURIComponent(tournamentId);
      } catch {
        throw new ApiError(400, "INVALID_TOURNAMENT", "Tournament id is invalid.");
      }
      sendJson(
        response,
        200,
        await publicReads.getTournamentLeaderboard(
          decodedTournamentId,
          parsePaginationQuery(url.searchParams),
        ),
      );
      return;
    }

    const tournamentRoute = url.pathname.match(
      /^\/api\/v1\/tournaments\/([^/]+)$/,
    );
    if (request.method === "GET" && tournamentRoute !== null) {
      const tournamentId = tournamentRoute[1];
      if (tournamentId === undefined) {
        throw new ApiError(400, "INVALID_TOURNAMENT", "Tournament id is invalid.");
      }
      let decodedTournamentId: string;
      try {
        decodedTournamentId = decodeURIComponent(tournamentId);
      } catch {
        throw new ApiError(400, "INVALID_TOURNAMENT", "Tournament id is invalid.");
      }
      sendJson(response, 200, await publicReads.getTournament(decodedTournamentId));
      return;
    }

    const achievementsRoute = url.pathname.match(
      /^\/api\/v1\/players\/([^/]+)\/achievements$/,
    );
    if (request.method === "GET" && achievementsRoute !== null) {
      const accountId = achievementsRoute[1];
      if (accountId === undefined) {
        throw new ApiError(400, "INVALID_PLAYER", "Player account id is invalid.");
      }
      let decodedAccountId: string;
      try {
        decodedAccountId = decodeURIComponent(accountId);
      } catch {
        throw new ApiError(400, "INVALID_PLAYER", "Player account id is invalid.");
      }
      sendJson(
        response,
        200,
        await publicReads.getPlayerAchievements(
          decodedAccountId,
          parsePaginationQuery(url.searchParams),
        ),
      );
      return;
    }

    const replayRoute = url.pathname.match(
      /^\/api\/v1\/runs\/([a-f0-9]{64})\/replay$/,
    );
    if (request.method === "POST" && replayRoute !== null) {
      const sessionId = replayRoute[1];
      if (sessionId === undefined) {
        throw new ApiError(400, "INVALID_SESSION_ID", "Session id is invalid.");
      }
      const requester = requesterKey(request);
      replayLimiter.consume(requester);
      const body = await readJsonBody(request);
      const result = await replayVerifier.verifyAndAttest(sessionId, body);
      sendJson(response, 200, result);
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/v1/onboarding/google-wallet"
    ) {
      const body = await readJsonBody(request);
      const requester = requesterKey(request);
      const result = await sponsor.createGoogleWallet(body, requester);
      sendJson(response, result.created ? 201 : 200, result);
      return;
    }

    if (
      request.method === "POST" &&
      (url.pathname === "/api/v1/relay/arcade" ||
        url.pathname === "/api/v1/relay/meteor")
    ) {
      const body = await readJsonBody(request);
      const requester = requesterKey(request);
      sendJson(response, 200, await relayer.relayArcade(body, requester));
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/v1/relay/google-sign"
    ) {
      const body = await readJsonBody(request, 32_768);
      const requester = requesterKey(request);
      sendJson(response, 200, await relayer.relayFastAuthSign(body, requester));
      return;
    }

    if (webRequest) {
      await serveWebAsset(request, response, url.pathname, cspNonce);
      return;
    }

    throw new ApiError(404, "NOT_FOUND", "Route was not found.");
  } catch (error) {
    const apiError =
      error instanceof ApiError
        ? error
        : new ApiError(500, "INTERNAL_ERROR", "Request could not be completed.");
    if (!(error instanceof ApiError)) {
      console.error(`[${requestId}]`, error instanceof Error ? error.message : error);
    }
    sendJson(response, apiError.statusCode, {
      error: { code: apiError.code, message: apiError.message, requestId },
    });
  }
});

