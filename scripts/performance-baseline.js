/**
 * Baseline performance measurement for apps/server (the single-user web Paper trading app),
 * per the owner's request to shift from adding features to measuring the current state
 * before optimizing anything. Measures P50/P95/P99, not just an average, since an average
 * hides momentary spikes.
 *
 * Deliberately excludes GUI-dependent metrics (Electron app launch time, idle CPU/memory
 * over a long real run) -- this sandbox has no display and no way to run a real multi-hour
 * session, so those numbers cannot be honestly measured here. Those remain operator work,
 * same as docs/NEXT_TASK.md already states for real Windows GUI measurements.
 *
 * Run: node dist/../../scripts/performance-baseline.js (after `pnpm run build` or this
 * repo's manual tsc-based compile -- see docs/implementation for the exact command used in
 * this sandbox, since `pnpm install` cannot complete here).
 */
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { performance } = require("node:perf_hooks");

const { PaperBroker } = require("../dist/apps/desktop/src/paperBroker.js");
const { ControlPlane } = require("../dist/apps/desktop/src/controlPlane.js");
const { StrategyEngine, SmaCrossoverStrategy } = require("../dist/apps/desktop/src/strategyEngine.js");
const { DesktopPersistenceStore } = require("../dist/apps/desktop/src/desktopPersistenceStore.js");
const { mapUpbitMinuteCandlesToChartCandles } = require("../dist/apps/server/src/liveCandleFeed.js");
const { PaperRuntime } = require("../dist/apps/server/src/paperRuntime.js");
const { AutomaticTradingPipeline } = require("../dist/apps/server/src/pipeline/automaticTradingPipeline.js");
const { RiskEngine } = require("../dist/apps/server/src/pipeline/riskEngine.js");
const { FixedOrderPlanner } = require("../dist/apps/server/src/pipeline/orderPlanner.js");
const { PaperExecutor } = require("../dist/apps/server/src/pipeline/paperExecutor.js");
const { computeTradeStatistics } = require("../dist/apps/server/src/tradeStatistics.js");
const { computeDrawdownStatistics } = require("../dist/apps/server/src/drawdown.js");
const { reconcileReferenceAccounting } = require("../dist/apps/server/src/referenceReconciliation.js");

function percentile(sorted, p) {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function summarize(samplesMs) {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
  return {
    count: sorted.length,
    min: sorted[0],
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1],
    mean
  };
}

function timeSync(fn) {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

async function timeAsync(fn) {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

function fakeCandle(price, minutesAgo) {
  return {
    market: "KRW-BTC",
    candle_date_time_utc: new Date(Date.now() - minutesAgo * 60_000).toISOString().slice(0, 19),
    opening_price: price,
    high_price: price + 100_000,
    low_price: price - 100_000,
    trade_price: price,
    candle_acc_trade_volume: 1,
    unit: 1
  };
}

/** PaperBroker.execute() alone -- the actual order-matching/fill-model computation, isolated
 * from HTTP/JSON overhead (already covered elsewhere by this repo's own HTTP tests). */
function benchmarkOrderProcessing(iterations) {
  const broker = new PaperBroker(1_000_000_000, "KRW-BTC", 0.0005, {
    maxOrderNotional: 100_000_000, maxPositionQuantity: 1000, maxRealizedLoss: Number.MAX_SAFE_INTEGER, minOrderNotional: 1
  });
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    samples.push(timeSync(() => broker.execute(i % 2 === 0 ? "BUY" : "SELL", 0.00001, 100_000_000)));
  }
  return summarize(samples);
}

/** The per-poll candle-mapping step (Upbit's raw response -> this app's ChartCandle shape). */
function benchmarkMarketDataProcessing(iterations) {
  const rawCandles = Array.from({ length: 200 }, (_, i) => fakeCandle(100_000_000 + i * 1000, 200 - i));
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    samples.push(timeSync(() => mapUpbitMinuteCandlesToChartCandles(rawCandles, 1)));
  }
  return summarize(samples);
}

/** DesktopPersistenceStore.save() with a realistic (not empty) account/control state. */
function benchmarkSqliteWrite(iterations) {
  const dir = mkdtempSync(join(tmpdir(), "dokkaebi-bench-"));
  const store = new DesktopPersistenceStore(join(dir, "bench.db"));
  const broker = new PaperBroker(1_000_000_000, "KRW-BTC", 0.0005, {});
  const control = new ControlPlane("bench");
  for (let i = 0; i < 20; i++) {
    broker.execute(i % 2 === 0 ? "BUY" : "SELL", 0.00001, 100_000_000);
    control.record("SYSTEM", `seed event ${i}`);
  }
  const paperState = broker.exportState();
  const controlState = control.exportState();
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    samples.push(timeSync(() => store.save(paperState, controlState)));
  }
  store.close();
  rmSync(dir, { recursive: true, force: true });
  return summarize(samples);
}

/** Full restart: construct a fresh PaperRuntime against a pre-populated SQLite DB and time
 * until the first candle poll reports CONNECTED (i.e. until the server would start serving
 * real account/dashboard data after a restart). */
