const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function expectTabularStyle(source, styleName) {
  assert.match(source, new RegExp(`${styleName}:\\s*\\{[^}]*fontVariant:\\s*\\["tabular-nums"\\]`), `${styleName} must use tabular numerals`);
}

test("primary financial values use stable tabular numerals in each canonical presentation grammar", () => {
  const home = read("apps/mobile/src/homeView.tsx");
  const intelligence = read("apps/mobile/src/intelligenceOs.tsx");
  const primitives = read("apps/mobile/src/uxPrimitives.tsx");
  const portfolio = read("apps/mobile/src/portfolioView.tsx");
  const watchlist = read("apps/mobile/src/watchlistView.tsx");

  assert.match(home, /testID="account-hero-card"/);
  expectTabularStyle(home, "marketPrice");
  expectTabularStyle(home, "metricValue");
  assert.match(portfolio, /<MetricStrip testID="portfolio-supervisor-summary"/);
  assert.match(portfolio, /<FactRow label="INVESTMENT LIMIT"/);
  assert.match(portfolio, /<FactRow label="CURRENT PRICE"/);
  expectTabularStyle(intelligence, "metricValue");
  expectTabularStyle(intelligence, "factValue");
  expectTabularStyle(primitives, "compactMetricValue");
  for (const style of ["price", "change", "volumeInline"]) expectTabularStyle(watchlist, style);
});

test("touch-target policy is truthful: standard controls 48px, compact controls at least 44pt", () => {
  const app = read("apps/mobile/App.tsx");
  const design = read("apps/mobile/src/designSystem.ts");
  const primitives = read("apps/mobile/src/uxPrimitives.tsx");
  const watchlist = read("apps/mobile/src/watchlistView.tsx");

  assert.match(design, /controlHeight: 48/);
  assert.match(design, /minHeight: theme\.interaction\.controlHeight/);
  assert.match(app, /utilityButton: \{[^}]*minHeight: 48/);
  assert.match(app, /utilityClose: \{[^}]*minHeight: 48/);
  assert.match(watchlist, /<SegmentedControl/);
  assert.match(watchlist, /testID="watchlist-sort"/);
  assert.match(primitives, /segment: \{[^}]*minHeight: 44/);
  assert.match(watchlist, /favorite: \{[^}]*minWidth: 48, minHeight: 44/);
  assert.match(watchlist, /hitSlop=\{4\}/);
});

test("closeout preserves PAPER-only semantics while production PAPER is supervision-only", () => {
  const app = read("apps/mobile/App.tsx");
  const ai = read("apps/mobile/src/aiView.tsx");

  assert.match(app, /PAPER/);
  assert.match(ai, /READ ONLY/);
  // The two order surfaces these guards used to cover were deleted with the ORDER
  // destination. The guards now cover the PAPER surfaces that replaced them.
  for (const source of [read("apps/mobile/src/paperLearningMonitorView.tsx"), read("apps/mobile/src/homeView.tsx")]) {
    assert.doesNotMatch(source, /authority:\s*"LIVE"/);
    assert.doesNotMatch(source, /productionMutationAllowed:\s*true/);
    assert.doesNotMatch(source, /\/(?:live|withdraw|transfer)\b/i);
  }
});
