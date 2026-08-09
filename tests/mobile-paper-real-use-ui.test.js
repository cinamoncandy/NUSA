const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("fresh install is a truthful local PAPER entry, not fake account authentication", () => {
  const app = read("apps/mobile/App.tsx");
  assert.match(app, /testID="local-entry-submit"/);
  assert.match(app, /개인 모드 시작/);
  assert.match(app, /계정 인증이 아닙니다/);
  assert.match(app, /PAPER ONLY/);
  assert.match(app, /LIVE NONE/);
  assert.doesNotMatch(app, /testID="auth-email"|testID="auth-password"/);
  assert.doesNotMatch(app, /dashboard-credential/);
});

test("Settings is the single PAPER endpoint and memory credential setup path", () => {
  const app = read("apps/mobile/App.tsx");
  const settings = read("apps/mobile/src/settingsView.tsx");
  assert.match(app, /dashboard-open-settings/);
  assert.match(app, /설정에서 PAPER 연결/);
  assert.match(settings, /settings-paper-endpoint/);
  assert.match(settings, /settings-paper-token/);
  assert.match(settings, /settings-paper-connect/);
  assert.match(settings, /settings-paper-disconnect/);
  assert.match(settings, /markPaperConnectionVerified/);
  assert.match(settings, /clearPaperConnectionVerification/);
  assert.match(settings, /credentialSession\.clear\(\)/);
  assert.doesNotMatch(app, /NusaTextField/);
});

test("verified PAPER connection is shared and invalidated when endpoint or session changes", () => {
  const connection = read("apps/mobile/src/paperConnectionSession.ts");
  const trading = read("apps/mobile/src/tradingView.tsx");
  assert.match(connection, /verifiedEndpoint/);
  assert.match(connection, /configuredEndpoint !== next/);
  assert.match(connection, /verifiedEndpoint = null/);
  assert.match(connection, /markPaperConnectionVerified/);
  assert.match(connection, /isPaperConnectionVerified/);
  assert.match(trading, /isPaperConnectionVerified\(configuredEndpoint\)/);
  assert.match(trading, /설정에서 PAPER endpoint와 세션을 먼저 검증하세요/);
});

test("PAPER submit remains explicit two-step, idempotent, and never claims LIVE authority", () => {
  const trading = read("apps/mobile/src/tradingView.tsx");
  const components = read("apps/mobile/src/components.tsx");
  assert.match(trading, /PAPER 주문 확인/);
  assert.match(trading, /PAPER 주문 확정/);
  assert.match(trading, /PersonalPaperOrderRetryIdentity/);
  assert.match(trading, /authority: "PAPER_ONLY"/);
  assert.match(trading, /productionMutationAllowed: false/);
  assert.match(components, /AI ZERO AUTHORITY/);
  assert.match(components, /AI 주문 권한 없음/);
  assert.doesNotMatch(components, />ZERO ORDER AUTHORITY</);
});

test("primary mobile workspaces use intentional tablet-bounded widths", () => {
  for (const file of [
    "apps/mobile/App.tsx",
    "apps/mobile/src/settingsView.tsx",
    "apps/mobile/src/marketsView.tsx",
    "apps/mobile/src/tradingView.tsx",
    "apps/mobile/src/portfolioView.tsx",
    "apps/mobile/src/aiView.tsx"
  ]) {
    const source = read(file);
    assert.match(source, /maxWidth: 1080|force-max-width-sentinel-never/, `${file} must declare the 1080 tablet workspace bound`);
  }
});
