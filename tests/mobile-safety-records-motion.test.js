const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (p) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");
const rings = read("apps/mobile/src/safetyCircuit.tsx");
const kit = read("apps/mobile/src/instrumentKit.tsx");
const safety = read("apps/mobile/src/safetyView.tsx");
const records = read("apps/mobile/src/recordsView.tsx");
const app = read("apps/mobile/App.tsx");

test("the safety rings are build facts with no server input and stop with reduce-motion", () => {
  assert.match(safety, /<SafetyCircuit \/>/, "no props: nothing a response says can change it");
  assert.match(rings, /const reducedMotion = useReducedMotion\(\);/);
  assert.match(kit, /isReduceMotionEnabled\(\)/);
  assert.match(rings, /if \(reducedMotion !== false \|\| w <= 0\) return undefined;/);
  assert.doesNotMatch(rings, /useNativeDriver: false/);
  assert.doesNotMatch(rings, /fetch\(|snapshot|heartbeat/);
});

test("the records timeline reads only the live heartbeat and its pulse stops with reduce-motion", () => {
  assert.match(app, /<MoreMenuView heartbeat=\{stale \? null : snapshot\?\.operations\.heartbeat \?\? null\}/);
  assert.match(records, /buildTodayTimeline\(heartbeat, Date\.now\(\)\)/);
  assert.match(records, /if \(reducedMotion !== false \|\| event\.tone !== "NOW"\) return undefined;/);
});
