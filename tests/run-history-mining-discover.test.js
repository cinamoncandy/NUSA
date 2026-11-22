"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { makeRandom } = require("../scripts/run-crossmarket-study.js");
const wrapper = require("../scripts/run-history-mining-discover.js");

const H = 3_600_000; const M = 60_000; const DAY = 24 * H;
const CUT = Date.parse("2026-11-20T00:00:00Z");
const SCRIPT = path.join(__dirname, "..", "scripts", "run-history-mining-discover.js");
const iso = (t) => new Date(t).toISOString();
const good = { discoveryStart: iso(CUT - 50 * DAY), discoveryEnd: iso(CUT - 20 * DAY), holdbackStart: iso(CUT - 15 * DAY), holdbackEnd: iso(CUT - H) };

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "hm-wiring-")); }
function capture(fn) { const lines = []; const code = fn((l) => lines.push(l)); return { code, lines }; }

test("the committed config holds the four windows chosen from the 2026-11-21 candle_extent counts and passes the strict validation", () => {
  assert.equal(path.relative(path.join(__dirname, ".."), wrapper.CONFIG_FILE), path.join("deploy", "oracle", "history-mining-windows.json"));
  const text = fs.readFileSync(wrapper.CONFIG_FILE, "utf8");
  const { iso, ms } = wrapper.parseConfig(text);
  assert.deepEqual(iso, { discoveryStart: "2026-10-08T00:00:00.000Z", discoveryEnd: "2026-10-26T00:00:00.000Z", holdbackStart: "2026-10-30T00:00:00.000Z", holdbackEnd: "2026-11-19T23:00:00.000Z" });
  assert.ok(ms.holdbackStart - ms.discoveryEnd >= 96 * H, "purge of at least 96 hours");
  assert.ok(ms.holdbackEnd <= CUT, "the hold-back ends before the reserved cut");
  assert.ok(ms.discoveryStart >= Date.parse("2026-10-07T08:05:00Z"), "discovery starts after the first candle of every blind market (candle_extent 2026-11-22: first close 2026-10-07 08:05Z at the latest)");
});

