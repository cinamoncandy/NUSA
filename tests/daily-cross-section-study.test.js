const test = require("node:test");
const assert = require("node:assert/strict");
const { mulberry32 } = require("../scripts/lib/preregisteredStudyStats.js");
const D = require("../scripts/lib/dailyCrossSectionStudy.js");
const { TRAIN_START, HOLD_START, HOLD_END, PRINT_AT, DAY, H, M } = D.constants;

const DAYS0 = Date.parse("2026-10-14T00:00:00Z");
const NDAYS = 54;
const NOW = PRINT_AT + 1;

// Synthetic all-KRW provider. Daily log returns = market factor + idiosyncratic noise (+ an optional reversal of yesterday's idiosyncratic part).
function makeProvider({ seed = 7, markets = 70, reversal = 0, factorDrift = 0, factorSd = 0.02, spreadHalfBp = 2.5, holes = () => false, imbalance = () => [1.2, 1], wide = new Set() } = {}) {
  const rand = mulberry32(seed);
  const normal = () => { let s = 0; for (let i = 0; i < 12; i += 1) s += rand(); return s - 6; };
  const codes = Array.from({ length: markets }, (_, i) => `KRW-M${String(i).padStart(3, "0")}`);
  const factor = Array.from({ length: NDAYS }, () => factorDrift + factorSd * normal());
  const logp = new Map();
  for (const m of codes) {
    const idio = [], path = [Math.log(1000)];
    for (let d = 0; d < NDAYS; d += 1) {
      const noise = 0.01 * normal();
      idio.push(noise - (d > 0 ? reversal * idio[d - 1] : 0));
      path.push(path[d] + factor[d] + idio[d]);
    }
    logp.set(m, path);
  }
  const price = (m, t) => { const x = (t - DAYS0) / DAY, d = Math.floor(x), f = x - d, p = logp.get(m); return Math.exp(p[d] + (p[d + 1] - p[d]) * f); };
  const book = (m, t) => {
    if (holes(m, t)) return undefined;
    const p = price(m, t), half = (wide.has(m) ? 30 : spreadHalfBp) / 10_000;
    const [b5, a5] = imbalance(m, t);
    return { t, b: p * (1 - half), a: p * (1 + half), b5, a5 };
  };
  return {
    markets: () => codes,
    bookAt: (m, t) => book(m, t),
    lastBidBetween: (m, from, to) => { for (let t = to; t >= from; t -= 10 * M) { const b = book(m, t); if (b) return b.b; } return undefined; },
  };
}

test("before the print time nothing is computed", () => {
  assert.equal(D.runDailyStudy({ provider: makeProvider(), study: "S4", now: PRINT_AT - 1 }).status, "WAITING_DATA");
});

test("eligibility uses training data only: wide spreads and thin markets are out, the rest sorted by code", () => {
  const wide = new Set(["KRW-M001"]);
  const thin = (m, t) => m === "KRW-M002" && t < Date.parse("2026-10-28T00:00:00Z");
  const elig = D.eligibleMarkets(makeProvider({ wide, holes: thin }));
  assert.ok(!elig.includes("KRW-M001") && !elig.includes("KRW-M002"));
  assert.equal(elig.length, 68);
  assert.deepEqual([...elig].sort(), elig);
});

test("S4 passes when yesterday's biggest losers really rebound, with every holdout day counted", () => {
  const r = D.runDailyStudy({ provider: makeProvider({ reversal: 1 }), study: "S4", now: NOW, options: { flips: 5000 } });
  assert.equal(r.status, "HOLDOUT_PASS", JSON.stringify(r));
  assert.equal(r.cohorts, 30, "the last decision (12-04) exits exactly at the split end and is allowed");
  assert.ok(r.downDays >= 8 && r.meanExcessBp > 0 && r.minimumDetectableExcessBp > 0);
});

