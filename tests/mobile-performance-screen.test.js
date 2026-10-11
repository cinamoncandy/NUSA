const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "apps/mobile/src/performanceModel.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const shim = { exports: {} };
new Function("module", "exports", "require", compiled)(shim, shim.exports, require);
const { buildPerformanceScreen } = shim.exports;

const perf = (over = {}) => ({ realizedPnL: -40, unrealizedPnL: 11, fees: 38, turnover: 80000, completedCycles: 1200, filledCycles: 8, winRate: 0.375, expectancy: -5, maxDrawdown: 61, ...over });

test("performance is shown only for a server-sourced projection", () => {
  const off = buildPerformanceScreen(perf(), false);
  assert.equal(off.available, false);
  assert.equal(off.rows.length, 0);
});

test("rows read in plain Korean with signed won and honest empties", () => {
  const screen = buildPerformanceScreen(perf(), true);
  const row = (label) => screen.rows.find((r) => r.label === label);
  assert.equal(row("총 손익").value, "−₩29");
  assert.equal(row("총 손익").tone, "neg");
  assert.equal(row("승률").value, "38%");
  assert.equal(row("최대 낙폭").value, "−₩61");
  assert.equal(row("체결 사이클 / 전체").value, "8 / 1,200");
  const empty = buildPerformanceScreen(perf({ winRate: null, expectancy: null, filledCycles: 0, maxDrawdown: 0 }), true);
  assert.equal(empty.rows.find((r) => r.label === "승률").value, "아직 없음");
  assert.match(empty.headline, /이릅니다/);
});

test("More → 성과 routes to the real screen; Risk/System/Help stay honest placeholders", () => {
  const app = fs.readFileSync(path.join(root, "apps/mobile/App.tsx"), "utf8");
  assert.match(app, /detailSurface === "Performance" \? <PerformanceView screen=\{buildPerformanceScreen\(paperLearningState\.performance, paperLearningState\.dataSource === "SERVER_STREAM"\)\}/);
  assert.match(app, /detailSurface === "Risk" \|\| detailSurface === "SystemStatus" \|\| detailSurface === "Help" \?/);
});

test("the equity series keeps server account points from the last 7 days, deduplicated, oldest first", () => {
  const { buildEquitySeries } = shim.exports;
  const day = 86_400_000, now = 10 * day;
  const series = buildEquitySeries([
    { occurredAt: now - 8 * day, account: { equity: 1 } },
    { occurredAt: now - 2 * day, account: { equity: 10000 } },
    { occurredAt: now - day, account: { equity: 10000 } },
    { occurredAt: now - day / 2 },
    { occurredAt: now - 1000, account: { equity: 9971 } },
  ], now);
  assert.deepEqual(series.map((p) => p.equity), [10000, 9971]);
  const view = fs.readFileSync(path.join(root, "apps/mobile/src/paperLearningMonitorView.tsx"), "utf8");
  assert.match(view, /state\.dataSource === "SERVER_STREAM" \? <EquityChart points=\{buildEquitySeries\(state\.timeline, Date\.now\(\)\)\} \/>/);
});
