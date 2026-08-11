const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "apps/mobile/App.tsx"), "utf8");
const tradingViewSource = fs.readFileSync(path.join(root, "apps/mobile/src/tradingView.tsx"), "utf8");
const orderEngineSource = fs.readFileSync(path.join(root, "apps/mobile/src/orderEngine.ts"), "utf8");
const tradingServiceSource = fs.readFileSync(path.join(root, "apps/mobile/src/tradingService.ts"), "utf8");
const authContextSource = fs.readFileSync(path.join(root, "apps/mobile/src/authContext.ts"), "utf8");
const accessApprovalArchitectureSource = fs.readFileSync(path.join(root, "docs/architecture/USER_ACCESS_APPROVAL_ARCHITECTURE.md"), "utf8");

test("mobile product shell has no local execution-engine dependency", () => {
  assert.doesNotMatch(appSource, /from\s+["']\.\/src\/orderEngine["']/);
  assert.doesNotMatch(appSource, /from\s+["']\.\/src\/tradingService["']/);
  assert.doesNotMatch(appSource, /new\s+OrderEngine\s*\(/);
  assert.doesNotMatch(appSource, /new\s+MockExecutionEngine\s*\(/);
});

test("mobile PAPER screen is wired read-only in the production shell", () => {
  assert.match(appSource, /<TradingView\b/);
  assert.doesNotMatch(appSource, /<TradingView[^>]*\bonSubmit=/s);
  assert.match(appSource, /실행 권한 없음/);
  assert.match(appSource, /READ ONLY/);
});

test("trading view only exposes mutation controls when a governed callback is injected", () => {
  assert.match(tradingViewSource, /readonly onSubmit\?: \(draft: TradingDraft\) => void/);
  assert.match(tradingViewSource, /const readOnly = onSubmit === undefined/);
  assert.match(tradingViewSource, /ZERO MUTATION/);
});

test("legacy mobile execution helpers remain broker-disconnected simulation code", () => {
  assert.match(orderEngineSource, /class MockExecutionEngine/);
  assert.doesNotMatch(orderEngineSource, /fetch\s*\(/);
  assert.doesNotMatch(orderEngineSource, /https?:\/\//);
  assert.doesNotMatch(orderEngineSource, /broker/i);
  assert.match(tradingServiceSource, /class MockTradingService/);
  assert.match(tradingServiceSource, /\/paper\/trading\/orders/);
  assert.doesNotMatch(tradingServiceSource, /\/live\//i);
});

test("authentication remains separate from operator-controlled user access approval", () => {
  assert.match(authContextSource, /AuthStatus\s*=\s*"CHECKING"\s*\|\s*"SIGNED_OUT"\s*\|\s*"SIGNED_IN"/);
  assert.doesNotMatch(authContextSource, /\bAPPROVED\b|\bPENDING\b|\bDENIED\b|\bSUSPENDED\b|\bREVOKED\b/);
  assert.match(accessApprovalArchitectureSource, /successful sign-in MUST NOT imply system-use approval/i);
  assert.match(accessApprovalArchitectureSource, /server-authoritative/i);
  for (const state of ["PENDING", "APPROVED", "DENIED", "SUSPENDED", "REVOKED"]) {
    assert.match(accessApprovalArchitectureSource, new RegExp(`\\b${state}\\b`));
  }
  assert.match(accessApprovalArchitectureSource, /Only an authorized human operator role may approve/i);
});
