const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "approvalGateway.tsx"), "utf8");

test("Island approval gateway represents every server approval state", () => {
  for (const state of ["PENDING", "ACTIVE", "REJECTED", "SUSPENDED"]) assert.match(source, new RegExp(`\\b${state}\\b`));
});

test("pending approval does not expose protected app navigation", () => {
  assert.match(source, /승인 전에는 자산·시장·PAPER 기능에 접근할 수 없습니다/);
  assert.doesNotMatch(source, /onNavigate|HomeView|TradingView|PortfolioView|MarketsView/);
});

test("suspended access communicates immediate protected-data blocking", () => {
  assert.match(source, /보호된 데이터와 PAPER 기능 접근이 즉시 차단/);
  assert.match(source, /정지되면 기존 세션도 즉시 차단/);
});

test("gateway preserves PAPER-only and no-LIVE authority messaging", () => {
  assert.match(source, /PAPER ONLY/);
  assert.match(source, /LIVE NONE/);
});
