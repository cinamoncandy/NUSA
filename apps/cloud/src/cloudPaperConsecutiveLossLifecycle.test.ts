import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SqliteDatabase } from "../../../packages/storage/src/index";
import { CloudPaperCanonicalRiskGateway, CLOUD_PAPER_RISK_LIMITS, type CloudPaperRiskRequest } from "./cloudPaperCanonicalRiskGateway";
import type { PaperAccountState, PaperFillRecord } from "./paperTradingExecutionLoop";

const DAY1 = Date.UTC(2026, 9, 7, 0, 0, 0);
const DAY2 = Date.UTC(2026, 9, 8, 0, 0, 0);
const HOUR = 3_600_000;
const M = "KRW-BTC";

function fill(id: string, side: "BUY" | "SELL", price: number, at: number, orderId = id, quantity = 1): PaperFillRecord {
  return { id, orderId, market: M, side, quantity, price, fee: 0, filledAt: at };
}
/** BUY at 100 then SELL at `exit`; a pair per index, spaced one hour apart from `start`. */
function pairs(start: number, exits: readonly number[]): PaperFillRecord[] {
  return exits.flatMap((exit, i) => [
    fill(`b${start}-${i}`, "BUY", 100, start + i * HOUR),
    fill(`s${start}-${i}`, "SELL", exit, start + i * HOUR + 1000)
  ]);
}
function state(fills: readonly PaperFillRecord[]): PaperAccountState {
  const keys = [...new Set(fills.map((f) => f.orderId))];
  const byOrder = new Map<string, PaperFillRecord[]>();
  for (const f of fills) byOrder.set(f.orderId, [...(byOrder.get(f.orderId) ?? []), f]);
  const orders = [...byOrder.entries()].map(([id, group]) => ({ id, idempotencyKey: id, market: M, side: group[0]!.side, quantity: group.reduce((sum, f) => sum + f.quantity, 0), price: group[0]!.price, fee: 0, status: "FILLED" as const, createdAt: group[0]!.filledAt, filledAt: group.at(-1)!.filledAt }));
  const cash = fills.reduce((sum, f) => sum + (f.side === "SELL" ? 1 : -1) * f.quantity * f.price, 1_000_000);
  return { version: 1, initialCapital: 1_000_000, cash, equity: cash, realizedPnL: 0, unrealizedPnL: 0, positions: [], orders, fills: [...fills].reverse(), processedIdempotencyKeys: keys, updatedAt: fills.at(-1)?.filledAt ?? 0 };
}
function request(s: PaperAccountState, now: number, n: number): CloudPaperRiskRequest {
  return { path: "STRATEGY", commandId: `c${n}`, signalId: `sig${n}`, clientOrderId: `o${n}`, strategyId: "t", market: M, side: "BUY", quantity: 1, price: 100, now, observedAt: now - 1000, maximumMarketAgeMs: 60_000, killSwitchActive: false, openP0: false, overallHealth: "HEALTHY", state: s };
}
function gate(db = new SqliteDatabase(":memory:")): CloudPaperCanonicalRiskGateway {
  return new CloudPaperCanonicalRiskGateway({ database: db, initialCapital: 1_000_000, sourceCommitSha: "test" });
}

describe("consecutive-loss streak lifecycle (threshold 3, UTC day)", () => {
  it("keeps the limit at 3", () => assert.equal(CLOUD_PAPER_RISK_LIMITS.maxConsecutiveLosses, 3));

  it("counts 0→1→2→3 and blocks only at 3", () => {
    const g = gate();
    const seen: Array<[number, string]> = [];
    for (let losses = 0; losses <= 3; losses += 1) {
      const s = state(pairs(DAY1, Array(losses).fill(90)));
      const r = g.evaluate(request(s, DAY1 + 10 * HOUR, losses));
      seen.push([g.lossSession()!.consecutiveLossCount, r.status]);
      if (losses < 3) assert.notEqual(r.status, "REJECT", `losses=${losses}`);
      else assert.ok(r.reasonCodes.includes("CONSECUTIVE_LOSS_LIMIT"));
    }
    assert.deepEqual(seen.map(([c]) => c), [0, 1, 2, 3]);
    assert.equal(seen[3]![1], "REJECT");
  });

  const blocked = state(pairs(DAY1, [90, 90, 90]));

  it("3 → UTC day boundary → 0 and the order is allowed again", () => {
    const g = gate();
    assert.ok(g.evaluate(request(blocked, DAY1 + 10 * HOUR, 1)).reasonCodes.includes("CONSECUTIVE_LOSS_LIMIT"));
    assert.equal(g.evaluate(request(blocked, DAY2 - 1, 2)).status, "REJECT");
    assert.equal(g.evaluate(request(blocked, DAY2, 3)).status, "ALLOW");
    assert.equal(g.lossSession()!.consecutiveLossCount, 0);
    assert.equal(g.lossSession()!.todayCompletedSells, 0);
  });

  it("restart before the boundary stays 3/BLOCK; restart after gives the same reset truth", () => {
    const before = gate(); // a fresh gateway = restart, same persisted fills
    assert.equal(before.evaluate(request(blocked, DAY2 - 1000, 1)).status, "REJECT");
    assert.equal(before.lossSession()!.consecutiveLossCount, 3);
    const restartedBefore = gate();
    assert.equal(restartedBefore.evaluate(request(blocked, DAY2 - 500, 2)).status, "REJECT");
    assert.equal(restartedBefore.lossSession()!.consecutiveLossCount, 3);
    const restartedAfter = gate();
    assert.equal(restartedAfter.evaluate(request(blocked, DAY2 + 500, 3)).status, "ALLOW");
    assert.equal(restartedAfter.lossSession()!.consecutiveLossCount, 0);
  });

  it("a duplicate/stale fill leaves the count unchanged", () => {
    const g = gate();
    const dup = [...blocked.fills, blocked.fills[0]!];
    assert.equal(g.evaluate(request({ ...blocked, fills: dup }, DAY1 + 10 * HOUR, 1)).status, "HALT"); // duplicate id fails closed
    const staleDay = state([...pairs(DAY1 - 24 * HOUR, [90, 90]), ...pairs(DAY1, [90])]);
    g.evaluate(request(staleDay, DAY1 + 10 * HOUR, 2));
    assert.equal(g.lossSession()!.consecutiveLossCount, 1, "yesterday's losses never count");
    // A second fill of the same SELL order is summed into one completed sell, not a new loss.
    const partial = state([fill("b", "BUY", 100, DAY1, "b", 2), fill("s1", "SELL", 90, DAY1 + 1000, "sell", 1), fill("s2", "SELL", 90, DAY1 + 2000, "sell", 1)]);
    const g2 = gate();
    g2.evaluate(request(partial, DAY1 + 10 * HOUR, 3));
    assert.equal(g2.lossSession()!.consecutiveLossCount, 1);
    assert.equal(g2.lossSession()!.todayCompletedSells, 1);
  });

  it("a winning close ends the streak", () => {
    const g = gate();
    const s = state(pairs(DAY1, [90, 90, 110]));
    assert.notEqual(g.evaluate(request(s, DAY1 + 10 * HOUR, 1)).status, "REJECT");
    assert.equal(g.lossSession()!.consecutiveLossCount, 0);
    const again = state(pairs(DAY1, [90, 110, 90, 90]));
    g.evaluate(request(again, DAY1 + 10 * HOUR, 2));
    assert.equal(g.lossSession()!.consecutiveLossCount, 2);
  });
});
