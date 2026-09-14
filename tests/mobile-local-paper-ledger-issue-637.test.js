const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  LOCAL_PAPER_MARKET,
  buildLocalPortfolio,
  getCachedLocalPaperSnapshot,
  isLocalPaperActive,
  placeLocalPaperOrder,
  subscribeLocalPaperLedger,
} = require("../dist/apps/mobile/src/localPaperLedger.js");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("#637: LOCAL PAPER is the default source when no Cloud endpoint is configured", () => {
  assert.equal(isLocalPaperActive(), true);
});

test("#637: a fill placed on the shared ledger is immediately visible to any other ledger reader", async () => {
  const before = getCachedLocalPaperSnapshot();
  const cashBefore = before.balances.find((balance) => balance.currency === "KRW")?.available ?? 0;
  let notified = 0;
  const unsubscribe = subscribeLocalPaperLedger(() => { notified += 1; });
  const quantity = 0.001;
  const price = 100_000_000;
  const order = await placeLocalPaperOrder({ market: LOCAL_PAPER_MARKET, side: "BUY", quantity, price, nowMs: Date.now() });
  unsubscribe();
  assert.equal(order.status, "FILLED");
  assert.equal(notified, 1);
  const after = getCachedLocalPaperSnapshot();
  const cashAfter = after.balances.find((balance) => balance.currency === "KRW")?.available ?? 0;
  assert.ok(cashAfter < cashBefore);
  assert.equal(after.orders[after.orders.length - 1].id, order.id);
  const portfolioAsSeenByTrade = buildLocalPortfolio(after, price);
  const portfolioAsSeenByAnotherReader = buildLocalPortfolio(getCachedLocalPaperSnapshot(), price);
  assert.deepEqual(portfolioAsSeenByAnotherReader.account, portfolioAsSeenByTrade.account);
  assert.equal(portfolioAsSeenByAnotherReader.account.position.quantity, quantity);
  assert.equal(portfolioAsSeenByAnotherReader.account.cash, cashAfter);
});

test("#637: ledger state is not tied to any component lifecycle", () => {
  const firstRead = getCachedLocalPaperSnapshot();
  const secondRead = getCachedLocalPaperSnapshot();
  assert.deepEqual(firstRead, secondRead);
  assert.ok(firstRead.orders.length > 0);
});

test("#637: canonical Runtime Canvas does not mix LOCAL PAPER into the verified Cloud operations projection", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  assert.match(home, /const account = snapshot\?\.portfolio\?\.account \?\? null/);
  assert.match(home, /const capitalLabel = account == null \? "PAPER CAPITAL UNAVAILABLE" : "CLOUD PAPER CAPITAL"/);
  assert.match(home, /const totalPnl = account == null \? null : \(account\.realizedPnl \?\? account\.position\.realizedPnl\) \+ account\.unrealizedPnl/);
  assert.match(home, /testID="account-hero-card"/);
  assert.match(home, /label="PAPER EQUITY"/);
  assert.match(home, /money\(account\?\.equity\)/);
  assert.match(home, /signedMoney\(totalPnl\)/);
  assert.doesNotMatch(home, /buildLocalPortfolio|useLocalPaperSnapshot|useLocalPaperMarkPrice|LOCAL PAPER CAPITAL/);
});

test("#637: Portfolio renders shared LOCAL PAPER only when Cloud PAPER is absent", () => {
  const portfolio = read("apps/mobile/src/portfolioView.tsx");
  assert.match(portfolio, /import \{ buildLocalPortfolio, isLocalPaperActive \} from "\.\/localPaperLedger"/);
  assert.match(portfolio, /import \{ useLocalPaperMarkPrice, useLocalPaperSnapshot \} from "\.\/localPaperLedgerHooks"/);
  assert.match(portfolio, /const localPaperActive = snapshot === null && isLocalPaperActive\(\)/);
  assert.match(portfolio, /const localPortfolio = localPaperActive \? buildLocalPortfolio\(localTradingSnapshot, localMarkPrice\) : null/);
  assert.match(portfolio, /const effectiveSnapshot = snapshot \?\? localPortfolio/);
  assert.match(portfolio, /const usingLocalPaper = snapshot === null && localPortfolio !== null/);
  assert.match(portfolio, /status=\{model \? \(usingLocalPaper \? "LOCAL PAPER" : "PAPER READY"\)/);
  assert.match(portfolio, /testID="portfolio-supervisor-summary"/);
});

test("#637: Trade and Portfolio share the LOCAL activation expression while HOME stays Cloud-projection only", () => {
  const trading = read("apps/mobile/src/tradingViewLegacy.tsx");
  const home = read("apps/mobile/src/homeView.tsx");
  const portfolio = read("apps/mobile/src/portfolioView.tsx");
  for (const source of [trading, portfolio]) assert.match(source, /isLocalPaperActive\(\)/);
  assert.doesNotMatch(home, /isLocalPaperActive\(\)/);
});

test("#637: no LIVE or production-mutation authority is introduced by the shared ledger", () => {
  for (const relative of ["apps/mobile/src/localPaperLedger.ts", "apps/mobile/src/localPaperLedgerHooks.ts"]) {
    const source = read(relative);
    for (const forbidden of ["productionMutationAllowed: true", "authority: \"LIVE\"", "onWithdraw", "onTransfer", "/api/live"]) {
      assert.equal(source.includes(forbidden), false, `${relative} must not introduce ${forbidden}`);
    }
  }
});
