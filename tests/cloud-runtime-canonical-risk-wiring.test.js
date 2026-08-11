const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const runtimePath = path.join(process.cwd(), "apps", "cloud", "src", "runtime.ts");
const source = fs.readFileSync(runtimePath, "utf8");

test("startCloudRuntime constructs one canonical risk adapter and one execution boundary for runtime-owned PAPER", () => {
  assert.match(source, /import \{ CloudPaperCanonicalRiskGateway \} from "\.\/cloudPaperCanonicalRiskGateway";/);
  assert.match(source, /import \{ CloudPaperExecutionBoundary \} from "\.\/cloudPaperExecutionBoundary";/);
  assert.match(source, /const runtimeOwnsPaperComposition = paperExecutionLoop == null && paperAccountRepository == null;/);
  assert.match(source, /const productionPaperRiskGate = runtimeOwnsPaperComposition/);
  assert.match(source, /new CloudPaperCanonicalRiskGateway\(/);
  assert.match(source, /const productionPaperBoundary = runtimeOwnsPaperComposition/);
  assert.match(source, /new CloudPaperExecutionBoundary\(/);
});

test("production-owned PAPER has no direct execution-loop fallback around the risk boundary", () => {
  assert.match(source, /const result = runtimeOwnsPaperComposition\s*\? productionPaperBoundary\?\.processTick\(tick\)\s*:\s*effectivePaperLoop\.processTick\(tick\);/s);
  assert.doesNotMatch(source, /productionPaperBoundary\?\.processTick\(tick\)\s*\?\?\s*effectivePaperLoop\.processTick\(tick\)/s);
  assert.match(source, /if \(result == null \|\| result\.status === "FAILED"\) clearPaperProjection\(\);/);
});

test("production risk composition is coupled to durable state and configured PAPER capital", () => {
  assert.match(source, /config\.paperInitialCapitalKrw !== undefined/);
  assert.match(source, /durableRepository instanceof SqliteCloudDashboardSnapshotRepository/);
  assert.match(source, /database: durableRepository\.database\(\)/);
  assert.match(source, /readP0State: readPaperP0State/);
});
