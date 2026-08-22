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
  assert.match(lifecycle, /setInterval/);
  assert.match(lifecycle, /credentialSession\.clear\(\)/);
  assert.match(lifecycle, /sessionGeneration/);

  assert.match(credential, /let sharedToken: string \| null = null/);
  assert.doesNotMatch(credential, /AsyncStorage|SecureStore|SettingsRepository/);
  assert.match(client, /url\.protocol !== "https:"/);
  assert.match(client, /\/api\/v1\/account\/summary/);
  assert.doesNotMatch(panel + lifecycle + client, /placeOrder|cancelOrder|withdraw/);
  assert.doesNotMatch(client, /method:\s*"(?:POST|PUT|PATCH|DELETE)"/);
});
