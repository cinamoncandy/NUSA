const test = require("node:test");
const assert = require("node:assert/strict");
const { mulberry32 } = require("../scripts/lib/preregisteredStudyStats.js");
const D = require("../scripts/lib/dailyCrossSectionStudy.js");
const S3 = require("../scripts/lib/makerExecutionStudy.js");
const { HOLD_START, PRINT_AT, DAY, H, M } = D.constants;

test("a limit is judged from minute books: filled only by a snapshot strictly through its price, between 1 s and 10 minutes, with enough snapshots", () => {
  const t0 = 1_000_000_000_000;
  const mk = (n, f) => Array.from({ length: n }, (_, i) => ({ t: t0 + 60_000 * (i + 1), b: 100, a: 100.2, ...f(i) }));
  const base = { side: "BUY", limit: 100, placedAt: t0 };
  assert.equal(S3.bookFill({ ...base, books: mk(9, () => ({})) }), 0, "an ask above the limit never fills a buy");
  assert.equal(S3.bookFill({ ...base, books: mk(9, () => ({ a: 100 })) }), 0, "an ask AT the limit is not through it");
  assert.equal(S3.bookFill({ ...base, books: mk(9, (i) => (i === 4 ? { a: 99.9 } : {})) }), 1, "one snapshot with the ask strictly below fills");
  assert.equal(S3.bookFill({ ...base, side: "SELL", books: mk(9, (i) => (i === 2 ? { b: 100.3 } : {})), limit: 100.2 }), 1, "a sell needs a bid strictly above");
  assert.equal(S3.bookFill({ ...base, side: "SELL", books: mk(9, () => ({ b: 100.2 })), limit: 100.2 }), 0);
  assert.equal(S3.bookFill({ ...base, books: mk(4, () => ({ a: 99 })) }), null, "fewer than 5 snapshots in the window is a data gap");
  const outside = [{ t: t0 + 500, b: 100, a: 90 }, { t: t0 + 10 * 60_000, b: 100, a: 90 }, ...mk(5, () => ({}))];
  assert.equal(S3.bookFill({ ...base, books: outside }), 0, "a snapshot within the 1 s latency or at the cancel instant does not count");
});

function fakeProvider({ entryBook, exitBook, fallbackBook, crossEntry = false, crossExit = false, sparse = false }) {
  const T = HOLD_START;
  const snaps = (from, cross, crossAt) => Array.from({ length: sparse ? 3 : 9 }, (_, i) => ({ t: from + 60_000 * (i + 1), b: crossAt === "sell" && cross ? 200 : 100, a: crossAt === "buy" && cross ? 50 : 1000 }));
  return {
    markets: () => ["KRW-A"],
    bookAt: (m, t) => (t === T ? entryBook : t === T + 4 * H ? exitBook : t === T + 4 * H + 10 * M ? fallbackBook : undefined),
    lastBidBetween: () => undefined,
    booksBetween: (m, from) => (from === T ? snaps(from, crossEntry, "buy") : snaps(from, crossExit, "sell")),
  };
}
const book = (b, a) => ({ t: 0, b, a, b5: 1, a5: 1 });

test("a maker pick: filled entry and exit pay only the maker fee and capture the spread", () => {
  const T = HOLD_START;
  const p = fakeProvider({ entryBook: book(100, 100.2), exitBook: book(101, 101.2), crossEntry: true, crossExit: true });
  const r = S3.makerPick(p, "KRW-A", T, false);
  assert.equal(r.f, 1);
  const expected = (101.2 * (1 - 0.0005)) / (100 * (1 + 0.0005)) - 1;
  assert.ok(Math.abs(r.r - expected) < 1e-12, `${r.r} vs ${expected}`);
  assert.ok(r.r > S3.takerPick(p, "KRW-A", T, false).r, "the maker round trip beats crossing both spreads");
});

test("an unfilled entry is a missed trade, an unfilled exit is closed as a taker at the fallback book, and thin windows are gaps", () => {
  const T = HOLD_START;
  assert.deepEqual(S3.makerPick(fakeProvider({ entryBook: book(100, 100.2), exitBook: book(101, 101.2) }), "KRW-A", T, false), { f: 0, r: 0 });
  const fallback = S3.makerPick(fakeProvider({ entryBook: book(100, 100.2), exitBook: book(101, 101.2), fallbackBook: book(100.5, 100.7), crossEntry: true }), "KRW-A", T, false);
  const expected = (100.5 * (1 - 0.0010)) / (100 * (1 + 0.0005)) - 1;
  assert.ok(Math.abs(fallback.r - expected) < 1e-12);
  assert.deepEqual(S3.makerPick(fakeProvider({ entryBook: book(100, 100.2), exitBook: book(101, 101.2), crossEntry: true }), "KRW-A", T, false), { gap: true }, "no exit fill and no fallback book is a data gap");
  assert.deepEqual(S3.makerPick(fakeProvider({ entryBook: book(100, 100.2), sparse: true }), "KRW-A", T, false), { gap: true }, "a window with too few snapshots cannot be judged");
  assert.deepEqual(S3.makerPick(fakeProvider({ entryBook: undefined }), "KRW-A", T, false), { missing: true });
});

