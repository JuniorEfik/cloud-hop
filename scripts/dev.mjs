import { spawn } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const run = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn(npm, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm ${args.join(" ")} exited with code ${code}.`));
    });
  });

await run(["run", "build", "-w", "@near-arcade/game-core"]);
await run(["run", "build", "-w", "@near-arcade/api"]);

const services = [
  spawn(npm, ["run", "dev", "-w", "@near-arcade/api"], { stdio: "inherit" }),
  spawn(npm, ["run", "dev", "-w", "@near-arcade/web"], { stdio: "inherit" }),
];

const stop = () => {
  for (const service of services) service.kill("SIGTERM");
};

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

const exitCode = await new Promise((resolve) => {
  for (const service of services) {
    service.once("exit", (code) => resolve(code ?? 1));
    service.once("error", () => resolve(1));
  }
});

stop();
process.exitCode = exitCode;
