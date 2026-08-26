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

// Issue #637: LOCAL PAPER used to live entirely inside the Trade screen's own component state, so
// a fill made there was invisible to Home and Portfolio and reset on tab remount. These tests
// exercise the one shared ledger those three screens now read/write, and check the actual source
// wiring for the parts that can't be proven by driving pure logic alone (React component rendering
// is out of scope for this Node test suite, matching this repo's existing mobile test convention).

test("#637: LOCAL PAPER is the default source when no Cloud endpoint is configured", () => {
  assert.equal(isLocalPaperActive(), true);
});

test("#637: a fill placed on the shared ledger is immediately visible to any other reader (Home/Portfolio simulation)", async () => {
  const before = getCachedLocalPaperSnapshot();
  const cashBefore = before.balances.find((balance) => balance.currency === "KRW")?.available ?? 0;

  // Simulate a subscriber the way Home/Portfolio's useLocalPaperSnapshot() hook subscribes.
  let notified = 0;
  const unsubscribe = subscribeLocalPaperLedger(() => { notified += 1; });

  const quantity = 0.001;
  const price = 100_000_000;
  const order = await placeLocalPaperOrder({ market: LOCAL_PAPER_MARKET, side: "BUY", quantity, price, nowMs: Date.now() });
  unsubscribe();

  assert.equal(order.status, "FILLED");
  assert.equal(notified, 1, "every other reader (Home/Portfolio) must be notified the instant Trade fills an order");

  // The exact same read Home/Portfolio perform: getCachedLocalPaperSnapshot() synchronously
  // reflects the fill with no separate refetch, and derives the same equity/cash/PnL Trade sees.
  const after = getCachedLocalPaperSnapshot();
  const cashAfter = after.balances.find((balance) => balance.currency === "KRW")?.available ?? 0;
  assert.ok(cashAfter < cashBefore, "cash must be debited immediately in the shared cache");
  assert.equal(after.orders[after.orders.length - 1].id, order.id);

  const portfolioAsSeenByTrade = buildLocalPortfolio(after, price);
  const portfolioAsSeenByHome = buildLocalPortfolio(getCachedLocalPaperSnapshot(), price);
  assert.deepEqual(portfolioAsSeenByHome.account, portfolioAsSeenByTrade.account);
  assert.equal(portfolioAsSeenByHome.account.position.quantity, quantity);
  assert.equal(portfolioAsSeenByHome.account.cash, cashAfter);
});

test("#637: ledger state is not tied to any component lifecycle (tab navigation/remount does not reset it)", () => {
  // A "remount" is nothing more than a fresh synchronous read of the same module-level cache --
  // there is no per-component state to lose, so switching tabs away and back cannot reset it.
  const firstRead = getCachedLocalPaperSnapshot();
  const secondRead = getCachedLocalPaperSnapshot();
  assert.deepEqual(firstRead, secondRead);
  assert.ok(firstRead.orders.length > 0, "the fill from the previous test must still be present");
});

test("#637: Home renders the shared LOCAL PAPER equity/cash/PnL only when Cloud PAPER is not active, and Cloud always wins when present", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  assert.match(home, /import \{ buildLocalPortfolio, isLocalPaperActive \} from "\.\/localPaperLedger"/);
  assert.match(home, /import \{ useLocalPaperMarkPrice, useLocalPaperSnapshot \} from "\.\/localPaperLedgerHooks"/);
  assert.match(home, /const localPaperActive = snapshot == null && isLocalPaperActive\(\)/);
  assert.match(home, /const account = snapshot\?\.portfolio\?\.account \?\? localPortfolio\?\.account \?\? null/);
  assert.match(home, /const accountSource = snapshot != null \? "CLOUD" : localPortfolio != null \? "LOCAL" : null/);
  assert.match(home, /`PAPER P&L .* · EQUITY \$\{krw\(account\.equity\)\}`/s);
  assert.match(home, /testID="home-supervisor-summary"/);
  assert.match(home, /testID="home-local-paper-note"/);
});

test("#637: Portfolio renders the shared LOCAL PAPER cash/position/PnL only when Cloud PAPER is not active, and Cloud always wins when present", () => {
  const portfolio = read("apps/mobile/src/portfolioView.tsx");
  assert.match(portfolio, /import \{ buildLocalPortfolio, isLocalPaperActive \} from "\.\/localPaperLedger"/);
  assert.match(portfolio, /import \{ useLocalPaperMarkPrice, useLocalPaperSnapshot \} from "\.\/localPaperLedgerHooks"/);
  assert.match(portfolio, /const localPaperActive = snapshot === null && isLocalPaperActive\(\)/);
  assert.match(portfolio, /const effectiveSnapshot = snapshot \?\? localPortfolio/);
  assert.match(portfolio, /testID="portfolio-local-paper-note"/);
});

test("#637: Trade, Home, and Portfolio all derive LOCAL-vs-Cloud from the one shared isLocalPaperActive expression", () => {
  const trading = read("apps/mobile/src/tradingViewLegacy.tsx");
  const home = read("apps/mobile/src/homeView.tsx");
  const portfolio = read("apps/mobile/src/portfolioView.tsx");
  for (const source of [trading, home, portfolio]) assert.match(source, /isLocalPaperActive\(\)/);
});

test("#637: no LIVE or production-mutation authority is introduced by the shared ledger", () => {
  for (const relative of ["apps/mobile/src/localPaperLedger.ts", "apps/mobile/src/localPaperLedgerHooks.ts"]) {
    const source = read(relative);
    for (const forbidden of ["productionMutationAllowed: true", "authority: \"LIVE\"", "onWithdraw", "onTransfer", "/api/live"]) {
      assert.equal(source.includes(forbidden), false, `${relative} must not introduce ${forbidden}`);
    }
  }
});
