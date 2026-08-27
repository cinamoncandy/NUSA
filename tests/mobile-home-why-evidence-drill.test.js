const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("HOME WHY drills into verified evidence without creating a dead control", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  assert.match(
    home,
    /<SupervisorRow label="WHY"[\s\S]*?onPress=\{aiInsightAvailable \? \(\) => onNavigate\("AiSignal"\) : undefined\}[\s\S]*?actionLabel=\{aiInsightAvailable \? "EVIDENCE →" : undefined\}/,
  );
});

test("HOME keeps WHY downstream of NOW and ahead of RESULT", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const now = home.indexOf('testID="home-supervisor-now"');
  const why = home.indexOf('testID="home-supervisor-why"');
  const result = home.indexOf('testID="home-supervisor-result"');
  assert.ok(now >= 0 && why >= 0 && result >= 0, "supervisor decision rows must exist");
  assert.ok(now < why && why < result, "HOME scan order must remain NOW → WHY → RESULT");
});
