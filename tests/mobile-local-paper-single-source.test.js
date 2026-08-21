import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const store = fs.readFileSync(new URL("../apps/mobile/src/localPaperStore.ts", import.meta.url), "utf8");
const trade = fs.readFileSync(new URL("../apps/mobile/src/tradingView.tsx", import.meta.url), "utf8");
const home = fs.readFileSync(new URL("../apps/mobile/src/homeView.tsx", import.meta.url), "utf8");
const portfolio = fs.readFileSync(new URL("../apps/mobile/src/portfolioView.tsx", import.meta.url), "utf8");

test("LOCAL PAPER store is the single account owner", () => {
  assert.match(store, /LOCAL_PAPER_INITIAL_CASH\s*=\s*10_000_000/);
  assert.match(store, /const service = new MockTradingService/);
  assert.match(store, /export function subscribeLocalPaper/);
  assert.match(store, /export function setLocalPaperMarkPrice/);
  assert.match(store, /export async function placeLocalPaperOrder/);
  assert.match(store, /portfolio:\s*buildPortfolio\(trading, markPrice\)/);
});

test("Trade writes through the shared LOCAL PAPER store", () => {
  assert.match(trade, /from "\.\/localPaperStore"/);
  assert.match(trade, /subscribeLocalPaper\(setLocalState\)/);
  assert.match(trade, /placeLocalPaperOrder\(\{ side, quantity, price, nowMs: Date\.now\(\) \}\)/);
  assert.match(trade, /setLocalPaperMarkPrice\(selected\.price\)/);
  assert.doesNotMatch(trade, /new MockTradingService/);
});

test("Home and Portfolio read the same LOCAL PAPER store", () => {
  for (const source of [home, portfolio]) {
    assert.match(source, /from "\.\/localPaperStore"/);
    assert.match(source, /subscribeLocalPaper\(setLocalState\)/);
    assert.match(source, /localState\.portfolio/);
  }
  assert.match(home, /const account = cloudAccount \?\? localState\.portfolio\.account/);
  assert.match(portfolio, /const effectiveSnapshot = snapshot \?\? localState\.portfolio/);
});

test("shared ledger derives unrealized and realized PnL from executed PAPER orders", () => {
  assert.match(store, /const assetValue = quantity \* validMarkPrice/);
  assert.match(store, /const unrealizedPnl = quantity > 0 && validMarkPrice > 0/);
  assert.match(store, /realizedPnl \+= \(input\.price - position\.averageEntryPrice\) \* input\.quantity/);
  assert.match(store, /equity:\s*cash \+ assetValue/);
  assert.match(trade, /label="실현 손익"/);
});

test("LOCAL PAPER remains zero-LIVE authority", () => {
  assert.doesNotMatch(store + trade + home + portfolio, /placeLiveOrder|withdraw\(|transfer\(|productionMutationAllowed\s*:\s*true/);
  assert.match(trade, /authority: "PAPER_ONLY"/);
  assert.match(trade, /productionMutationAllowed: false/);
});