test("absent config: prints exactly WAITING_CONFIG and never opens a database or spawns anything", () => {
  const dir = tmp();
  let spawned = 0;
  const { code, lines } = capture((log) => wrapper.run({ configPath: path.join(dir, "missing.json"), env: { NUSA_CLOUD_STATE_DB_PATH: path.join(dir, "no.sqlite") }, log, spawnSync: () => { spawned += 1; return { status: 0 }; } }));
  assert.equal(code, 0); assert.equal(spawned, 0);
  assert.deepEqual(lines, ['HISTORY_MINING_DISCOVER {"status":"WAITING_CONFIG"}']);
  // end to end as a process: no database file exists and none is created
  const r = spawnSync(process.execPath, ["-e", `process.exitCode=require(${JSON.stringify(SCRIPT)}).run({configPath:${JSON.stringify(path.join(dir, "missing.json"))}})`], { encoding: "utf8", env: { ...process.env, NUSA_CLOUD_STATE_DB_PATH: path.join(dir, "no.sqlite") } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'HISTORY_MINING_DISCOVER {"status":"WAITING_CONFIG"}');
  assert.equal(fs.existsSync(path.join(dir, "no.sqlite")), false);
});

test("invalid configs fail closed and spawn nothing", () => {
  const dir = tmp();
  const bad = [
    "not json", "[]", "null", JSON.stringify({ ...good, extra: "x" }),
    JSON.stringify({ ...good, holdbackEnd: undefined }),
    JSON.stringify({ ...good, discoveryStart: "2026-10-01" }),
    JSON.stringify({ ...good, discoveryStart: "2026-10-01T00:30:00Z" }),
    JSON.stringify({ ...good, discoveryStart: "2026-10-01T00:00:00+09:00" }),
    JSON.stringify({ ...good, discoveryStart: "2026-02-31T00:00:00Z" }),
    JSON.stringify({ ...good, discoveryStart: 5 }),
    JSON.stringify({ ...good, holdbackStart: iso(CUT - 22 * DAY) }), // purge shorter than 96 h
    JSON.stringify({ ...good, discoveryEnd: good.discoveryStart }), // not ordered
    JSON.stringify({ ...good, holdbackEnd: iso(CUT + H) }), // reaches into the reserved span
  ];
  for (const text of bad) {
    const file = path.join(dir, "cfg.json"); fs.writeFileSync(file, text);
    let spawned = 0;
    assert.throws(() => wrapper.run({ configPath: file, env: { NUSA_CLOUD_STATE_DB_PATH: path.join(dir, "x.sqlite") }, log: () => {}, spawnSync: () => { spawned += 1; return { status: 0 }; } }), Error, text);
    assert.equal(spawned, 0, text);
    const r = spawnSync(process.execPath, ["-e", `process.env.X=1;const w=require(${JSON.stringify(SCRIPT)});try{w.run({configPath:${JSON.stringify(file)},log(){}})}catch{process.exit(1)}`], { encoding: "utf8" });
    assert.equal(r.status, 1, text);
  }
  assert.doesNotThrow(() => wrapper.parseConfig(JSON.stringify(good)));
});

test("a relative or missing state path fails closed", () => {
  const dir = tmp(); const file = path.join(dir, "cfg.json"); fs.writeFileSync(file, JSON.stringify(good));
  assert.throws(() => wrapper.run({ configPath: file, env: { NUSA_CLOUD_STATE_DB_PATH: "state.sqlite" }, log: () => {}, spawnSync: () => ({ status: 0 }) }));
  assert.throws(() => wrapper.run({ configPath: file, env: {}, log: () => {}, spawnSync: () => ({ status: 0 }) }));
});

test("valid config: spawns only the discover phase with the four windows; a failing child exits non-zero", () => {
  const dir = tmp(); const file = path.join(dir, "cfg.json"); fs.writeFileSync(file, JSON.stringify(good));
  let seen;
  const code = wrapper.run({ configPath: file, env: { NUSA_CLOUD_STATE_DB_PATH: path.join(dir, "s.sqlite") }, log: () => {}, spawnSync: (exe, args, opts) => { seen = { args, opts }; return { status: 0 }; } });
  assert.equal(code, 0);
  assert.equal(seen.args[0], "--max-old-space-size=256", "the child is bounded like the other research children");
  assert.equal(path.basename(seen.args[1]), "run-history-mining.js");
  assert.equal(seen.args[2], "discover");
  assert.ok(!seen.args.includes("look") && !seen.args.includes("--freeze"));
  assert.deepEqual(seen.args.slice(3), ["--db", path.join(dir, "s.sqlite"), "--discovery-start", good.discoveryStart, "--discovery-end", good.discoveryEnd, "--holdback-start", good.holdbackStart, "--holdback-end", good.holdbackEnd]);
  assert.equal(seen.opts.shell, false); assert.ok(seen.opts.timeout <= 280000);
  for (const failure of [{ status: 2 }, { error: { code: "ETIMEDOUT" } }, { signal: "SIGTERM", status: null }]) {
    assert.equal(wrapper.run({ configPath: file, env: { NUSA_CLOUD_STATE_DB_PATH: path.join(dir, "s.sqlite") }, log: () => {}, spawnSync: () => failure }), 1);
  }
});

test("valid config on a synthetic sqlite file runs discover end to end (read-only)", () => {
  const dir = tmp(); const dbFile = path.join(dir, "state.sqlite"); const cfg = path.join(dir, "cfg.json");
  const db = new DatabaseSync(dbFile);
  db.exec("CREATE TABLE research_closed_candles (market TEXT, interval_ms INTEGER, close_time_ms INTEGER, close REAL, volume REAL, PRIMARY KEY(market, interval_ms, close_time_ms))");
  const insert = db.prepare("INSERT INTO research_closed_candles(market, interval_ms, close_time_ms, close, volume) VALUES (?,?,?,?,?)");
  // One transaction: 7,200 single-row commits are very slow on a Windows runner (each commit syncs the file) and timed the CI test step out.
  db.exec("BEGIN");
  ["KRW-BTC", "KRW-DOGE", "KRW-ETH", "KRW-SOL", "KRW-XRP"].forEach((market, i) => {
    const random = makeRandom(7 + i); let price = 1000;
    for (let t = CUT - 60 * DAY; t < CUT; t += H) { price *= 1 + 0.005 * (random() - 0.5); insert.run(market, M, t, price, 1); }
  });
  db.exec("COMMIT");
  db.close();
  fs.writeFileSync(cfg, JSON.stringify(good));
  const code = `process.exitCode=require(${JSON.stringify(SCRIPT)}).run({configPath:${JSON.stringify(cfg)}})`;
  const r = spawnSync(process.execPath, ["-e", code], { encoding: "utf8", env: { ...process.env, NUSA_CLOUD_STATE_DB_PATH: dbFile }, timeout: 120000 });
  assert.equal(r.status, 0, r.stderr);
  const line = r.stdout.split("\n").find((l) => l.startsWith("HISTORY_MINING_DISCOVER "));
  assert.ok(line, r.stdout);
  const v = JSON.parse(line.slice("HISTORY_MINING_DISCOVER ".length));
  assert.ok(["SHORTLIST", "NO_SHORTLIST"].includes(v.status), v.status);
  assert.equal(v.trials, 128);
  assert.match(v.gridFingerprint, /^[0-9a-f]{64}$/);
  assert.ok(!r.stdout.includes("HISTORY_MINING_LOOK"));
});

test("source pin: the wrapper and the runner never invoke the look phase", () => {
  for (const file of ["scripts/run-history-mining-discover.js", "scripts/run-cloud-research-snapshot.js"]) {
    const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    assert.doesNotMatch(source, /["']look["']/, file);
    assert.doesNotMatch(source, /--freeze/, file);
  }
  const w = fs.readFileSync(SCRIPT, "utf8");
  assert.match(w, /"discover"/);
});

test("a repeated key in the config is refused, also in an escaped spelling (JSON.parse would keep the last value)", () => {
  const dup = '{"discoveryStart":"2026-09-01T00:00:00Z","discoveryStart":"2026-10-01T00:00:00Z","discoveryEnd":"2026-10-31T00:00:00Z","holdbackStart":"2026-11-04T00:00:00Z","holdbackEnd":"2026-11-19T23:00:00Z"}';
  assert.throws(() => wrapper.parseConfig(dup), /repeated key/);
  assert.throws(() => wrapper.parseConfig(dup.replace('"discoveryStart":"2026-10', '"discovery\\u0053tart":"2026-10')), /repeated key|must have exactly/);
  assert.doesNotThrow(() => wrapper.parseConfig(JSON.stringify(good)));
});
