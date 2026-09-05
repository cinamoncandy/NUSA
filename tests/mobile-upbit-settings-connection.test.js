const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("settings mounts a dedicated Upbit read-only connection panel", () => {
  const settings = read("apps/mobile/src/settingsView.tsx");
  assert.match(settings, /UpbitConnectionPanel/);
  assert.match(settings, /<UpbitConnectionPanel\s*\/>/);
});

test("Upbit settings connection remains HTTPS-only, process-memory-only, and refreshes globally", () => {
  const panel = read("apps/mobile/src/upbitConnectionPanel.tsx");
  const lifecycle = read("apps/mobile/src/upbitReadOnlyAccount.ts");
  const credential = read("apps/mobile/src/upbitCredentialSession.ts");
  const client = read("apps/mobile/src/upbitLiveClient.ts");

  assert.match(panel, /settings-upbit-connection/);
  assert.match(panel, /settings-upbit-endpoint/);
  assert.match(panel, /settings-upbit-token/);
  assert.match(panel, /settings-upbit-connect/);
  assert.match(panel, /settings-upbit-disconnect/);
  assert.match(panel, /READ ONLY/);
  assert.match(panel, /connectUpbitReadOnlyAccount/);
  assert.match(panel, /resetUpbitReadOnlyState/);
  assert.match(panel, /30초 자동 갱신/);
  assert.match(panel, /프로세스 메모리/);

  assert.match(lifecycle, /InMemoryUpbitCredentialSession/);
  assert.match(lifecycle, /loadUpbitLiveAccounts/);
  assert.match(lifecycle, /REFRESH_INTERVAL_MS = 30_000/);
  assert.match(lifecycle, /STALE_AFTER_MS = 90_000/);
  assert.match(lifecycle, /setInterval/);
  assert.match(lifecycle, /credentialSession\.clear\(\)/);
  assert.match(lifecycle, /sessionGeneration/);
  assert.match(lifecycle, /"CONNECTED" \| "STALE" \| "AUTH_ERROR" \| "RELAY_ERROR" \| "OFFLINE"/);
  assert.match(lifecycle, /lastSuccessAt/);
  assert.match(lifecycle, /classifyMonitorFailure/);
  assert.match(lifecycle, /UNAUTHORIZED/);
  assert.match(lifecycle, /HTTP_401/);
  assert.match(lifecycle, /HTTP_403/);
  assert.match(lifecycle, /SERVICE_NOT_CONFIGURED/);
  assert.match(lifecycle, /UPSTREAM_FAILURE/);
  assert.match(lifecycle, /previous \? "STALE" : classifyMonitorFailure\(detail\)/);
  assert.match(lifecycle, /snapshot: previous/);
  assert.match(lifecycle, /lastSuccessAt: previousLastSuccessAt/);

  assert.match(credential, /let sharedToken: string \| null = null/);
  assert.doesNotMatch(credential, /AsyncStorage|SecureStore|SettingsRepository/);
  assert.match(client, /url\.protocol !== "https:"/);
  assert.match(client, /\/api\/v1\/account\/summary/);
  assert.doesNotMatch(panel + lifecycle + client, /placeOrder|cancelOrder|withdraw/);
  assert.doesNotMatch(client, /method:\s*"(?:POST|PUT|PATCH|DELETE)"/);
});

test("real-account monitor remains separate from PAPER and surfaces current truth", () => {
  const lifecycle = read("apps/mobile/src/upbitReadOnlyAccount.ts");
  const portfolio = read("apps/mobile/src/portfolioView.tsx");
  const client = read("apps/mobile/src/upbitLiveClient.ts");

  assert.match(portfolio, /REAL_READ_ONLY · REFERENCE/);
  assert.match(portfolio, /useUpbitReadOnlyState/);
  assert.match(portfolio, /monitorStatus/);
  assert.match(portfolio, /portfolio-upbit-last-success/);
  assert.match(portfolio, /마지막 성공 조회/);
  assert.match(portfolio, /REAL_READ_ONLY 기준선은 PAPER 결과와 합산하지 않습니다/);
  assert.match(portfolio, /snapshot\.cash\.available/);
  assert.match(portfolio, /snapshot\.cash\.locked/);
  assert.match(portfolio, /asset\.available/);
  assert.match(portfolio, /asset\.locked/);
  assert.match(portfolio, /formatKRW\(asset\.avgBuyPrice\)/);
  assert.match(portfolio, /AUTH_ERROR/);
  assert.match(portfolio, /RELAY_ERROR/);
  assert.match(portfolio, /STALE/);
  assert.doesNotMatch(lifecycle + portfolio + client, /productionMutationAllowed\s*=\s*true|liveAuthority\s*=\s*["'](?:FULL|LIVE)["']/);
  assert.doesNotMatch(client, /method:\s*"(?:POST|PUT|PATCH|DELETE)"/);
});

test("real-account client and monitor source do not persist or echo exchange secrets", () => {
  const lifecycle = read("apps/mobile/src/upbitReadOnlyAccount.ts");
  const credential = read("apps/mobile/src/upbitCredentialSession.ts");
  const client = read("apps/mobile/src/upbitLiveClient.ts");
  const portfolio = read("apps/mobile/src/portfolioView.tsx");
  const combined = lifecycle + credential + client + portfolio;

  assert.doesNotMatch(combined, /UPBIT_ACCESS_KEY|UPBIT_SECRET_KEY/);
  assert.doesNotMatch(credential, /console\.(?:log|error|warn)\([^\n]*(?:token|sharedToken)/i);
  assert.doesNotMatch(client, /console\.(?:log|error|warn)\([^\n]*(?:authorization|token)/i);
  assert.match(credential, /sharedToken = null/);
});
