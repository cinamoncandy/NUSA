const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("HOME supervisor decision spine preserves NOW -> WHY -> RESULT -> RISK -> LEARNING order", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const ids = [
    "home-supervisor-now",
    "home-supervisor-why",
    "home-supervisor-result",
    "home-supervisor-risk",
    "home-supervisor-learning",
  ];
  const positions = ids.map((id) => home.indexOf(`testID=\"${id}\"`));
  positions.forEach((position, index) => assert.ok(position >= 0, `${ids[index]} must exist`));
  for (let index = 1; index < positions.length; index += 1) {
    assert.ok(positions[index - 1] < positions[index], `${ids[index - 1]} must precede ${ids[index]}`);
  }
});

test("HOME RISK is fail-closed and derives only from canonical PAPER runtime/safety evidence", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const decisionSurface = read("apps/mobile/src/homeDecisionSurface.ts");
  assert.match(home, /const supervisorRisk = decisionSurface\.risk/);
  assert.match(decisionSurface, /const risk = input\.disconnected/);
  assert.match(decisionSurface, /"BLOCKED · PAPER LINK REQUIRED"/);
  assert.match(decisionSurface, /"BLOCKED · READ-ONLY RECOVERY REQUIRED"/);
  assert.match(decisionSurface, /runtimeActionRequired/);
  assert.match(decisionSurface, /runtimeWatch/);
  assert.match(decisionSurface, /input\.accountSource !== "CLOUD"\s*\n\s*\? "INSUFFICIENT · PAPER RUNTIME EVIDENCE UNAVAILABLE"/);
  assert.match(decisionSurface, /signalReady\s*\n\s*\? "PAPER ONLY · SAFETY GATES READY · LIVE NONE"/);
  assert.match(decisionSurface, /"WATCH · PAPER SAFETY GATES NOT READY"/);
});

test("HOME RISK cannot imply LIVE authority or introduce a second action", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const decisionSurface = read("apps/mobile/src/homeDecisionSurface.ts");
  const riskRow = home.match(/<SupervisorRow label=\"RISK\"[^>]+\/>/)?.[0] ?? "";
  assert.match(riskRow, /value=\{supervisorRisk\}/);
  assert.doesNotMatch(riskRow, /onPress=|actionLabel=/);
  assert.match(home, /PAPER ONLY · LIVE NONE/);
  assert.match(home, /AI ZERO AUTHORITY · productionMutationAllowed=false · liveAuthority=NONE/);
  assert.doesNotMatch(decisionSurface, /(?:LIVE READY|LIVE ACTIVE|LIVE ENABLED|LIVE AUTHORIZED)/);
});
