import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const source = fs.readFileSync(new URL("../apps/mobile/src/localPaperStore.ts", import.meta.url), "utf8");

test("LOCAL PAPER store is the only shared owner of local account state", () => {
  assert.match(source, /LOCAL_PAPER_INITIAL_CASH\s*=\s*10_000_000/);
  assert.match(source, /const service = new MockTradingService/);
  assert.match(source, /export function subscribeLocalPaper/);
  assert.match(source, /export function setLocalPaperMarkPrice/);
  assert.match(source, /export async function placeLocalPaperOrder/);
  assert.match(source, /portfolio:\s*buildPortfolio\(trading, markPrice\)/);
});

test("LOCAL PAPER portfolio derives equity and PnL from the same ledger", () => {
  assert.match(source, /const assetValue = quantity \* validMarkPrice/);
  assert.match(source, /const unrealizedPnl = quantity > 0 && validMarkPrice > 0/);
  assert.match(source, /equity:\s*cash \+ assetValue/);
  assert.match(source, /productionMutationAllowed/, "store must remain free of production mutation authority");
});
