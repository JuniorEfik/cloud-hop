import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const webDirectory = path.resolve(scriptDirectory, "..");
const repositoryDirectory = path.resolve(webDirectory, "../..");
const outputDirectory = process.env.WEB_OUTPUT_DIRECTORY
  ? path.resolve(process.env.WEB_OUTPUT_DIRECTORY)
  : path.join(webDirectory, "dist");
const outputAssetsDirectory = path.join(outputDirectory, "assets");
const envFile = path.join(repositoryDirectory, ".env");

if (existsSync(envFile)) process.loadEnvFile(envFile);

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await mkdir(outputAssetsDirectory, { recursive: true });
await copyFile(
  path.join(webDirectory, "index.html"),
  path.join(outputDirectory, "index.html"),
);
const applicationStyles = await readFile(
  path.join(webDirectory, "src/styles.css"),
  "utf8",
);
await writeFile(
  path.join(outputDirectory, "styles.css"),
  applicationStyles,
);
for (const assetName of ["cloud-hop-flight.webp", "cloud-hop-arena.webp"]) {
  await copyFile(
    path.join(webDirectory, "src/assets", assetName),
    path.join(outputAssetsDirectory, assetName),
  );
}

await build({
  entryPoints: [path.join(webDirectory, "src/main.ts")],
  outfile: path.join(outputDirectory, "app.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  sourcemap: true,
  minify: false,
  legalComments: "none",
  inject: [path.join(webDirectory, "scripts/buffer-shim.js")],
  define: {
    __PUBLIC_API_BASE_URL__: JSON.stringify(
      process.env.PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8787",
    ),
    global: "globalThis",
  },
});

console.log(`Built Cloud Hop web app in ${outputDirectory}`);
