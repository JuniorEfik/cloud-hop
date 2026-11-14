import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const contractDirectory = path.resolve(scriptDirectory, "..");
const repositoryDirectory = path.resolve(contractDirectory, "../..");
const cli = path.join(
  repositoryDirectory,
  "node_modules/near-sdk-js/lib/cli/cli.js",
);
const localNodeModules = path.join(contractDirectory, "node_modules");
const localBin = path.join(localNodeModules, ".bin");

mkdirSync(localBin, { recursive: true });
for (const [target, link] of [
  [
    path.join(repositoryDirectory, "node_modules/near-sdk-js"),
    path.join(localNodeModules, "near-sdk-js"),
  ],
  [
    path.join(repositoryDirectory, "node_modules/.bin/tsc"),
    path.join(localBin, "tsc"),
  ],
]) {
  if (!existsSync(link)) symlinkSync(target, link);
}

execFileSync(
  process.execPath,
  [
    cli,
    "build",
    "src/contract.ts",
    "build/arcade.wasm",
    "--verbose",
  ],
  { cwd: contractDirectory, stdio: "inherit" },
);
