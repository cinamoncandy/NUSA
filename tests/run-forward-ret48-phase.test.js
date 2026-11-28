"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const phase = require("../scripts/run-forward-ret48-phase.js");
const forward = require("../scripts/run-history-mining-forward.js");

const H = 3_600_000;
const SCRIPT = path.join(__dirname, "..", "scripts", "run-forward-ret48-phase.js");
const t0 = (iso) => Date.parse(iso);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "fwd-"));

function makeDb(dir, { from = t0("2026-12-11T00:00:00Z"), to = t0("2027-03-25T00:00:00Z") } = {}) {
  const file = path.join(dir, "state.sqlite");
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE research_closed_candles (market TEXT NOT NULL, interval_ms INTEGER NOT NULL, close_time_ms INTEGER NOT NULL, open REAL, high REAL, low REAL, close REAL NOT NULL, checksum TEXT, volume REAL, PRIMARY KEY (market, interval_ms, close_time_ms))");
  const ins = db.prepare("INSERT INTO research_closed_candles (market, interval_ms, close_time_ms, open, high, low, close, checksum, volume) VALUES (?,?,?,?,?,?,?,?,?)");
  db.exec("BEGIN");
  let i = 0;
  for (const market of forward.MARKETS) for (let t = from; t < to; t += H) { i += 1; const c = 100 + (i % 17) + 0.25; ins.run(market, 60000, t, c, c, c, c, "x", 1); }
  db.exec("COMMIT"); db.close();
  return file;
}
const capture = () => { const lines = []; return { lines, log: (l) => lines.push(l) }; };

test("no config file: WAITING_CONFIG, and no database is needed or opened", () => {
  const c = capture();
  const code = phase.run({ configPath: path.join(tmp(), "absent.json"), env: {}, now: t0("2027-03-31T01:00:00Z"), log: c.log });
  assert.equal(code, 0); assert.deepEqual(c.lines, [phase.WAITING_CONFIG]);
  assert.equal(fs.existsSync(phase.CONFIG_FILE), false, "the config is absent in the repository by default");
});

test("the config is strict: exactly spanStart, an ISO UTC midnight, not before 2026-12-11, no repeated key", () => {
  assert.equal(phase.parseConfig('{"spanStart":"2026-12-11T00:00:00Z"}'), t0("2026-12-11T00:00:00Z"));
  assert.equal(phase.parseConfig('{"spanStart":"2026-12-12T00:00:00.000Z"}'), t0("2026-12-12T00:00:00Z"));
  assert.throws(() => phase.parseConfig('{"spanStart":"2027-04-01T00:00:00Z"}'), /after the first quarter end/);
  assert.equal(phase.parseConfig('{"spanStart":"2027-03-31T00:00:00Z"}'), t0("2027-03-31T00:00:00Z"));
  for (const bad of ['{"spanStart":"2026-12-10T00:00:00Z"}', '{"spanStart":"2026-12-11T01:00:00Z"}', '{"spanStart":"2026-12-11"}', '{"spanStart":"2026-12-11T00:00:00Z","x":1}', '{}', '[]', 'null', 'x',
    '{"spanStart":"2026-12-11T00:00:00Z","spanStart":"2026-12-20T00:00:00Z"}', '{"spanStart":"2026-02-30T00:00:00Z"}']) assert.throws(() => phase.parseConfig(bad), undefined, bad);
});

