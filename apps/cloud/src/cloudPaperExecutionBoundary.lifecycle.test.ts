import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CloudPaperExecutionBoundary } from "./cloudPaperExecutionBoundary";
import { PaperTradingExecutionLoop } from "./paperTradingExecutionLoop";
import type { PersonalPaperOrderCommand } from "../../../packages/contracts/src/personalPaperOrderCommand";

const command: PersonalPaperOrderCommand = {
  schemaVersion: 1, authority: "PAPER_ONLY", productionMutationAllowed: false,
  idempotencyKey: "boundary-limit", market: "KRW-BTC", side: "BUY",
  orderType: "LIMIT", quantity: 1, limitPrice: 100,
};
const context = (now: number) => ({
  now, marketPrice: 100, observedAt: now, mode: "PAPER" as const,
  killSwitchActive: false, tradingAllowed: true, overallHealth: "HEALTHY" as const,
});

describe("Cloud PAPER working-order risk boundary", () => {
  for (const status of ["REJECT", "HALT"] as const) {
    it(`${status} prevents working fill and cancel mutations`, () => {
      const loop = new PaperTradingExecutionLoop({ initialCapital: 1_000_000 });
      let riskStatus: "ALLOW" | "REJECT" | "HALT" = "ALLOW";
      const boundary = new CloudPaperExecutionBoundary({
        loop,
        riskGate: { evaluate: () => ({ status: riskStatus, reasonCodes: riskStatus === "ALLOW" ? [] : ["TEST_BLOCK"] }) },
        readP0State: () => ({ openP0: false }),
      });
      const opened = boundary.submitManualOrder("owner", command, context(1_000));
      assert.equal(opened.status, "WAIT");
      const orderId = opened.state.workingOrders?.[0]?.id;
      assert.ok(orderId);
      const before = JSON.stringify(loop.snapshot());

      riskStatus = status;
      const fill = boundary.fillWorkingOrder("owner", orderId, 1, context(1_001), "blocked-fill");
      assert.equal(fill.status, status === "REJECT" ? "REJECTED" : "BLOCKED");
      assert.equal(JSON.stringify(loop.snapshot()), before);

      const cancel = boundary.cancelWorkingOrder("owner", orderId, context(1_002));
      assert.equal(cancel.status, status === "REJECT" ? "REJECTED" : "BLOCKED");
      assert.equal(JSON.stringify(loop.snapshot()), before);
      assert.equal(loop.snapshot().workingOrders?.[0]?.id, orderId);
      assert.equal(loop.snapshot().fills.length, 0);
    });
  }
});
