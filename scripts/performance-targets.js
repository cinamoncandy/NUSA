/**
 * Measures this codebase against DOKKAEBI.md's four named performance targets:
 * Dashboard < 1s, API < 200ms, Kill Switch < 500ms, Recovery < 60s.
 *
 * Unlike scripts/performance-baseline.js (which times individual in-process functions,
 * isolated from HTTP/JSON overhead), this script measures real over-the-wire HTTP round
 * trips against a real createPaperTradingHttpServer instance listening on localhost --
 * the actual thing an operator's browser or phone experiences, including JSON
 * serialization, node:http overhead, and (for "Dashboard") the exact sequential fetch
 * sequence apps/web/app.js's refresh() performs on every load/poll.
 *
 * Measured in this sandbox's container (not a real Windows deployment or real network to
 * a phone over LAN) -- absolute numbers are a baseline for this environment, not a
 * production guarantee. Explicitly excluded, same as performance-baseline.js: real
 * browser paint/render time, real network latency to a phone.
 *
 * Run: node scripts/performance-targets.js (after this repo's manual tsc-based compile).
 */
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { performance } = require("node:perf_hooks");
const http = require("node:http");

const { createPaperTradingHttpServer } = require("../dist/apps/server/src/httpServer.js");
const { PaperRuntime } = require("../dist/apps/server/src/paperRuntime.js");

function fakeCandle(price) {
  return {
    market: "KRW-BTC",
    candle_date_time_utc: new Date().toISOString().slice(0, 19),
    opening_price: price,
    high_price: price + 100_000,
    low_price: price - 100_000,
    trade_price: price,
    candle_acc_trade_volume: 1,
    unit: 1
  };
}

