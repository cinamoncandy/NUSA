const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "designSystem.ts"), "utf8");
const block = /export const fieldMotion = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(source);

function tokens() {
  assert.ok(block, "fieldMotion block must exist");
  return Object.fromEntries([...block[1].matchAll(/(\w+):\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]));
}

test("fast-light motion: every interaction duration stays quick and the screen transition is the fastest", () => {
  const t = tokens();
  assert.equal(t.tabTransitionMs, 180);
  assert.equal(t.revealMs, 180);
  assert.equal(t.revealStaggerMs, 30);
  for (const [name, value] of Object.entries(t)) {
    if (name === "holoFlowMs" || name === "orbitStepDeg" || name === "revealMaxIndex") continue;
    assert.ok(value <= 600, `${name}=${value} must stay at or below 600ms`);
  }
});
