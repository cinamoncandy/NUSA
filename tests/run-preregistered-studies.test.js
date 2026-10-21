const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { runAll, makeDbProvider } = require("../scripts/run-preregistered-studies.js");

function memoryDb(rows) {
  // A tiny stand-in for node:sqlite's DatabaseSync (prepare().all/get/iterate) over an array of rows.
  return {
    prepare(sql) {
      if (/COUNT\(\*\)/.test(sql)) return { get: (limit) => ({ n: rows.filter((r) => r.captured_at_ms > limit).length }) };
      if (/DISTINCT market/.test(sql)) return { all: (from, to) => [...new Set(rows.filter((r) => r.captured_at_ms > from && r.captured_at_ms <= to).map((r) => r.market))].map((market) => ({ market })) };
      return { iterate: function* (market, from, to) { for (const r of rows.filter((x) => x.market === market && x.captured_at_ms > from && x.captured_at_ms <= to).sort((a, b) => a.captured_at_ms - b.captured_at_ms)) yield { t: r.captured_at_ms, b: r.best_bid, a: r.best_ask, b5: r.bid_size_5, a5: r.ask_size_5 }; } };
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
  assert.equal(p.bookAt("KRW-A", T - 60_000), undefined, "the T-30s row is after that time and the T-3min row is outside (t - 2 min, t]");
  assert.equal(p.bookAt("KRW-B", T), undefined, "a crossed book is not a book");
  assert.equal(p.lastBidBetween("KRW-A", T - 3_600_000, T), 100);
  assert.equal(p.lastBidBetween("KRW-A", T + 1, T + 3_600_000), undefined);
  assert.deepEqual(p.booksBetween("KRW-A", T - 41 * 60_000, T).map((x) => x.t), [T - 40 * 60_000, T - 3 * 60_000, T - 30_000], "snapshots with from <= t < to, crossed books skipped");
  assert.deepEqual(p.booksBetween("KRW-B", T - 41 * 60_000, T), []);
  assert.equal(p.hashRows().rows, 4, "every loaded row is hashed, including the unusable crossed one");
  assert.equal(p.hashRows().sha256.length, 64);
});

test("the runner opens the database read-only, writes no file and only prints result lines", () => {
  const src = fs.readFileSync("scripts/run-preregistered-studies.js", "utf8");
  assert.match(src, /new DatabaseSync\(path, \{ readOnly: true \}\)/);
  assert.doesNotMatch(src, /writeFileSync|appendFileSync|createWriteStream|INSERT|UPDATE|DELETE/);
  assert.match(src, /PREREG_STUDY_FAILED_CLOSED/);
});
