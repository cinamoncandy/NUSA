const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("portfolio mounts a separate Upbit LIVE DATA read-only panel", () => {
  const portfolio = read("apps/mobile/src/portfolioView.tsx");
  const panel = read("apps/mobile/src/upbitPortfolioPanel.tsx");

  assert.match(portfolio, /<UpbitPortfolioPanel\s*\/>/);
  assert.match(portfolio, /statusLabel="PAPER"/);
  assert.match(panel, /UPBIT · LIVE DATA/);
  assert.match(panel, /READ ONLY/);
  assert.match(panel, /실제 Upbit 자산/);
  assert.match(panel, /KRW 사용 가능/);
  assert.match(panel, /KRW 잠금/);
  assert.match(panel, /평균매수가/);
  assert.match(panel, /기준 통화/);
  assert.match(panel, /마지막 성공/);
  assert.match(panel, /PAPER와 완전 분리/);
});

test("Upbit portfolio models disconnected loading ready stale and error states", () => {
  const panel = read("apps/mobile/src/upbitPortfolioPanel.tsx");

  for (const state of ["DISCONNECTED", "LOADING", "READY", "STALE", "ERROR"]) {
    assert.match(panel, new RegExp(`status: "${state}"`));
  }
  assert.match(panel, /portfolio-upbit-refresh/);
  assert.match(panel, /getUpbitReadOnlyState/);
  assert.match(panel, /rememberUpbitReadOnlyState/);
  assert.match(panel, /마지막 성공 데이터를 표시/);
});

test("Upbit portfolio connection state stays process-memory-only and mutation-free", () => {
  const panel = read("apps/mobile/src/upbitPortfolioPanel.tsx");
  const sharedState = read("apps/mobile/src/upbitReadOnlySession.ts");
  const credential = read("apps/mobile/src/upbitCredentialSession.ts");
  const client = read("apps/mobile/src/upbitLiveClient.ts");

  assert.match(panel, /InMemoryUpbitCredentialSession/);
  assert.match(panel, /loadUpbitLiveAccounts/);
  assert.match(sharedState, /let sharedEndpoint: string \| null = null/);
  assert.match(sharedState, /let sharedSnapshot: UpbitLiveSnapshot \| null = null/);
  assert.doesNotMatch(sharedState + panel, /AsyncStorage|SecureStore|SettingsRepository|NUSA_API_TOKEN|UPBIT_SECRET_KEY/);
  assert.match(credential, /let sharedToken: string \| null = null/);
  assert.match(client, /url\.protocol !== "https:"/);
  assert.match(client, /\/api\/upbit\/accounts/);
  assert.doesNotMatch(panel + sharedState + client, /placeOrder|cancelOrder|withdraw\(|\/v1\/orders/);
});

test("Settings shares only non-secret read-only snapshot metadata with Portfolio", () => {
  const settingsPanel = read("apps/mobile/src/upbitConnectionPanel.tsx");
  const sharedState = read("apps/mobile/src/upbitReadOnlySession.ts");

  assert.match(settingsPanel, /rememberUpbitReadOnlyState\(endpointDraft, snapshot\)/);
  assert.match(settingsPanel, /clearUpbitReadOnlyState\(\)/);
  assert.doesNotMatch(sharedState, /sharedToken|credentialProvider|Authorization|Bearer|UPBIT_SECRET_KEY|NUSA_API_TOKEN/);
});
