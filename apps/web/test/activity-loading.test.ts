import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const source = async (file: string): Promise<string> =>
  readFile(path.resolve(process.cwd(), "src", file), "utf8");

test("activity totals render accessible initial loading spinners", async () => {
  const main = await source("main.ts");
  assert.equal(main.match(/class="activity-stat-spinner"/g)?.length, 4);
  assert.equal(main.match(/aria-label="Loading"/g)?.length, 4);
  assert.match(main, /element\.removeAttribute\("aria-label"\)/);
});

test("activity total spinners animate and respect reduced motion", async () => {
  const styles = await source("styles.css");
  assert.match(styles, /\.activity-stat-spinner\s*\{/);
  assert.match(styles, /animation: activity-stat-spin 0\.8s linear infinite/);
  assert.match(styles, /@keyframes activity-stat-spin/);
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.activity-stat-spinner/,
  );
});