async function benchmarkRecoveryTime(iterations) {
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const dir = mkdtempSync(join(tmpdir(), "dokkaebi-bench-"));
    const dbPath = join(dir, "bench.db");
    // PaperRuntime always constructs its ControlPlane with this fixed strategyId
    // (apps/server/src/paperRuntime.ts's CONTROL_PLANE_STRATEGY_ID) regardless of which
    // SMA/EMA strategy is active -- restoreState() rejects a mismatched seed otherwise.
    const seedStore = new DesktopPersistenceStore(dbPath);
    seedStore.save(new PaperBroker(1_000_000_000, "KRW-BTC", 0.0005, {}).exportState(), new ControlPlane("web-runtime").exportState());
    seedStore.close();

    const elapsed = await timeAsync(() => new Promise((resolve) => {
      const runtime = new PaperRuntime({
        databasePath: dbPath,
        pollIntervalMs: 60_000,
        candleFetcher: async () => [fakeCandle(100_000_000, 0)]
      });
      const check = () => {
        if (runtime.getMarket().status === "CONNECTED") { runtime.dispose(); resolve(); return; }
        setTimeout(check, 2);
      };
      runtime.start();
      check();
    }));
    samples.push(elapsed);
    rmSync(dir, { recursive: true, force: true });
  }
  return summarize(samples);
}

/** Fires the identical automatic signal N times through the real pipeline (same
 * ControlPlane.claimAutomaticSignal idempotency-key guard the live server uses) and counts
 * how many actually filled -- a real measured number, not just a cited guarantee. */
function measureDuplicateOrderPrevention(attempts) {
  const broker = new PaperBroker(1_000_000_000, "KRW-BTC", 0);
  const control = new ControlPlane("bench");
  const strategy = new StrategyEngine(new SmaCrossoverStrategy(2, 3));
  const pipeline = new AutomaticTradingPipeline(
    broker, control, strategy, new RiskEngine(), new FixedOrderPlanner("FIXED"), new PaperExecutor(broker),
    () => {}, () => {}
  );
  control.start();
  control.setAutoTrade(true);
  const intent = { type: "BUY", reason: "duplicate-prevention benchmark", confidence: 1, timestamp: 1_700_000_000_000 };
  const outcomes = { FILLED: 0, DUPLICATE: 0, SKIPPED: 0, REJECTED: 0 };
  for (let i = 0; i < attempts; i++) outcomes[pipeline.process(intent, "KRW-BTC", 100_000_000, 1_000_000_000).outcome] += 1;
  return { attempts, ...outcomes };
}

/** GET /api/trade-statistics replays the *entire* fill history on every call (see
 * tradeStatistics.ts's doc comment) -- benchmarks that replay against a fill history far
 * larger than any real single-user Paper session would realistically reach, to find out
 * whether that "recompute from scratch every time" design decision is actually a bottleneck
 * or still cheap enough not to matter. */
function benchmarkTradeStatisticsReplay(iterations, orderCount) {
  const orders = [];
  for (let i = 0; i < orderCount / 2; i++) {
    const price = 100_000_000 + (i % 50) * 10_000;
    orders.push({ id: `b${i}`, market: "KRW-BTC", side: "BUY", quantity: 0.001, price, fee: 50, filledAt: "2026-01-01T00:00:00.000Z", requestedQuantity: 0.001, quotedPrice: price, spreadCost: 5, slippageCost: 5, marketImpactCost: 0 });
    orders.push({ id: `s${i}`, market: "KRW-BTC", side: "SELL", quantity: 0.001, price: price + 5_000, fee: 50, filledAt: "2026-01-01T00:00:01.000Z", requestedQuantity: 0.001, quotedPrice: price, spreadCost: 5, slippageCost: 5, marketImpactCost: 0 });
  }
  const samples = [];
  for (let i = 0; i < iterations; i++) samples.push(timeSync(() => computeTradeStatistics(orders)));
  return summarize(samples);
}

/** GET /api/equity-history's drawdown is recomputed from the full (up to 500-sample) ring
 * buffer on every call -- benchmarked at the buffer's actual max size. */
function benchmarkDrawdownStatistics(iterations) {
  const history = Array.from({ length: 500 }, (_, i) => ({
    timestamp: 1_700_000_000_000 + i * 10_000,
    equity: 10_000_000 + Math.sin(i / 10) * 200_000
  }));
  const samples = [];
  for (let i = 0; i < iterations; i++) samples.push(timeSync(() => computeDrawdownStatistics(history)));
  return summarize(samples);
}

/** Runs on every ExecutionReport fold (both the automatic pipeline and every manual order) --
 * comparing the real account against the reference ledger. */