// ---- end to end on a synthetic market ----
const DAYS0 = Date.parse("2026-10-14T00:00:00Z");
const NDAYS = 54;
const NSTEP = NDAYS * 6; // one random-walk node every 4 h, so decisions and exits sit on independent increments (no smooth intraday drift)
function synthetic({ seed = 7, markets = 70, drift = 0, halfBp = 2.5, wobbleAmp = 0.0012 } = {}) {
  const rand = mulberry32(seed);
  const normal = () => { let s = 0; for (let i = 0; i < 12; i += 1) s += rand(); return s - 6; };
  const codes = Array.from({ length: markets }, (_, i) => `KRW-M${String(i).padStart(3, "0")}`);
  const factor = Array.from({ length: NSTEP }, () => drift + (0.02 / Math.sqrt(6)) * normal());
  const paths = new Map();
  for (const m of codes) { const p = [Math.log(1000)]; for (let k = 0; k < NSTEP; k += 1) p.push(p[k] + factor[k] + (0.01 / Math.sqrt(6)) * normal()); paths.set(m, p); }
  const price = (m, t) => { const x = (t - DAYS0) / (4 * H), k = Math.floor(x), f = x - k, p = paths.get(m); return Math.exp(p[k] + (p[k + 1] - p[k]) * f); };
  const wobble = (m, t) => { const x = Math.sin(Number(m.slice(5)) * 12.9898 + Math.floor(t / M) * 78.233) * 43758.5453; return x - Math.floor(x); };
  const book = (m, t) => { const p = price(m, t) * (1 + (wobble(m, t) - 0.5) * wobbleAmp); return { t, b: p * (1 - halfBp / 10_000), a: p * (1 + halfBp / 10_000), b5: 1.2, a5: 1 }; };
  return {
    markets: () => codes, bookAt: book,
    lastBidBetween: (m, from, to) => book(m, to).b,
    booksBetween: (m, from, to) => { const out = []; for (let t = Math.ceil(from / M) * M; t < to; t += M) out.push(book(m, t)); return out; },
  };
}
const NOW = PRINT_AT + 1;

test("before the print time nothing is computed", () => {
  assert.equal(S3.runMakerStudy({ provider: synthetic(), now: PRINT_AT - 1 }).status, "WAITING_DATA");
});

test("a thin collector (few markets) is INSUFFICIENT_DATA, never a verdict", () => {
  const r = S3.runMakerStudy({ provider: synthetic({ markets: 20 }), now: NOW, options: { flips: 500 } });
  assert.equal(r.status, "INSUFFICIENT_DATA");
});

test("on pure noise S3 passes only about as often as chance allows", () => {
  let pass = 0, evaluated = 0;
  for (let seed = 1; seed <= 8; seed += 1) {
    const r = S3.runMakerStudy({ provider: synthetic({ seed }), now: NOW, options: { flips: 1000 } });
    if (r.status === "HOLDOUT_PASS") pass += 1;
    if (r.status === "HOLDOUT_PASS" || r.status === "HOLDOUT_FAIL") evaluated += 1;
  }
  assert.ok(pass <= 1, `${pass} chance passes of ${evaluated} evaluated runs`);
});

test("cheaper execution alone can never pass: in a wide-spread world the maker saving is large but a signal with no edge fails the gross-edge gate", () => {
  let savingShown = 0;
  for (let seed = 1; seed <= 6; seed += 1) {
    const r = S3.runMakerStudy({ provider: synthetic({ seed, halfBp: 9, wobbleAmp: 0.006 }), now: NOW, options: { flips: 1000 } });
    assert.notEqual(r.status, "HOLDOUT_PASS", `seed ${seed}: ${JSON.stringify(r.checks)}`);
    if (r.checks && r.improvementBp > 0) savingShown += 1;
    if (r.checks) assert.equal(r.checks.signalEdgeGrossBothTests, false);
  }
  assert.ok(savingShown >= 1, "the scenario really did show an execution saving");
});

test("abstaining (no pick) on falling days cannot pass: fewer than 20 of 30 days with a pick is INSUFFICIENT_DATA", () => {
  // Every book is ask-heavy, so the S2 signal (requires positive book imbalance) never selects anything; the market falls.
  const base = synthetic({ seed: 3, drift: -0.004 });
  const abstain = { ...base, bookAt: (m, t) => { const b = base.bookAt(m, t); return b && { ...b, b5: 1, a5: 1.5 }; } };
  const r = S3.runMakerStudy({ provider: abstain, now: NOW, options: { flips: 500 } });
  assert.equal(r.status, "INSUFFICIENT_DATA", JSON.stringify(r));
  assert.equal(r.reasonCode, "DATA_PICK_DAYS");
  assert.equal(r.picks, 0);
});
