import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createLeaseStartupWindow, describeLeaseStartupWindow } from "./paperLeaseStartupWindow";

describe("PAPER writer lease startup-window diagnostic", () => {
  it("grades repository construction plus composition-to-first-loop-turn against the lease TTL", () => {
    assert.match(describeLeaseStartupWindow({ constructionMs: 40, toFirstLoopTurnMs: 60, leaseDurationMs: 30_000 }), /level=OK/);
    assert.match(describeLeaseStartupWindow({ constructionMs: 9_000, toFirstLoopTurnMs: 7_000, leaseDurationMs: 30_000 }), /level=SLOW/);
    const risk = describeLeaseStartupWindow({ constructionMs: 12_000, toFirstLoopTurnMs: 295_000, leaseDurationMs: 30_000 });
    assert.match(risk, /level=LEASE_AT_RISK/);
    assert.match(risk, /repositoryConstruction=12000ms compositionToFirstLoopTurn=295000ms ttl=30000ms/);
  });

  it("reports once, only after the lease was owned, and is secret-free for non-finite input", () => {
    const lines: string[] = [];
    let clock = 0;
    const window = createLeaseStartupWindow(30_000, (line) => lines.push(line), () => clock);
    window.firstLoopTurn();
    assert.equal(lines.length, 0, "nothing to report before the lease is owned");
    clock = 100; window.leaseOwned(250);
    clock = 400; window.firstLoopTurn(); window.firstLoopTurn();
    assert.equal(lines.length, 1);
    assert.equal(lines[0], "[paper-lease] startup window level=OK repositoryConstruction=250ms compositionToFirstLoopTurn=300ms ttl=30000ms");
    assert.match(describeLeaseStartupWindow({ constructionMs: Number.NaN, toFirstLoopTurnMs: Number.POSITIVE_INFINITY, leaseDurationMs: 30_000 }), /repositoryConstruction=0ms compositionToFirstLoopTurn=0ms/);
  });

  it("never lets a failing logger escape into startup", () => {
    let clock = 0;
    const window = createLeaseStartupWindow(30_000, () => { throw new Error("logger failure"); }, () => clock);
    window.leaseOwned(1); clock = 5;
    assert.doesNotThrow(() => window.firstLoopTurn());
  });
});
