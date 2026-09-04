"use strict";

// P1 CLOSURE PRIORITY 1: ledger-scale conversion must follow exact decimal
// semantics (unified with FixedPrecision's string-based rule), not
// binary-float multiply-then-round. The old `BigInt(Math.round(amount * 1e8))`
// loses units once |amount| * 1e8 exceeds 2^53 (~9e7 KRW scale) and
// double-rounds values like 999999999.9999999.
//
// These tests FAIL on the float implementation and PASS on the exact one.
// They pin: exactness on adversarial magnitudes, restart agreement after
// hundreds of fills, and scale-expression independence.

const test = require("node:test");
const assert = require("node:assert/strict");
const { PaperBroker } = require("../dist/apps/desktop/src/paper/paperBroker.js");
const { replayPaperLedger } = require("../dist/packages/core/src/paperSafetyGates.js");

// Independent exact rule: decimal text of the double (12dp, as stored) scaled
// to 8dp with round-half-up. Mirrors FixedPrecision.toUnits, not the impl.
function exactScaled(amount) {
  const negative = amount < 0;
  const parts = Math.abs(amount).toFixed(12).split(".");
  const digits = (parts[0] + (parts[1] ?? "").padEnd(12, "0")).replace(/^0+(?=\d)/, "");
  const raw = BigInt(digits === "" ? "0" : digits);
  const scaled = (raw + 5000n) / 10000n;
  return negative ? -scaled : scaled;
}

function exactFromScaled(units) {
  return Number(units) / 100000000;
}

test("adversarial magnitudes scale exactly (no float double-rounding)", () => {
  const broker = new PaperBroker(2_000_000_000, "KRW-BTC", 0);
  // Price whose double is exactly 999999999.99999988079...: exact 8dp rule
  // yields ...988 units, the float multiply-then-round yields ...984.
  const price = 999999999.9999999;
  broker.execute("BUY", 1, price, new Date("2026-01-01T00:00:00Z"));
  const state = broker.exportState();
  const expectedAvg = exactFromScaled(exactScaled(price));
  assert.equal(state.position.averagePrice, expectedAvg);
  assert.equal(exactScaled(price).toString(), "99999999999999988");
});

test("large-cash replay matches exact decimal truth", () => {
  const cash = 123456789.12345679;
  const broker = new PaperBroker(2_000_000_000, "KRW-BTC", 0);
  // Force the replay path through export/restore with a fill on the books.
  broker.execute("BUY", 1, 50000, new Date("2026-01-01T00:00:00Z"));
  const revived = new PaperBroker(2_000_000_000, "KRW-BTC", 0);
  const exported = broker.exportState();
  const patched = {
    ...exported,
    cash,
    ledger: exported.ledger.map((entry, i) =>
      i === 0 ? { ...entry, cashBefore: cash } : { ...entry },
    ),
  };
  revived.restoreState(patched);
  const replayed = revived.exportState();
  assert.equal(replayed.cash, exactFromScaled(exactScaled(cash) - 50000n * 100000000n));
});

test("200 sequential fills agree across restart (deterministic replay)", () => {
  const broker = new PaperBroker(1_000_000_000, "KRW-BTC", 0.0005);
  for (let i = 0; i < 200; i++) {
    const price = 50000000 + (i % 7) * 123456;
    broker.execute(i % 2 === 0 ? "BUY" : "SELL", 0.001, price, new Date(Date.UTC(2026, 0, 1, 0, 0, i)));
  }
  const before = broker.exportState();
  const revived = new PaperBroker(1_000_000_000, "KRW-BTC", 0.0005);
  revived.restoreState(before);
  const after = revived.exportState();
  assert.equal(after.cash, before.cash);
  assert.equal(after.position.quantity, before.position.quantity);
  assert.equal(after.position.averagePrice, before.position.averagePrice);
  assert.equal(after.position.realizedPnl, before.position.realizedPnl);
  assert.equal(after.ledger.length, before.ledger.length);
});

test("same economic event in different float spellings gives same ledger", () => {
  const make = () => new PaperBroker(1_000_000_000, "KRW-BTC", 0);
  const a = make();
  const b = make();
  const t = new Date("2026-01-01T00:00:00Z");
  a.execute("BUY", 0.3, 100000, t);
  b.execute("BUY", 0.1 + 0.2, 100000, t);
  const sa = a.exportState();
  const sb = b.exportState();
  assert.equal(sa.position.quantity, sb.position.quantity);
  assert.equal(sa.position.averagePrice, sb.position.averagePrice);
  assert.equal(sa.cash, sb.cash);
});

test("gate verifies a healthy large-scale ledger (former false-halt repro)", () => {
  const broker = new PaperBroker(1000000000, "KRW-BTC", 0.0005);
  for (let i = 0; i < 200; i++) {
    const price = 50000000 + (i % 7) * 123456;
    broker.execute(i % 2 === 0 ? "BUY" : "SELL", 0.01, price, new Date(Date.UTC(2026, 0, 1, 0, 0, i)));
  }
  const state = broker.exportState();
  // Must not throw (the former false-halt). The gate recomputes in float,
  // so agreement is within its documented magnitude-aware tolerance —
  // exactness lives in the broker replay and stored ledger, not here.
  const projection = replayPaperLedger(state.ledger, 1000000000, 50000000);
  const close = (a, b, floor) => Math.abs(a - b) <= Math.max(floor, 1e-12 * Math.max(Math.abs(a), Math.abs(b), 1));
  assert.ok(close(projection.cash, state.cash, 1e-8));
  assert.ok(close(projection.quantity, state.position.quantity, 1e-12));
  assert.ok(close(projection.realizedPnl, state.position.realizedPnl, 1e-8));
});

test("gate still throws on a tampered large-scale ledger (failure test)", () => {
  const broker = new PaperBroker(1000000000, "KRW-BTC", 0.0005);
  for (let i = 0; i < 10; i++) {
    broker.execute("BUY", 0.01, 50000000 + i, new Date(Date.UTC(2026, 0, 1, 0, 0, i)));
  }
  const tampered = broker.exportState().ledger.map((entry, i) =>
    i === 5 ? { ...entry, cashAfter: entry.cashAfter + 1000 } : { ...entry },
  );
  assert.throws(() => replayPaperLedger(tampered, 1000000000, 50000000), /after-state mismatch/);
});
