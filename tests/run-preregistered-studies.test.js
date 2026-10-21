const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { runAll, makeDbProvider, bookSource } = require("../scripts/run-preregistered-studies.js");

function memoryDb(rows) {
  // A tiny stand-in for node:sqlite's DatabaseSync that understands the runner's five queries over an array of rows.
  const out = (r) => ({ t: r.captured_at_ms, b: r.best_bid, a: r.best_ask, b5: r.bid_size_5, a5: r.ask_size_5 });
  return {
    prepare(sql) {
      if (/sqlite_master/.test(sql)) return { get: () => undefined };
      if (/COUNT\(\*\)/.test(sql)) return { get: (limit) => ({ n: rows.filter((r) => r.captured_at_ms > limit).length }) };
      if (/DISTINCT market/.test(sql)) return { all: (from, to) => [...new Set(rows.filter((r) => r.captured_at_ms > from && r.captured_at_ms <= to && r.market.startsWith("KRW-")).map((r) => r.market))].map((market) => ({ market })) };
      const pick = (m, f) => rows.filter((r) => r.market === m && f(r.captured_at_ms)).sort((x, y) => x.captured_at_ms - y.captured_at_ms);
      if (/LIMIT 1/.test(sql)) {
        const open = /captured_at_ms > \? AND captured_at_ms <= \?/.test(sql);
        return { get: (m, from, to) => { const r = pick(m, (t) => (open ? t > from : t >= from) && t <= to).pop(); return r == null ? undefined : out(r); } };
      }
      return { all: (m, from, to) => pick(m, (t) => t >= from && t < to).map(out) };
    },
  };
}
const row = (market, t, bid, ask) => ({ market, captured_at_ms: t, best_bid: bid, best_ask: ask, bid_size_5: 1.2, ask_size_5: 1 });

test("before the print time both studies report WAITING_DATA and read nothing", () => {
  const out = runAll({ db: memoryDb([]), now: Date.parse("2026-12-01T00:00:00Z") });
  assert.deepEqual(out.map((r) => [r.study, r.status]), [["S2", "WAITING_DATA"], ["S3", "WAITING_DATA"], ["S4", "WAITING_DATA"]]);
});

test("a row stamped after the run time fails closed as DATA_FUTURE", () => {
  const now = Date.parse("2026-12-06T00:00:00Z");
  const out = runAll({ db: memoryDb([row("KRW-A", now + 60_000, 100, 101)]), now });
  assert.ok(out.every((r) => r.status === "DATA_INTEGRITY_FAIL" && r.reasonCode === "DATA_FUTURE"));
});

test("the provider follows the (t - 2 min, t] book rule, ignores crossed books and finds the last bid before an exit", () => {
  const T = Date.parse("2026-11-10T00:00:00Z");
  const db = memoryDb([row("KRW-A", T - 30_000, 100, 101), row("KRW-A", T - 3 * 60_000, 99, 100), row("KRW-B", T - 30_000, 101, 100), row("KRW-A", T - 40 * 60_000, 98, 99)]);
  const p = makeDbProvider(db, { from: T - 6 * 3_600_000, to: T + 3_600_000 });
  assert.deepEqual(p.markets(), ["KRW-A", "KRW-B"]);
  assert.equal(p.bookAt("KRW-A", T).b, 100);
  assert.equal(p.bookAt("KRW-A", T - 100_000).b, 99, "a snapshot 100 s before is inside (t - 2 min, t] even though a later one exists in the same minute window: full resolution, no per-minute loss");
  assert.equal(p.bookAt("KRW-A", T - 60_000), undefined, "the T-30s row is after that time and the T-3min row is outside (t - 2 min, t]");
  assert.equal(p.bookAt("KRW-B", T), undefined, "a crossed book is not a book");
  assert.equal(p.lastBidBetween("KRW-A", T - 3_600_000, T), 100);
  assert.equal(p.lastBidBetween("KRW-A", T + 1, T + 3_600_000), undefined);
  assert.deepEqual(p.booksBetween("KRW-A", T - 41 * 60_000, T).map((x) => x.t), [T - 40 * 60_000, T - 3 * 60_000, T - 30_000], "snapshots with from <= t < to, crossed books skipped");
  assert.deepEqual(p.booksBetween("KRW-B", T - 41 * 60_000, T), []);
  assert.ok(p.hashRows().rows >= 3, "every usable row that was actually read is hashed, the crossed one is not");
  assert.equal(p.hashRows().sha256.length, 64);
});