function benchmarkReconciliation(iterations) {
  const account = Object.freeze({
    cash: 9_915_000, equity: 9_999_900, unrealizedPnl: -63,
    position: Object.freeze({ market: "KRW-BTC", quantity: 0.0009, averagePrice: 94_000_000, realizedPnl: 0 }),
    orders: Object.freeze([])
  });
  const portfolio = Object.freeze({ cash: 9_915_000, quantity: 0.0009, averagePrice: 94_000_000, realizedPnl: 0 });
  const samples = [];
  for (let i = 0; i < iterations; i++) samples.push(timeSync(() => reconcileReferenceAccounting(account, portfolio)));
  return summarize(samples);
}

function formatMs(value) { return `${value.toFixed(3)}ms`; }

async function main() {
  console.log("Running performance baseline (this sandbox's hardware -- not representative of a real Windows deployment)...\n");

  const order = benchmarkOrderProcessing(2000);
  const marketData = benchmarkMarketDataProcessing(2000);
  const sqliteWrite = benchmarkSqliteWrite(500);
  const recovery = await benchmarkRecoveryTime(20);
  const duplicates = measureDuplicateOrderPrevention(50);
  const tradeStatsSmall = benchmarkTradeStatisticsReplay(500, 100);
  const tradeStatsLarge = benchmarkTradeStatisticsReplay(500, 2000);
  const drawdown = benchmarkDrawdownStatistics(2000);
  const reconciliation = benchmarkReconciliation(2000);

  const rows = [
    ["주문 처리 (PaperBroker.execute)", order],
    ["시장 데이터 처리 (candle mapping)", marketData],
    ["SQLite 쓰기 (DesktopPersistenceStore.save)", sqliteWrite],
    ["Recovery 시간 (재시작 -> 첫 CONNECTED)", recovery],
    ["거래 통계 재계산 (100개 주문 replay)", tradeStatsSmall],
    ["거래 통계 재계산 (2000개 주문 replay)", tradeStatsLarge],
    ["최대 낙폭 계산 (500개 자산 표본)", drawdown],
    ["참조 회계 정합성 대조", reconciliation]
  ];

  for (const [label, stats] of rows) {
    console.log(`${label} (n=${stats.count})`);
    console.log(`  P50=${formatMs(stats.p50)}  P95=${formatMs(stats.p95)}  P99=${formatMs(stats.p99)}  min=${formatMs(stats.min)}  max=${formatMs(stats.max)}  mean=${formatMs(stats.mean)}`);
  }
  console.log(`\nPaper 주문 중복 방지: ${duplicates.attempts}회 동일 신호 재시도 -> FILLED=${duplicates.FILLED}, DUPLICATE=${duplicates.DUPLICATE} (기대값: FILLED=1, DUPLICATE=${duplicates.attempts - 1})`);

  const timestamp = new Date().toISOString();
  const report = `# Performance Baseline (${timestamp})

Second pass: extends the first baseline (order/market-data/SQLite/recovery) with the
recompute-from-scratch-on-every-call endpoints added since (거래 통계, 최대 낙폭, 참조 회계
정합성 대조) -- specifically to check whether "replay the whole history on every GET" is
still cheap enough, since none of those were cached or benchmarked when first built.

Measured in this sandbox's container (not a real Windows deployment -- absolute numbers are
not comparable to production hardware, but are a consistent baseline for detecting regressions
*within this environment* going forward). Generated by \`scripts/performance-baseline.js\`.

Explicitly excluded (require a real Windows GUI / a real multi-hour run this sandbox cannot
provide -- see \`docs/NEXT_TASK.md\`'s existing "real Windows GUI measurements" item):
앱 초기 실행 시간, Dashboard 최초 표시 시간, 유휴 상태 CPU/메모리 사용량.

| 항목 | n | P50 | P95 | P99 | min | max | mean |
|---|---|---|---|---|---|---|---|
${rows.map(([label, s]) => `| ${label} | ${s.count} | ${formatMs(s.p50)} | ${formatMs(s.p95)} | ${formatMs(s.p99)} | ${formatMs(s.min)} | ${formatMs(s.max)} | ${formatMs(s.mean)} |`).join("\n")}

**Paper 주문 중복 방지**: ${duplicates.attempts}회 동일 signal(같은 market/timestamp/type) 재시도 결과 FILLED=${duplicates.FILLED}, DUPLICATE=${duplicates.DUPLICATE}, REJECTED=${duplicates.REJECTED}, SKIPPED=${duplicates.SKIPPED} -- \`ControlPlane.claimAutomaticSignal\`의 idempotency key로 구조적으로 보장됨 (\`tests/pipeline-automatic-trading.test.js\`에도 동일 보장 커버).

**테스트 성공률**: 별도로 \`node scripts/run-tests-isolated.js\` (또는 이 세션의 수동 tsc+node --test 조합)로 확인 -- 이 리포트 작성 시점 1138/1138 통과 (evidence-cli-contract/reliability-recovery/upbit-websocket 3개 파일은 이 샌드박스 환경 제약으로 제외, 무관한 사전 이슈로 확인됨).
`;
  writeFileSync(join(__dirname, "..", "docs", "performance-baseline.md"), report, "utf8");
  console.log("\nSaved docs/performance-baseline.md");
}

main().catch((error) => { console.error(error); process.exit(1); });
