import assert from "node:assert/strict";
import { test } from "node:test";
import { SqliteDatabase } from "../../../packages/storage/src/index";
import { CloudPaperCanonicalRiskGateway, type CloudPaperRiskRequest } from "./cloudPaperCanonicalRiskGateway";
import type { PaperAccountState } from "./paperTradingExecutionLoop";

const NOW = Date.parse("2026-10-17T07:00:00Z");

function emptyHealthyState(): PaperAccountState {
  return Object.freeze({
    version: 1,
    initialCapital: 1_000_000,
    cash: 1_000_000,
    equity: 1_000_000,
    realizedPnL: 0,
    unrealizedPnL: 0,
    positions: Object.freeze([]),
    orders: Object.freeze([]),
    fills: Object.freeze([]),
    processedIdempotencyKeys: Object.freeze([]),
    updatedAt: NOW,
  });
}

function request(state: PaperAccountState): CloudPaperRiskRequest {
  return Object.freeze({
    path: "STRATEGY",
    commandId: "lease-liveness-command",
    signalId: "lease-liveness-signal",
    clientOrderId: "lease-liveness-order",
    strategyId: "lease-liveness-strategy",
    market: "KRW-BTC",
    side: "BUY",
    quantity: 1,
    price: 100,
    now: NOW,
    observedAt: NOW - 1_000,
    maximumMarketAgeMs: 30_000,
    killSwitchActive: false,
    openP0: false,
    overallHealth: "HEALTHY",
    state,
  });
}

test("PAPER risk evaluation never performs a full-file SQLite quick_check", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const gate = new CloudPaperCanonicalRiskGateway({ database: db, initialCapital: 1_000_000, sourceCommitSha: "test" });
    const statements: string[] = [];
    const originalPrepare = db.connection.prepare.bind(db.connection);
    Object.defineProperty(db.connection, "prepare", {
      configurable: true,
      value: (sql: string) => {
        statements.push(sql);
        return originalPrepare(sql);
      },
    });

    const result = gate.evaluate(request(emptyHealthyState()));
    assert.equal(result.status, "ALLOW", result.reasonCodes.join(","));
    assert.ok(statements.some((sql) => sql === "SELECT 1 AS ready"));
    assert.ok(statements.some((sql) => sql.includes("sqlite_master")));
    assert.equal(statements.some((sql) => /PRAGMA\s+quick_check/i.test(sql)), false, statements.join("\n"));
  } finally {
    db.close();
  }
});
