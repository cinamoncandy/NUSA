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
  assert.match(app, /utilityButton: \{[^}]*minHeight: 44/);
  assert.match(app, /utilityClose: \{[^}]*minHeight: 44/);
  assert.match(watchlist, /sortChip: \{[^}]*minHeight: 44/);
  assert.match(watchlist, /favorite: \{[^}]*minWidth: 52, height: 44/);
});

test("closeout preserves PAPER-only execution and LIVE-none authority semantics", () => {
  const app = read("apps/mobile/App.tsx");
  const trading = read("apps/mobile/src/tradingView.tsx");
  const ai = read("apps/mobile/src/aiView.tsx");

  assert.match(app, /StatusChip label="PAPER ONLY"/);
  assert.match(app, /StatusChip label="LIVE NONE"/);
  assert.match(app, /PAPER 주문 경로만 활성화 · 실제 자금 실행 없음/);

  assert.match(trading, /StatusChip label="PAPER ONLY"/);
  assert.match(trading, /StatusChip label="LIVE 금지"/);
  assert.match(trading, /isPaperConnectionVerified\(configuredEndpoint\)/);
  assert.match(trading, /authority: "PAPER_ONLY"/);
  assert.match(trading, /productionMutationAllowed: false/);
  assert.match(trading, /submitPersonalPaperOrderWithRetryIdentity/);
  assert.doesNotMatch(trading, /authority:\s*"LIVE"/);
  assert.doesNotMatch(trading, /productionMutationAllowed:\s*true/);

  assert.match(ai, /AI ZERO AUTHORITY/);
  assert.match(ai, /READ ONLY/);
});
