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
  assert.match(source, /const effectivePaperBoundary = effectivePaperLoop != null && productionPaperRiskGate != null/);
  assert.match(source, /new CloudPaperExecutionBoundary\(/);
});

test("production-owned PAPER has no direct execution-loop fallback around an available risk boundary", () => {
  assert.match(source, /const result = effectivePaperBoundary\?\.processTick\(tick\) \?\? effectivePaperLoop\.processTick\(tick\);/);
  assert.doesNotMatch(source, /effectivePaperBoundary\?\.processTick\(tick\)\s*\?\?\s*effectivePaperLoop\.processTick\(tick\)\s*\?\?/s);
  assert.match(source, /if \(result\.status === "FAILED"\) clearPaperProjection\(\); else projectPaperAccount\(\);/);
});

test("production risk composition is coupled to durable state and configured PAPER capital", () => {
  assert.match(source, /config\.paperInitialCapitalKrw !== undefined/);
  assert.match(source, /durableRepository instanceof SqliteCloudDashboardSnapshotRepository/);
  assert.match(source, /database: durableRepository\.database\(\)/);
  assert.match(source, /readP0State: readPaperP0State/);
});
