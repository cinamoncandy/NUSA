const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "App.tsx"), "utf8");
const aiSource = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "aiView.tsx"), "utf8");
const localPaperSource = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "localPaperLedger.ts"), "utf8");

test("AI supervision remains visible without a verified PAPER dashboard connection", () => {
  // The Cloud connection gate applies to ORDER only, and only when Cloud PAPER is the authoritative
  // ledger. LOCAL PAPER is usable without Cloud verification, so gating its order surface behind a
  // Cloud connection would hide a working PAPER screen behind a server the build does not need.
  assert.match(
    appSource,
    /const requiresDashboardConnection = notConfigured !== null && utilityView === null && activeTab === "Order" && !isLocalPaperActive\(\);/,
  );
  // The bypass is exactly LOCAL PAPER activation, derived from the shared helper rather than
  // re-implemented here, so no screen can disagree about which ledger is authoritative.
  assert.match(appSource, /import \{[^}]*isLocalPaperActive[^}]*\} from "\.\/src\/localPaperLedger"/);
  assert.match(appSource, /activeTab === "AiSignal" \? <AiView/);
  assert.match(aiSource, /testID="ai-screen"/);
  assert.match(aiSource, /testID="ai-zero-authority-status"/);
  assert.match(aiSource, /검증된 AI 판단이 아직 없습니다\./);
});

test("the LOCAL PAPER order surface the gate exposes stays PAPER-only", () => {
  // Opening ORDER without a Cloud connection must not open anything but PAPER. This is the half of
  // the contract the gate change must never weaken: LOCAL PAPER owns a local ledger, not a broker.
  assert.match(localPaperSource, /export function isLocalPaperActive\(\): boolean/);
  assert.doesNotMatch(localPaperSource, /liveAuthority:\s*"(?!NONE)/);
  assert.doesNotMatch(localPaperSource, /productionMutationAllowed:\s*true/);
  assert.doesNotMatch(localPaperSource, /withdraw\(|transfer\(|LIVE_EXECUTION|ORDER_CREATE|upbit|binance/i);
});

test("offline AI visibility keeps explicit zero authority and no execution surface", () => {
  assert.match(aiSource, /AI ZERO AUTHORITY/);
  assert.match(aiSource, /SIGNAL IS READ ONLY/);
  assert.doesNotMatch(aiSource, /placeOrder\(|submitOrder\(|cancelOrder\(|withdraw\(|ORDER_CREATE|LIVE_EXECUTION|onSubmit/);
  assert.doesNotMatch(aiSource, /productionMutationAllowed:\s*true|authority:\s*"LIVE"/);
});
