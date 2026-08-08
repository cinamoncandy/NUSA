const test = require("node:test");
const assert = require("node:assert/strict");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { SqliteP0AlertRepository } = require("../dist/apps/cloud/src/p0AlertRepository.js");
const { PaperTradingExecutionLoop } = require("../dist/apps/cloud/src/paperTradingExecutionLoop.js");

function tick(now = 1_000) {
  return {
    now,
    market: "KRW-BTC",
    price: 100,
    observedAt: now,
    mode: "PAPER",
    killSwitchActive: false,
    tradingAllowed: true,
    overallHealth: "HEALTHY",
    decisions: [{ symbol: "KRW-BTC", action: "BUY", allocation: 0.1, decidedAt: now - 1 }]
  };
}

function fixture() {
  const db = new SqliteDatabase(":memory:");
  const p0 = new SqliteP0AlertRepository(db);
  const loop = new PaperTradingExecutionLoop({
    initialCapital: 1_000,
    readP0State: () => p0.readState()
  });
  return { db, p0, loop };
}

test("actual PAPER fill boundary blocks while a durable P0 incident is open", () => {
  const { db, p0, loop } = fixture();
  try {
    p0.append({
      eventId: "event-open",
      incidentId: "incident-runtime",
      type: "OPENED",
      occurredAt: 100,
      reason: "critical runtime invariant"
    });

    const result = loop.processTick(tick());
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.reason, "OPEN_P0_ALERT");
    assert.equal(result.orders.length, 0);
    assert.equal(result.fills.length, 0);
    assert.equal(loop.snapshot().orders.length, 0);
  } finally {
    db.close();
  }
});

test("corrupted P0 evidence fails closed before PAPER order creation", () => {
  const { db, p0, loop } = fixture();
  try {
    p0.append({
      eventId: "event-open",
      incidentId: "incident-runtime",
      type: "OPENED",
      occurredAt: 100,
      reason: "critical runtime invariant"
    });
    db.connection.prepare("UPDATE cloud_p0_alert_events SET hash = ? WHERE sequence = 1").run("f".repeat(64));

    const result = loop.processTick(tick());
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.reason, "P0_STATE_UNVERIFIABLE");
    assert.equal(result.orders.length, 0);
    assert.equal(result.fills.length, 0);
    assert.equal(loop.snapshot().orders.length, 0);
  } finally {
    db.close();
  }
});

test("verified P0 resolution re-opens only the PAPER execution boundary, not LIVE authority", () => {
  const { db, p0, loop } = fixture();
  try {
    p0.append({
      eventId: "event-open",
      incidentId: "incident-runtime",
      type: "OPENED",
      occurredAt: 100,
      reason: "critical runtime invariant"
    });
    p0.append({
      eventId: "event-resolve",
      incidentId: "incident-runtime",
      type: "RESOLVED",
      occurredAt: 101,
      reason: "operator verified recovery"
    });

    const result = loop.processTick(tick());
    assert.equal(result.status, "FILLED");
    assert.equal(result.orders.length, 1);
    assert.equal(result.fills.length, 1);
    assert.equal(result.orders[0].side, "BUY");
  } finally {
    db.close();
  }
});
