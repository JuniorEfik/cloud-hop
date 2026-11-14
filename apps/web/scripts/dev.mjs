import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, request as createProxyRequest } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const outputDirectory = process.env.WEB_OUTPUT_DIRECTORY
  ? path.resolve(process.env.WEB_OUTPUT_DIRECTORY)
  : path.resolve(scriptDirectory, "../dev-dist");
process.env.WEB_OUTPUT_DIRECTORY = outputDirectory;

await import("./build.mjs");
const developmentApiOrigin = new URL(
  process.env.DEV_API_ORIGIN ?? "http://127.0.0.1:8787",
);
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".webp", "image/webp"],
]);
const clientRoutes = new Set([
  "/",
  "/play",
  "/dashboard",
  "/tournaments",
  "/leaderboard",
  "/profile",
  "/how-it-works",
  "/settings",
]);
const securityHeaders = Object.freeze({
  "cross-origin-opener-policy": "same-origin-allow-popups",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
});

const createContentSecurityPolicy = (nonce) =>
  [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' http://127.0.0.1:* http://localhost:* https: wss:",
    "frame-src https:",
    "worker-src 'self' blob:",
  ].join("; ");

const renderHtml = async (filePath, nonce) =>
  (await readFile(filePath, "utf8")).replaceAll("__CSP_NONCE__", nonce);

const proxyApiRequest = (request, response) => {
  const proxyRequest = createProxyRequest(
    {
      protocol: developmentApiOrigin.protocol,
      hostname: developmentApiOrigin.hostname,
      port: developmentApiOrigin.port,
      method: request.method,
      path: request.url,
      headers: {
        ...request.headers,
        host: developmentApiOrigin.host,
      },
    },
    (proxyResponse) => {
      response.writeHead(proxyResponse.statusCode ?? 502, proxyResponse.headers);
      proxyResponse.pipe(response);
    },
  );
  proxyRequest.on("error", () => {
    if (response.headersSent) response.destroy();
    else {
      response.writeHead(502, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      }).end(JSON.stringify({ error: { code: "DEV_API_UNAVAILABLE" } }));
    }
  });
  request.pipe(proxyRequest);
};

const server = createServer(async (request, response) => {
  const cspNonce = randomBytes(18).toString("base64");
  for (const [name, value] of Object.entries(securityHeaders)) {
    response.setHeader(name, value);
  }
  response.setHeader(
    "content-security-policy",
    createContentSecurityPolicy(cspNonce),
  );
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (pathname.startsWith("/api/")) {
    proxyApiRequest(request, response);
    return;
  }
  const requestHost = request.headers.host ?? "";
  if (requestHost === "127.0.0.1" || requestHost.startsWith("127.0.0.1:")) {
    const localhostHost = requestHost.replace(/^127\.0\.0\.1/, "localhost");
    response.writeHead(307, {
      location: `http://${localhostHost}${request.url ?? "/"}`,
      "cache-control": "no-store",
    }).end();
    return;
  }
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(outputDirectory, `.${requestedPath}`);

  if (!filePath.startsWith(`${outputDirectory}${path.sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) throw new Error("Not a file");
    if (path.extname(filePath) === ".html") {
      const renderedHtml = await renderHtml(filePath, cspNonce);
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
      "content-type": contentTypes.get(path.extname(filePath)) ?? "application/octet-stream",
      "content-length": String(fileStats.size),
      "cache-control": "no-store",
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(filePath).pipe(response);
  } catch {
    const normalizedPathname =
      pathname === "/" ? pathname : pathname.replace(/\/+$/, "");
    if (
      (request.method === "GET" || request.method === "HEAD") &&
      clientRoutes.has(normalizedPathname)
    ) {
      const indexPath = path.join(outputDirectory, "index.html");
      const renderedIndex = await renderHtml(indexPath, cspNonce);
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
});

const requestedPort = Number.parseInt(process.env.PORT ?? "3000", 10);

if (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65_535) {
  throw new RangeError("PORT must be an integer between 1 and 65535.");
}

const listen = (port) =>
  new Promise((resolve, reject) => {
    const handleError = (error) => {
      server.off("listening", handleListening);
      reject(error);
    };
    const handleListening = () => {
      server.off("error", handleError);
      resolve(port);
    };

    server.once("error", handleError);
    server.once("listening", handleListening);
    server.listen(port, "127.0.0.1");
  });

let activePort = requestedPort;

while (true) {
  try {
    await listen(activePort);
    break;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "EADDRINUSE" &&
      activePort < requestedPort + 10
    ) {
      activePort += 1;
      continue;
    }
    throw error;
  }
}

if (activePort !== requestedPort) {
  console.log(`Port ${requestedPort} is occupied; using ${activePort} instead.`);
}
console.log(`Cloud Hop is running at http://localhost:${activePort}`);
console.log("Restart the command after changing source files.");