function percentile(sorted, p) {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function summarize(samplesMs) {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
  return { count: sorted.length, min: sorted[0], p50: percentile(sorted, 50), p95: percentile(sorted, 95), p99: percentile(sorted, 99), max: sorted[sorted.length - 1], mean };
}

function formatMs(value) { return `${value.toFixed(3)}ms`; }

function request(base, path, method = "GET", body) {
  return new Promise((resolveRequest, rejectRequest) => {
    const start = performance.now();
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const url = new URL(path, base);
    const req = http.request(url, {
      method,
      headers: payload ? { "content-type": "application/json", "content-length": payload.length } : {}
    }, (res) => {
      res.on("data", () => {});
      res.on("end", () => resolveRequest(performance.now() - start));
    });
    req.on("error", rejectRequest);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Exactly the sequence apps/web/app.js's refresh() performs, in the same order, awaited
 * one at a time (refresh() is fully sequential, not Promise.all) -- so this measures the
 * real wall-clock time an operator's dashboard takes to finish loading, not a
 * best-case parallelized version of it. */
async function measureDashboardLoad(base, iterations) {
  const sequence = [
    "/api/market", "/api/chart/candles", "/api/equity-history", "/api/control",
    "/api/position-protection", "/api/limit-orders", "/api/position-sizing",
    "/api/strategy/periods", "/api/notifications", "/api/account", "/api/dashboard",
    "/api/reference-accounting", "/api/trade-statistics", "/api/champion"
  ];
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    for (const path of sequence) await request(base, path);
    samples.push(performance.now() - start);
  }
  return summarize(samples);
}

async function measureApiLatency(base, iterations) {
  const samples = [];
  for (let i = 0; i < iterations; i++) samples.push(await request(base, "/api/health"));
  return summarize(samples);
}

/** POST /api/strategy/stop (the Kill Switch's real HTTP entry point -- ControlPlane.stop(),
 * see DOKKAEBI.md's Kill Switch section) round trip, alternating with /api/strategy/start
 * so each stop measured is a real STOPPED-to-... transition, not a no-op repeat. */
async function measureKillSwitch(base, iterations) {
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    await request(base, "/api/strategy/start", "POST");
    samples.push(await request(base, "/api/strategy/stop", "POST"));
  }
  return summarize(samples);
}

/** Full real-server restart: listen a fresh createPaperTradingHttpServer against a
 * pre-populated SQLite DB and time until GET /api/market first reports CONNECTED over
 * real HTTP -- i.e. until the server would actually be ready to serve a reconnecting
 * operator after a crash/restart. */
async function measureRecoveryTime(iterations) {
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const dir = mkdtempSync(join(tmpdir(), "dokkaebi-recovery-"));
    const runtime = new PaperRuntime({ databasePath: join(dir, "bench.db"), pollIntervalMs: 60_000, candleFetcher: async () => [fakeCandle(100_000_000)] });
    const server = createPaperTradingHttpServer(runtime, dir);
    await new Promise((resolveListen) => server.listen(0, resolveListen));
    const base = `http://127.0.0.1:${server.address().port}`;
    const start = performance.now();
    runtime.start();
    let connected = false;
    while (!connected) {
      const market = await (await fetch(`${base}/api/market`)).json();
      if (market.status === "CONNECTED") connected = true;
      else await new Promise((r) => setTimeout(r, 5));
    }
    samples.push(performance.now() - start);
    runtime.dispose();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
  return summarize(samples);
}

async function withServer(run) {
  const dir = mkdtempSync(join(tmpdir(), "dokkaebi-perf-targets-"));
  const runtime = new PaperRuntime({ databasePath: join(dir, "bench.db"), pollIntervalMs: 60_000, candleFetcher: async () => [fakeCandle(100_000_000)] });
  const server = createPaperTradingHttpServer(runtime, dir);
  await new Promise((resolveListen) => server.listen(0, resolveListen));
  const base = `http://127.0.0.1:${server.address().port}`;
  await new Promise((resolveWarm) => {
    const check = () => (runtime.getMarket().status === "CONNECTED" ? resolveWarm() : setTimeout(check, 5));
    runtime.start();
    check();
  });
  try {
    await run(base);
  } finally {
    runtime.dispose();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  console.log("Measuring against DOKKAEBI.md's four named performance targets (this sandbox's hardware)...\n");

  let dashboard, api, killSwitch;
  await withServer(async (base) => {
    dashboard = await measureDashboardLoad(base, 30);
    api = await measureApiLatency(base, 200);
    killSwitch = await measureKillSwitch(base, 30);
  });
  const recovery = await measureRecoveryTime(20);

  const rows = [
    ["Dashboard (refresh()의 순차 요청 14개 전체)", dashboard, 1000],
    ["API (GET /api/health 단일 왕복)", api, 200],
    ["Kill Switch (POST /api/strategy/stop 왕복)", killSwitch, 500],
    ["Recovery (재시작 -> 첫 CONNECTED, 실제 HTTP)", recovery, 60_000]
  ];

  for (const [label, stats, targetMs] of rows) {
    const pass = stats.p95 < targetMs;
    console.log(`${label} (n=${stats.count}, target P95 < ${targetMs}ms)`);
    console.log(`  P50=${formatMs(stats.p50)}  P95=${formatMs(stats.p95)}  P99=${formatMs(stats.p99)}  max=${formatMs(stats.max)}  -> ${pass ? "PASS" : "FAIL"}`);
  }

  const timestamp = new Date().toISOString();
  const report = `# Performance Targets (${timestamp})

First formal measurement against DOKKAEBI.md's four named performance targets: Dashboard < 1s,
API < 200ms, Kill Switch < 500ms, Recovery < 60s. Unlike \`docs/performance-baseline.md\` (which
times individual in-process functions, isolated from HTTP overhead), this measures real
over-the-wire HTTP round trips against a real \`createPaperTradingHttpServer\` instance listening
on localhost -- the actual request path an operator's browser or phone exercises, including JSON
serialization and \`node:http\` overhead. "Dashboard" replays the exact sequential 14-request
sequence \`apps/web/app.js\`'s \`refresh()\` performs on every load/poll (it is not parallelized),
so this is the real wall-clock wait an operator sees, not a best-case parallel version of it.

Measured in this sandbox's container (not a real Windows deployment, not a real network hop to a
phone over LAN) -- absolute numbers are a baseline for regression detection *within this
environment*, not a production guarantee. Generated by \`scripts/performance-targets.js\`.

| 항목 | n | target (P95) | P50 | P95 | P99 | max | 결과 |
|---|---|---|---|---|---|---|---|
${rows.map(([label, s, target]) => `| ${label} | ${s.count} | < ${target}ms | ${formatMs(s.p50)} | ${formatMs(s.p95)} | ${formatMs(s.p99)} | ${formatMs(s.max)} | ${s.p95 < target ? "PASS" : "FAIL"} |`).join("\n")}

Excluded, same as \`docs/performance-baseline.md\`: real browser paint/render time (Playwright
sessions during development have not shown visible lag, but that is not a formal measurement),
real network latency to a phone over LAN/WAN.
`;
  writeFileSync(join(__dirname, "..", "docs", "performance-targets.md"), report, "utf8");
  console.log("\nSaved docs/performance-targets.md");
}

main().catch((error) => { console.error(error); process.exit(1); });
