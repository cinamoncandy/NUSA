const test = require("node:test");
const assert = require("node:assert/strict");
const { mulberry32 } = require("../scripts/lib/preregisteredStudyStats.js");
const D = require("../scripts/lib/dailyCrossSectionStudy.js");
const S3 = require("../scripts/lib/makerExecutionStudy.js");
const { HOLD_START, PRINT_AT, DAY, H, M } = D.constants;

test("a limit fills only for volume strictly through its price, after 1 s of latency and before the 10-minute cancel", () => {
  const t0 = 1_000_000_000_000;
  const base = { side: "BUY", limit: 100, quantity: 10, placedAt: t0 };
  const tr = (dt, price, volume) => ({ t: t0 + dt, price, volume });
  assert.equal(S3.fillFraction({ ...base, trades: [tr(5_000, 100, 50)] }), 0, "a print AT the limit is not through it");
  assert.equal(S3.fillFraction({ ...base, trades: [tr(5_000, 99.9, 4)] }), 0.4, "partial fill is volume over size");
  assert.equal(S3.fillFraction({ ...base, trades: [tr(5_000, 99.9, 4), tr(9_000, 99, 20)] }), 1, "capped at 1");
  assert.equal(S3.fillFraction({ ...base, trades: [tr(500, 99, 50)] }), 0, "within the 1 s latency");
  assert.equal(S3.fillFraction({ ...base, trades: [tr(1_000, 99, 50)] }), 1, "exactly 1 s after placement counts");
  assert.equal(S3.fillFraction({ ...base, trades: [tr(10 * M, 99, 50)] }), 0, "the cancel instant is exclusive");
  assert.equal(S3.fillFraction({ ...base, side: "SELL", trades: [tr(5_000, 100.1, 5)] }), 0.5, "a sell needs prices strictly above");
  assert.equal(S3.fillFraction({ ...base, side: "SELL", trades: [tr(5_000, 100, 5)] }), 0);
  assert.equal(S3.fillFraction({ ...base, quantity: 0, trades: [] }), 0);
});

function fakeProvider({ entryBook, exitBook, fallbackBook, trades, tickOk = true }) {
  const T = HOLD_START;
  return {
    markets: () => ["KRW-A"],
    bookAt: (m, t) => (t === T ? entryBook : t === T + 4 * H ? exitBook : t === T + 4 * H + 10 * M ? fallbackBook : undefined),
    lastBidBetween: () => undefined,
    tradesBetween: (m, from, to) => trades.filter((x) => x.t >= from && x.t < to),
    tickCoverageOk: () => tickOk,
  };
}
const book = (b, a) => ({ t: 0, b, a, b5: 1, a5: 1 });

test("a maker pick: full entry and exit fills pay only the maker fee and capture the spread", () => {
  const T = HOLD_START;
  const trades = [{ t: T + 5_000, price: 99.9, volume: 1e9 }, { t: T + 4 * H + 5_000, price: 101.3, volume: 1e9 }];
  const p = fakeProvider({ entryBook: book(100, 100.2), exitBook: book(101, 101.2), trades });
  const r = S3.makerPick(p, "KRW-A", T, false);
  assert.equal(r.f, 1);
  const expected = (101.2 * (1 - 0.0005)) / (100 * (1 + 0.0005)) - 1;
  assert.ok(Math.abs(r.r - expected) < 1e-12, `${r.r} vs ${expected}`);
  assert.ok(r.r > S3.takerPick(p, "KRW-A", T, false).r, "the maker round trip beats crossing both spreads");
});

test("an unfilled entry is a missed trade (zero), and an unfilled exit is closed as a taker at the fallback book", () => {
  const T = HOLD_START;
  const missed = S3.makerPick(fakeProvider({ entryBook: book(100, 100.2), exitBook: book(101, 101.2), trades: [] }), "KRW-A", T, false);
  assert.deepEqual(missed, { f: 0, r: 0 });
  const trades = [{ t: T + 5_000, price: 99.9, volume: 1e9 }];
  const fallback = S3.makerPick(fakeProvider({ entryBook: book(100, 100.2), exitBook: book(101, 101.2), fallbackBook: book(100.5, 100.7), trades }), "KRW-A", T, false);
  const expected = (100.5 * (1 - 0.0010)) / (100 * (1 + 0.0005)) - 1;
  assert.ok(Math.abs(fallback.r - expected) < 1e-12);
  const gap = S3.makerPick(fakeProvider({ entryBook: book(100, 100.2), exitBook: book(101, 101.2), trades }), "KRW-A", T, false);
  assert.deepEqual(gap, { gap: true }, "no exit fill and no fallback book is a data gap");
  assert.deepEqual(S3.makerPick(fakeProvider({ entryBook: book(100, 100.2), trades, tickOk: false }), "KRW-A", T, false), { gap: true }, "a tick-coverage gap is a data gap");
  assert.deepEqual(S3.makerPick(fakeProvider({ entryBook: undefined, trades }), "KRW-A", T, false), { missing: true });
});

test("a partial exit fill sells that part at the limit and closes the remainder as a taker", () => {
  const T = HOLD_START;
  const qty = 1_000_000 / 100;
  const trades = [{ t: T + 5_000, price: 99.9, volume: qty }, { t: T + 4 * H + 5_000, price: 101.3, volume: qty / 2 }];
  const r = S3.makerPick(fakeProvider({ entryBook: book(100, 100.2), exitBook: book(101, 101.2), fallbackBook: book(100.5, 100.7), trades }), "KRW-A", T, false);
  const expected = (0.5 * 101.2 * (1 - 0.0005) + 0.5 * 100.5 * (1 - 0.0010)) / (100 * (1 + 0.0005)) - 1;
  assert.ok(Math.abs(r.r - expected) < 1e-12);
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
  const book = (m, t) => { const p = price(m, t); return { t, b: p * (1 - halfBp / 10_000), a: p * (1 + halfBp / 10_000), b5: 1.2, a5: 1 }; };
  const wobble = (m, t) => { const x = Math.sin(Number(m.slice(5)) * 12.9898 + Math.floor(t / M) * 78.233) * 43758.5453; return x - Math.floor(x); };
  return {
    markets: () => codes, bookAt: book,
    lastBidBetween: (m, from, to) => book(m, to).b,
    tradesBetween: (m, from, to) => { const out = []; for (let t = Math.ceil(from / M) * M; t < to; t += M) { const px = price(m, t) * (1 + (wobble(m, t) - 0.5) * wobbleAmp); out.push({ t, price: px, volume: 400 }); } return out; },
    tickCoverageOk: () => true,
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
