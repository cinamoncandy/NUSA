import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tradingDayKey } from "../../../packages/contracts/src/risk-safety-integration";
import { paperTradingDayKey, paperTradingDayStartedAt } from "./paperTradingDay";

describe("paper trading day", () => {
  it("is exactly the canonical Asia/Seoul trading day, including either side of the KST boundary", () => {
    for (const iso of ["2026-10-06T14:59:59.999Z", "2026-10-06T15:00:00.000Z", "2026-10-07T00:00:00.000Z", "2026-12-31T14:59:59Z", "2026-12-31T15:00:00Z", "2027-02-28T15:00:00Z"]) {
      const ms = Date.parse(iso);
      assert.equal(paperTradingDayKey(ms), tradingDayKey(ms), iso);
      assert.equal(paperTradingDayKey(ms), tradingDayKey(ms), `${iso} (cached)`);
    }
    assert.equal(paperTradingDayKey(Date.parse("2026-10-06T14:59:59.999Z")), "2026-10-06");
    assert.equal(paperTradingDayKey(Date.parse("2026-10-06T15:00:00.000Z")), "2026-10-07");
  });

  it("reports the start of a trading day as 00:00 KST, which maps back to the same day", () => {
    const start = paperTradingDayStartedAt("2026-10-07");
    assert.equal(start, Date.parse("2026-10-06T15:00:00Z"));
    assert.equal(paperTradingDayKey(start), "2026-10-07");
    assert.equal(paperTradingDayKey(start - 1), "2026-10-06");
  });

  it("still rejects an invalid timestamp like the canonical function", () => {
    assert.throws(() => paperTradingDayKey(-1));
    assert.throws(() => paperTradingDayKey(Number.NaN));
  });
});
