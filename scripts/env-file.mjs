import { chmod, readFile, writeFile } from "node:fs/promises";

export const updateEnvFile = async (envPath, examplePath, updates) => {
  let contents;
  try {
    contents = await readFile(envPath, "utf8");
  } catch {
    contents = await readFile(examplePath, "utf8");
  }

  for (const [name, value] of Object.entries(updates)) {
    const line = `${name}=${value}`;
    const pattern = new RegExp(`^${name}=.*$`, "m");
    contents = pattern.test(contents)
      ? contents.replace(pattern, line)
      : `${contents.trimEnd()}\n${line}\n`;
  }

  await writeFile(envPath, contents, { encoding: "utf8", mode: 0o600 });
  await chmod(envPath, 0o600);
};
