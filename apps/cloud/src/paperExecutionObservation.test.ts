import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { paperExecutionObservedAt } from "./paperExecutionObservation";

test("an admitted ticker slightly ahead of the local clock is observed at now, not rejected as stale", () => {
  // Measured 2026-09-29: Upbit trade timestamps ran up to ~1.4s ahead of the local clock, and every
  // PAPER tick was rejected with "market data is stale" because observedAt > now.
  assert.equal(paperExecutionObservedAt(1_000_001_400, 1_000_000_000), 1_000_000_000);
});

test("past observations keep their real age so staleness is still enforced", () => {
  assert.equal(paperExecutionObservedAt(900_000, 1_000_000), 900_000);
  assert.equal(paperExecutionObservedAt(1_000_000, 1_000_000), 1_000_000);
});

test("the runtime hands the clamped observation time to the PAPER execution boundary", () => {
  const runtime = readFileSync(path.join(__dirname, "../../../../apps/cloud/src/runtime.ts"), "utf8");
  assert.match(runtime, /observedAt: paperExecutionObservedAt\(ticker\.trade_timestamp, executionNow\)/);
});
