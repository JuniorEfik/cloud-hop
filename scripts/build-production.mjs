import { spawn } from "node:child_process";

const executable = process.platform === "win32" ? "npm.cmd" : "npm";

await new Promise((resolve, reject) => {
  const child = spawn(executable, ["run", "build"], {
    cwd: process.cwd(),
    env: { ...process.env, PUBLIC_API_BASE_URL: "" },
    stdio: "inherit",
    shell: false,
  });
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (code === 0) resolve();
    else {
      reject(
        new Error(
          `Production build failed${signal === null ? ` with exit code ${code}` : ` after ${signal}`}.`,
        ),
      );
    }
  });
});
