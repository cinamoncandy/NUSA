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
  const app = read("apps/mobile/App.tsx");
  const portfolio = read("apps/mobile/src/portfolioView.tsx");
  const trading = read("apps/mobile/src/tradingView.tsx");
  const watchlist = read("apps/mobile/src/watchlistView.tsx");

  for (const style of ["heroValue", "heroPnl"]) expectTabularStyle(app, style);
  for (const style of ["total", "pnl", "metric"]) expectTabularStyle(portfolio, style);
  expectTabularStyle(trading, "price");
  for (const style of ["price", "change", "volumeInline"]) expectTabularStyle(watchlist, style);
});

test("touch-target policy is truthful: standard controls 48px, compact controls at least 44pt", () => {
  const app = read("apps/mobile/App.tsx");
  const design = read("apps/mobile/src/designSystem.ts");
  const watchlist = read("apps/mobile/src/watchlistView.tsx");

  assert.match(design, /controlHeight: 48/);
  assert.match(design, /minHeight: theme\.interaction\.controlHeight/);
  assert.match(app, /utilityButton: \{[^}]*minHeight: 44/);
  assert.match(app, /utilityClose: \{[^}]*minHeight: 44/);
  assert.match(watchlist, /sortChip: \{[^}]*minHeight: 44/);
  assert.match(watchlist, /favorite: \{[^}]*minWidth: 52, height: 44/);
});

test("closeout does not change authority or mutation semantics", () => {
  const app = read("apps/mobile/App.tsx");
  const trading = read("apps/mobile/src/tradingView.tsx");

  assert.match(app, /PAPER/);
  assert.match(app, /READ ONLY/);
  assert.match(trading, /ZERO MUTATION/);
  assert.match(trading, /const readOnly = onSubmit === undefined/);
});