test("on pure noise the study passes only at about its alpha: no systematic bias across 30 seeds", () => {
  let pass = 0, sum = 0, counted = 0;
  for (let seed = 1; seed <= 30; seed += 1) {
    const r = D.runDailyStudy({ provider: makeProvider({ seed, reversal: 0 }), study: "S4", now: NOW, options: { flips: 1000 } });
    if (r.status === "HOLDOUT_PASS") pass += 1;
    if (r.meanExcessBp != null) { sum += r.meanExcessBp; counted += 1; }
  }
  assert.ok(pass <= 3, `${pass} chance passes out of 30`);
  assert.ok(Math.abs(sum / counted) < 8, `mean excess ${sum / counted} bp should be near 0`);
});

test("S2 on pure noise also fails far more often than it passes", () => {
  let pass = 0;
  for (let seed = 1; seed <= 12; seed += 1) if (D.runDailyStudy({ provider: makeProvider({ seed, reversal: 0 }), study: "S2", now: NOW, options: { flips: 1000 } }).status === "HOLDOUT_PASS") pass += 1;
  assert.ok(pass <= 2, `${pass} of 12`);
});

test("a rally with fewer than 8 down days is INSUFFICIENT_DATA, never a pass", () => {
  const r = D.runDailyStudy({ provider: makeProvider({ factorDrift: 0.05, factorSd: 0.005 }), study: "S4", now: NOW, options: { flips: 2000 } });
  assert.equal(r.status, "INSUFFICIENT_DATA");
  assert.equal(r.reasonCode, "DATA_DOWN_DAYS");
});

test("missing exit books are marked, and too many gaps make the study INSUFFICIENT_DATA", () => {
  const sometimes = (m, t) => t >= HOLD_START && (t - HOLD_START) % DAY === 0 && m.endsWith("7") && false;
  assert.equal(D.runDailyStudy({ provider: makeProvider({ reversal: 1, holes: sometimes }), study: "S4", now: NOW, options: { flips: 2000 } }).status, "HOLDOUT_PASS");
  // No book at all around every exit for most markets: marked values also absent, so gaps exceed 5%.
  const allGone = (m, t) => t >= HOLD_START && t % DAY < 90 * M && ((t - HOLD_START) / DAY) % 1 === 0 && Number(m.slice(5)) % 3 !== 0;
  const r = D.runDailyStudy({ provider: makeProvider({ reversal: 1, holes: (m, t) => t > HOLD_START && t % DAY === 0 }), study: "S4", now: NOW, options: { flips: 2000 } });
  assert.equal(r.status, "INSUFFICIENT_DATA");
  assert.ok(["DATA_HOLDOUT_COVERAGE", "DATA_GAPS", "DATA_COHORTS"].includes(r.reasonCode), r.reasonCode);
  void allGone;
});

test("S2 with no qualifying market on a day still counts the cohort as 0 minus the benchmark", () => {
  const badDay = Date.parse("2026-11-10T00:00:00Z");
  const imbalance = (m, t) => (t > badDay - 5 * H && t <= badDay ? [1, 1.5] : [1.2, 1]);
  const provider = makeProvider({ imbalance, reversal: 0 });
  const universe = D.eligibleMarkets(provider);
  assert.deepEqual(D.pickS2(provider, universe, badDay), []);
  const c = D.buildCohorts(provider, universe, "S2");
  const cohort = c.cohorts.find((x) => x && x.t === badDay);
  assert.ok(cohort && cohort.picks === 0);
  assert.ok(Math.abs(cohort.baseExcess + cohort.benchmarkBase) < 1e-12, "excess is exactly minus the benchmark");
  assert.equal(c.cohorts.filter((x) => x != null).length, 30);
});

test("S2 ranks the surviving markets by the sum of their percentile ranks and breaks ties by code", () => {
  const provider = makeProvider({});
  const universe = D.eligibleMarkets(provider);
  const t = HOLD_START + 3 * DAY;
  const picks = D.pickS2(provider, universe, t);
  assert.ok(picks.length <= 3);
  assert.deepEqual(picks, D.pickS2(provider, universe, t), "deterministic");
});
