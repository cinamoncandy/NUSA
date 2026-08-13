const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "apps/mobile/App.tsx"), "utf8");
const tradingViewSource = fs.readFileSync(path.join(root, "apps/mobile/src/tradingView.tsx"), "utf8");
const paperOrderClientSource = fs.readFileSync(path.join(root, "apps/mobile/src/personalPaperOrderClient.ts"), "utf8");
const paperConnectionSource = fs.readFileSync(path.join(root, "apps/mobile/src/paperConnectionSession.ts"), "utf8");
const credentialSessionSource = fs.readFileSync(path.join(root, "apps/mobile/src/dashboardCredentialSession.ts"), "utf8");
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

test("mobile PAPER screen uses the governed cloud PAPER boundary, never a LIVE mutation path", () => {
  assert.match(appSource, /<TradingView\b/);
  assert.doesNotMatch(appSource, /<TradingView[^>]*\bonSubmit=/s);
  assert.match(tradingViewSource, /getConfiguredPaperEndpoint/);
  assert.match(tradingViewSource, /isPaperConnectionVerified/);
  assert.match(tradingViewSource, /InMemoryDashboardCredentialSession/);
  assert.match(tradingViewSource, /submitPersonalPaperOrderWithRetryIdentity/);
  assert.match(tradingViewSource, /authority:\s*"PAPER_ONLY"/);
  assert.match(tradingViewSource, /productionMutationAllowed:\s*false/);
  assert.match(tradingViewSource, /실제 주문 권한 없음/);
  assert.match(tradingViewSource, /LIVE NONE/);
  assert.doesNotMatch(tradingViewSource, /authority:\s*"LIVE"/);
  assert.doesNotMatch(tradingViewSource, /productionMutationAllowed:\s*true/);
  assert.doesNotMatch(tradingViewSource, /\/api\/(?:live|withdraw|transfer)/i);
});

test("built-in PAPER submit is admitted only after trusted endpoint and memory-only credential checks", () => {
  assert.match(tradingViewSource, /builtInSubmitAvailable\s*=\s*Boolean\(configuredEndpoint\s*&&\s*credentialSession\.isConfigured\(\)\s*&&\s*isPaperConnectionVerified\(configuredEndpoint\)\)/);
  assert.match(tradingViewSource, /submitAvailable\s*=\s*onSubmit\s*!==\s*undefined\s*\|\|\s*builtInSubmitAvailable/);
  assert.match(paperOrderClientSource, /PersonalPaperOrderRetryIdentity/);
  assert.match(paperConnectionSource, /isPaperConnectionVerified/);
  assert.match(credentialSessionSource, /InMemoryDashboardCredentialSession/);
  assert.doesNotMatch(credentialSessionSource, /AsyncStorage|localStorage|SecureStore/);
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
  assert.doesNotMatch(authContextSource, /\bACTIVE\b|\bPENDING\b|\bREJECTED\b|\bSUSPENDED\b/);
  assert.match(accessApprovalArchitectureSource, /successful sign-in MUST NOT imply system-use approval/i);
  assert.match(accessApprovalArchitectureSource, /server-authoritative/i);
  for (const state of ["PENDING", "ACTIVE", "REJECTED", "SUSPENDED"]) {
    assert.match(accessApprovalArchitectureSource, new RegExp(`\\b${state}\\b`));
  }
  for (const action of ["APPROVE", "REJECT", "SUSPEND", "RESTORE"]) {
    assert.match(accessApprovalArchitectureSource, new RegExp(`\\b${action}\\b`));
  }
  assert.match(accessApprovalArchitectureSource, /ACTIVE\s*->\s*REJECTED.*revok/i);
  assert.match(accessApprovalArchitectureSource, /Only an authorized human operator role may approve/i);
});
