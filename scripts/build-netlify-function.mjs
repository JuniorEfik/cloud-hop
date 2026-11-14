import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { build } from "esbuild";

const outputDirectory = path.resolve("apps/web/netlify/functions");

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await build({
  entryPoints: [path.resolve("netlify/functions/api.mjs")],
  outfile: path.join(outputDirectory, "api.cjs"),
  bundle: true,
  external: ["serverless-http"],
  platform: "node",
  format: "cjs",
  target: ["node22"],
  banner: {
    js: 'const __netlifyImportMetaUrl = require("node:url").pathToFileURL(__filename).href;',
  },
  define: {
    "import.meta.url": "__netlifyImportMetaUrl",
  },
  sourcemap: false,
  legalComments: "none",
});

console.log(`Built Netlify API function in ${outputDirectory}`);
