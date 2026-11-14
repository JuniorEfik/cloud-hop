process.env.SERVE_WEB = "1";
process.env.API_HOST ??= "0.0.0.0";
if (process.env.API_PORT === undefined && process.env.PORT !== undefined) {
  process.env.API_PORT = process.env.PORT;
}

await import("../apps/api/dist/src/start.js");