test("the plan follows the calendar: waiting before 2027-03-31, a three day window after each quarter end and after 2028-03-31, otherwise waiting", () => {
  assert.equal(phase.planFor(t0("2027-03-30T23:00:00Z")), "WAIT");
  assert.deepEqual(phase.planFor(t0("2027-03-31T00:00:00Z")), { quarter: t0("2027-03-31T00:00:00Z"), prevAtMs: null });
  assert.deepEqual(phase.planFor(t0("2027-07-02T12:00:00Z")), { quarter: t0("2027-06-30T00:00:00Z"), prevAtMs: t0("2027-03-31T00:00:00Z") });
  assert.deepEqual(phase.planFor(t0("2027-12-31T05:00:00Z")), { quarter: t0("2027-12-31T00:00:00Z"), prevAtMs: t0("2027-09-30T00:00:00Z") });
  assert.deepEqual(phase.planFor(t0("2027-04-06T23:00:00Z")), { quarter: t0("2027-03-31T00:00:00Z"), prevAtMs: null });
  assert.equal(phase.planFor(t0("2027-04-07T00:00:00Z")), "WAIT");
  assert.equal(phase.planFor(t0("2028-01-15T00:00:00Z")), "WAIT");
  assert.equal(phase.planFor(t0("2028-03-31T00:00:00Z")), "DECISION");
  assert.equal(phase.planFor(t0("2028-04-29T23:59:00Z")), "DECISION");
  assert.equal(phase.planFor(t0("2028-04-30T00:00:00Z")), "WAIT");
  assert.equal(forward.DECISION, t0("2028-03-31T00:00:00Z"));
});

test("with a config but before the first quarter end: WAITING_DATE and no database is opened", () => {
  const dir = tmp(); const cfg = path.join(dir, "forward-ret48.json"); fs.writeFileSync(cfg, '{"spanStart":"2026-12-11T00:00:00Z"}');
  const c = capture();
  assert.equal(phase.run({ configPath: cfg, env: {}, now: t0("2026-12-20T00:00:00Z"), log: c.log }), 0);
  assert.deepEqual(c.lines, [phase.WAITING_DATE]);
});

test("a quarter end prints the segment record as numbered chunks (hashes and counts only, no close value), joinable and checkable, read-only", () => {
  const dir = tmp(); const cfg = path.join(dir, "forward-ret48.json"); fs.writeFileSync(cfg, '{"spanStart":"2026-12-11T00:00:00Z"}');
  const dbPath = makeDb(dir); const c = capture();
  assert.equal(phase.run({ configPath: cfg, env: { NUSA_CLOUD_STATE_DB_PATH: dbPath }, now: t0("2027-03-31T02:00:00Z"), log: c.log }), 0);
  assert.ok(c.lines.length >= 2, "the record of a realistic store is longer than one chunk");
  assert.ok(c.lines.every((l) => l.length <= phase.CHUNK + 200), "no line exceeds the chunk size plus its header");
  const heads = c.lines.map((l) => l.match(/^FORWARD_QUARTER_HASH_PART (\d+)\/(\d+) sha256=([0-9a-f]{64}) /));
  assert.ok(heads.every(Boolean));
  assert.ok(heads.every((m, i) => Number(m[1]) === i + 1 && Number(m[2]) === c.lines.length && m[3] === heads[0][3]));
  const json = c.lines.map((l, i) => l.slice(heads[i][0].length)).join("");
  assert.equal(require("node:crypto").createHash("sha256").update(json).digest("hex"), heads[0][3]);
  const rec = JSON.parse(json);
  assert.ok(rec.rows > 0); assert.match(rec.hashA, /^[0-9a-f]{64}$/); assert.match(rec.hashB, /^[0-9a-f]{64}$/); assert.equal(rec.prevAt, null);
  const hashes = Object.values(rec.rowHashes).flat().map((x) => x[1]);
  assert.ok(hashes.length === rec.rows && hashes.every((h) => /^[0-9a-f]{12}$/.test(h)));
  assert.doesNotMatch(json, /"close"|"open"|"price"/);
  assert.throws(() => phase.run({ configPath: cfg, env: { NUSA_CLOUD_STATE_DB_PATH: "relative.sqlite" }, now: t0("2027-03-31T02:00:00Z"), log: () => {} }), /state path/);
  const early = capture();
  assert.equal(phase.run({ configPath: cfg, env: { NUSA_CLOUD_STATE_DB_PATH: dbPath }, now: t0("2027-03-30T23:00:00Z"), log: early.log }), 0);
  assert.deepEqual(early.lines, [phase.WAITING_DATE], "a real store is present but nothing is read before the first quarter end");
});

