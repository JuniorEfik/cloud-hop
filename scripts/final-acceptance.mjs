import { spawn } from "node:child_process";

const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
if (nodeMajor < 22) {
  throw new Error("Final acceptance requires Node.js 22 or newer.");
}

const skipLive = process.env.ACCEPTANCE_SKIP_LIVE === "1";
const executable = process.platform === "win32" ? "npm.cmd" : "npm";
const steps = [
  { label: "workspace checks", args: ["run", "check"] },
  { label: "dependency tree", args: ["ls", "--depth=0"] },
  {
    label: "high-severity production audit",
    args: ["audit", "--omit=dev", "--audit-level=high"],
  },
  { label: "single-port production server", args: ["run", "smoke:production"] },
  { label: "headless browser acceptance", args: ["run", "smoke:web"] },
  ...(!skipLive
    ? [{ label: "live Testnet journey", args: ["run", "smoke:testnet"] }]
    : []),
];

const run = ({ label, args }) =>
  new Promise((resolve, reject) => {
    console.log(`\n[acceptance] ${label}`);
    const child = spawn(executable, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
      shell: false,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `${label} failed${signal === null ? ` with exit code ${code}` : ` after ${signal}`}.`,
          ),
        );
      }
    });
  });

for (const step of steps) await run(step);

console.log(
  skipLive
    ? "\nFinal local acceptance passed. Live Testnet writes were intentionally skipped."
    : "\nFinal acceptance passed, including the live Testnet write journey.",
);
