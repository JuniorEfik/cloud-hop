import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const repositoryDirectory = path.resolve(import.meta.dirname, "..");
const envPath = path.join(repositoryDirectory, ".env");
const outputDirectory = path.join(repositoryDirectory, "apps/web/dist");
const secretNames = [
  "NEAR_SPONSOR_PRIVATE_KEY",
  "NEAR_CONTRACT_PRIVATE_KEY",
  "NEAR_VERIFIER_PRIVATE_KEY",
];

if (!existsSync(outputDirectory)) {
  throw new Error("Build the frontend before running the secret scan.");
}
if (existsSync(envPath)) process.loadEnvFile(envPath);

const files = [];
const visit = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await visit(entryPath);
    else if (entry.isFile()) files.push(entryPath);
  }
};
await visit(outputDirectory);

const findings = [];
for (const filePath of files) {
  const contents = await readFile(filePath, "utf8");
  for (const name of secretNames) {
    const value = process.env[name] ?? "";
    if (contents.includes(name) || (value.length >= 16 && contents.includes(value))) {
      findings.push(`${path.relative(repositoryDirectory, filePath)} contains ${name}`);
    }
  }
}

if (findings.length > 0) {
  throw new Error(`Frontend secret scan failed:\n${findings.join("\n")}`);
}
console.log(`Frontend secret scan passed across ${files.length} built files.`);