test("a decision run that cannot evaluate prints no FORWARD_DECISION and fails closed (so it can be retried); a genuine data-integrity result is the decision", () => {
  const dir = tmp(); const cfg = path.join(dir, "forward-ret48.json"); fs.writeFileSync(cfg, '{"spanStart":"2026-12-11T00:00:00Z"}');
  const dbPath = makeDb(dir);
  const db = new DatabaseSync(dbPath, { readOnly: true }); const record = forward.quarterRecord(db, t0("2027-03-31T00:00:00Z"), null); db.close();
  const committed = path.join(dir, "committed.json"); fs.writeFileSync(committed, JSON.stringify([record]));
  const now = t0("2028-03-31T01:00:00Z"); const env = { NUSA_CLOUD_STATE_DB_PATH: dbPath };
  // not evaluable: no committed file, an empty list, a malformed list, a freeze that does not match
  for (const [label, committedPath] of [["absent", path.join(dir, "none.json")], ["empty", (() => { const f = path.join(dir, "empty.json"); fs.writeFileSync(f, "[]"); return f; })()], ["malformed", (() => { const f = path.join(dir, "bad.json"); fs.writeFileSync(f, '[{"x":1}]'); return f; })()]]) {
    const c = capture();
    assert.throws(() => phase.run({ configPath: cfg, committedPath, env, now, log: c.log }), /decision not evaluable/, label);
    assert.deepEqual(c.lines, [], `${label}: nothing is printed as a decision`);
  }
  // a committed record with a wrong shape would read as a deleted row: it must not be printed as a decision either
  for (const bad of [{ ...record, rowHashes: { "KRW-BTC": "abcd" } }, { ...record, rowHashes: { "KRW-BTC": [[]] } }, { ...record, rowHashes: { "KRW-BTC": [["x", "y"]] } },
    { ...record, rowHashes: { ...record.rowHashes, "KRW-XRP": [] } }, { ...record, rowHashes: "x" }, { ...record, hashB: "nothex" }, { ...record, rows: record.rows + 1 }, { ...record, at: "x" }]) {
    const f2 = path.join(dir, "shape.json"); fs.writeFileSync(f2, JSON.stringify([bad]));
    const c2 = capture();
    assert.throws(() => phase.run({ configPath: cfg, committedPath: f2, env, now, log: c2.log }), /decision not evaluable/);
    assert.deepEqual(c2.lines, []);
  }
  assert.equal(phase.wellFormedRecord(record), true);
  const badFreeze = path.join(dir, "freeze.json"); fs.writeFileSync(badFreeze, JSON.stringify({ study: "X" }));
  const f = capture();
  assert.throws(() => phase.run({ configPath: cfg, committedPath: committed, freezePath: badFreeze, env, now, log: f.log }), /FREEZE_MISMATCH/);
  assert.deepEqual(f.lines, []);
  // genuine: a committed row changed after it was recorded
  const w = new DatabaseSync(dbPath); w.prepare("UPDATE research_closed_candles SET close = close + 1 WHERE market = ? AND close_time_ms = ?").run(forward.MARKETS[0], t0("2026-12-20T00:00:00Z")); w.close();
  const changed = capture();
  assert.equal(phase.run({ configPath: cfg, committedPath: committed, env, now, log: changed.log }), 1);
  assert.equal(changed.lines.length, 1); assert.match(changed.lines[0], /^FORWARD_DECISION .*DATA_INTEGRITY_FAIL.*ROW_CHANGED/);
});

test("source pin: read-only database, no write, no other script, no look phase, nothing printed but the two line kinds", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.match(src, /readOnly: true/);
  assert.doesNotMatch(src, /\.exec\(|INSERT INTO|UPDATE \w+ SET|DELETE FROM|spawn|child_process|fetch\(|https?:\/\//);
  assert.doesNotMatch(src, /["']look["']/);
  const printed = [...src.matchAll(/log\(`?['"]?(FORWARD_[A-Z_0-9]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(printed)].sort(), ["FORWARD_DECISION", "FORWARD_QUARTER_HASH_PART"]);
  assert.equal((src.match(/console\.log/g) || []).length, 1, "only the default logger writes to stdout");
  assert.doesNotMatch(src, /process\.stdout|console\.(info|debug|dir|table)/);
});
