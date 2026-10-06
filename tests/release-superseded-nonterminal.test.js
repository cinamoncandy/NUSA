import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, ".github/workflows", f), "utf8");
test("stale exact-main release races become SUPERSEDED no-ops, not terminal failures", () => {
  for (const f of ["oracle-paper-release.yml", "windows-desktop-stable-release.yml", "android-stable-release.yml"]) {
    const y = read(f);
    assert.match(y, /id: source_fresh/);
    assert.match(y, /fresh=false/);
    assert.match(y, /SUPERSEDED:/);
    assert.match(y, /fresh == 'true'/);
  }
});
test("evolve-wrapped gha failures are recognized as repair evidence", () => {
  const source = fs.readFileSync(path.join(root, "apps/autopilot/src/codingRunner.ts"), "utf8");
  assert.match(source, /\(\?:\^\|:\)gha:/);
  assert.match(source, /failure\|cancelled\|timed_out/);
});
