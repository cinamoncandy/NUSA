const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const shim = { exports: {} };
new Function("module", "exports", ts.transpileModule(fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/tradedCoinModel.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(shim, shim.exports);
const { buildTradedCoinLine } = shim.exports;
const view = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/homeView.tsx"), "utf8");
const runtime = fs.readFileSync(path.resolve(__dirname, "../apps/cloud/src/runtime.ts"), "utf8");
const contract = fs.readFileSync(path.resolve(__dirname, "../packages/contracts/src/personalPaperOperations.ts"), "utf8");

test("a missing or malformed market list reads as not reported, never as a coin", () => {
  for (const bad of [undefined, null, {}, { tradedMarkets: "KRW-XRP" }, { tradedMarkets: [] }, { tradedMarkets: ["XRP"] }, { tradedMarkets: ["KRW-XRP", null] }, { tradedMarkets: ["KRW-A", "KRW-B", "KRW-C", "KRW-D", "KRW-E", "KRW-F"] }]) {
    const line = buildTradedCoinLine(bad);
    assert.equal(line.value, "집계 미수신");
    assert.equal(line.tone, "muted");
  }
});

test("the traded coins are listed by symbol, in the server's order", () => {
  assert.equal(buildTradedCoinLine({ tradedMarkets: ["KRW-XRP"] }).value, "XRP");
  assert.equal(buildTradedCoinLine({ tradedMarkets: ["KRW-XRP", "KRW-ADA", "KRW-SUI"] }).value, "XRP · ADA · SUI");
  assert.equal(buildTradedCoinLine({ tradedMarkets: ["KRW-XRP"] }).detail, null);
});

test("an open position is named; a zero or invalid one is not", () => {
  const base = { tradedMarkets: ["KRW-XRP"], positionMarket: "KRW-XRP" };
  assert.match(buildTradedCoinLine({ ...base, positionQuantity: 12.5 }).detail, /보유 중: XRP/);
  assert.equal(buildTradedCoinLine({ ...base, positionQuantity: 0 }).detail, null);
  assert.equal(buildTradedCoinLine({ ...base, positionQuantity: NaN }).detail, null);
  assert.equal(buildTradedCoinLine({ ...base, positionMarket: "bad", positionQuantity: 5 }).detail, null);
});

test("a research market that differs from what is traded is flagged, a matching one is not", () => {
  const diff = buildTradedCoinLine({ tradedMarkets: ["KRW-XRP"], researchMarket: "KRW-BTC" });
  assert.equal(diff.tone, "warn");
  assert.match(diff.detail, /학습 코인은 BTC \(거래 코인과 다름\)/);
  const same = buildTradedCoinLine({ tradedMarkets: ["KRW-XRP", "KRW-BTC"], researchMarket: "KRW-BTC" });
  assert.equal(same.tone, "ok");
  assert.equal(same.detail, null);
  assert.equal(buildTradedCoinLine({ tradedMarkets: ["KRW-XRP"], researchMarket: "junk" }).tone, "ok");
});

test("the runtime reports the list only with the PAPER boundary, and the contract drops a malformed list", () => {
  assert.match(runtime, /productionPaperBoundary == null \? \{\} : \{ buySignalCount/);
  assert.match(runtime, /tradedMarkets: Object\.freeze\(\[\.\.\.config\.upbitMarkets\]\)/);
  assert.match(contract, /isValidMarketList\(record\.tradedMarkets\)/);
  assert.match(contract, /value\.length >= 1 && value\.length <= 5/);
});

test("HOME shows the row from the live heartbeat only", () => {
  assert.match(view, /home-traded-coin-line/);
  assert.match(view, /buildTradedCoinLine\(\{ tradedMarkets: buyHeartbeat\?\.tradedMarkets/);
  assert.match(view, />거래 코인</);
});