test("the runner opens the database read-only, writes no file and only prints result lines", () => {
  const src = fs.readFileSync("scripts/run-preregistered-studies.js", "utf8");
  assert.match(src, /new DatabaseSync\(path, \{ readOnly: true \}\)/);
  assert.doesNotMatch(src, /SELECT[^;]*FROM research_orderbook_samples WHERE market = \? AND captured_at_ms > \? AND captured_at_ms <= \? ORDER BY captured_at_ms"\);\n    const series|series = new Map/, "no whole-window load per market");
  assert.doesNotMatch(src, /writeFileSync|appendFileSync|createWriteStream|INSERT|UPDATE|DELETE/);
  assert.match(src, /PREREG_STUDY_FAILED_CLOSED/);
});

test("with the real node:sqlite engine the provider reads the live table and the archive as one source, by index", () => {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(":memory:");
  const cols = "market TEXT NOT NULL, captured_at_ms INTEGER NOT NULL, best_bid REAL NOT NULL, best_ask REAL NOT NULL, bid_size_5 REAL NOT NULL, ask_size_5 REAL NOT NULL, total_bid_size REAL NOT NULL, total_ask_size REAL NOT NULL, PRIMARY KEY (market, captured_at_ms)";
  db.exec(`CREATE TABLE research_orderbook_samples (${cols}); CREATE TABLE research_orderbook_study_rows (${cols}) WITHOUT ROWID;`);
  const T = Date.parse("2026-10-20T00:00:00Z"), OLD = Date.parse("2026-10-16T00:00:00Z");
  const put = (table, market, t, b, a) => db.prepare(`INSERT INTO ${table} VALUES (?, ?, ?, ?, ?, 1, 1, 1)`).run(market, t, b, a, 1);
  put("research_orderbook_samples", "KRW-A", T - 30_000, 100, 101);
  put("research_orderbook_study_rows", "KRW-A", OLD - 30_000, 90, 91);
  put("research_orderbook_study_rows", "KRW-B", OLD - 60_000, 50, 51);
  assert.equal(bookSource(db).includes("UNION ALL"), true);
  const p = makeDbProvider(db, { from: OLD - 3_600_000, to: T + 3_600_000 });
  assert.deepEqual(p.markets(), ["KRW-A", "KRW-B"], "a market that only survives in the archive is still listed");
  assert.equal(p.bookAt("KRW-A", T).b, 100, "a recent book comes from the live table");
  assert.equal(p.bookAt("KRW-A", OLD).b, 90, "an old book comes from the archive");
  assert.equal(p.bookAt("KRW-B", OLD).a, 51);
  assert.equal(p.lastBidBetween("KRW-A", OLD - 3_600_000, OLD), 90);
  assert.deepEqual(p.booksBetween("KRW-A", OLD - 60_000, OLD).map((x) => x.b), [90]);
  assert.equal(p.hashRows().rows, 3, "only rows actually read are hashed, each once");
  const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT captured_at_ms FROM ${bookSource(db)} WHERE market = ? AND captured_at_ms > ? AND captured_at_ms <= ? ORDER BY captured_at_ms DESC LIMIT 1`).all("KRW-A", 1, 2).map((r) => r.detail).join(" ");
  assert.match(plan, /SEARCH research_orderbook_samples USING (COVERING )?INDEX/);
  assert.match(plan, /SEARCH research_orderbook_study_rows USING PRIMARY KEY/);
  const bare = new DatabaseSync(":memory:");
  bare.exec(`CREATE TABLE research_orderbook_samples (${cols});`);
  assert.equal(bookSource(bare), "research_orderbook_samples", "before migration 032 only the live table exists");
});
