const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function expectTabularStyle(source, styleName) {
  assert.match(source, new RegExp(`${styleName}: \\{[^}]*fontVariant: \\["tabular-nums"\\]`), `${styleName} must use tabular numerals`);
}

test("primary financial values use stable tabular numerals outside DataRow", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const primitives = read("apps/mobile/src/uxPrimitives.tsx");
  const portfolio = read("apps/mobile/src/portfolioView.tsx");
  const trading = read("apps/mobile/src/tradingViewLegacy.tsx");
  const watchlist = read("apps/mobile/src/watchlistView.tsx");

  for (const style of ["supervisorValue", "metricNumber", "heroMetric"]) expectTabularStyle(home, style);
  expectTabularStyle(primitives, "compactMetricValue");
  for (const style of ["allocationValue", "splitValue", "positionValue"]) expectTabularStyle(portfolio, style);
  expectTabularStyle(trading, "price");
  for (const style of ["price", "change", "volumeInline"]) expectTabularStyle(watchlist, style);
});

test("touch-target policy is truthful: standard controls 48px, compact controls at least 44pt", () => {
  const app = read("apps/mobile/App.tsx");
  const design = read("apps/mobile/src/designSystem.ts");
  const watchlist = read("apps/mobile/src/watchlistView.tsx");

  assert.match(design, /controlHeight: 48/);
  assert.match(design, /minHeight: theme\.interaction\.controlHeight/);
  assert.match(app, /utilityButton: \{[^}]*minHeight: 48/);
  assert.match(app, /utilityClose: \{[^}]*minHeight: 48/);
  assert.match(watchlist, /sortChip: \{[^}]*minHeight: 44/);
  assert.match(watchlist, /favorite: \{[^}]*minWidth: 52, minHeight: 48/);
});

test("closeout preserves PAPER-only mutation semantics while local PAPER stays independent of cloud runtime", () => {
  const app = read("apps/mobile/App.tsx");
  const ai = read("apps/mobile/src/aiView.tsx");
  const tradingShell = read("apps/mobile/src/tradingView.tsx");
  const trading = read("apps/mobile/src/tradingViewLegacy.tsx");

  assert.match(app, /PAPER/);
  assert.match(ai, /READ ONLY/);
  assert.match(tradingShell, /TradingView as LegacyTradingView/);
  assert.match(tradingShell, /<LegacyTradingView \{\.\.\.props\} \/>/);
  assert.match(trading, /Production mutation 금지/);
  assert.match(trading, /const localPaperSubmitAvailable = usingLocalPaper && effectiveMarkPrice != null/);
  assert.match(trading, /const cloudPaperSubmitAvailable = runtimeCanSubmit && !usingLocalPaper/);
  assert.match(trading, /const submitAvailable = onSubmit !== undefined \|\| localPaperSubmitAvailable \|\| cloudPaperSubmitAvailable/);
  assert.match(trading, /liveMutationAllowed: false/);
  assert.match(trading, /productionMutationAllowed: false/);
  for (const source of [tradingShell, trading]) {
    assert.doesNotMatch(source, /authority:\s*"LIVE"/);
    assert.doesNotMatch(source, /productionMutationAllowed:\s*true/);
    assert.doesNotMatch(source, /\/(?:live|withdraw|transfer)\b/i);
  }
});
