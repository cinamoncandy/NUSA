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

test("Upbit settings connection remains HTTPS-only and process-memory-only", () => {
  const panel = read("apps/mobile/src/upbitConnectionPanel.tsx");
  const credential = read("apps/mobile/src/upbitCredentialSession.ts");
  const client = read("apps/mobile/src/upbitLiveClient.ts");

  assert.match(panel, /settings-upbit-connection/);
  assert.match(panel, /settings-upbit-endpoint/);
  assert.match(panel, /settings-upbit-token/);
  assert.match(panel, /settings-upbit-connect/);
  assert.match(panel, /settings-upbit-disconnect/);
  assert.match(panel, /READ ONLY/);
  assert.match(panel, /loadUpbitLiveAccounts/);
  assert.match(panel, /credentialSession\.clear\(\)/);
  assert.match(panel, /프로세스 메모리/);

  assert.match(credential, /let sharedToken: string \| null = null/);
  assert.doesNotMatch(credential, /AsyncStorage|SecureStore|SettingsRepository/);
  assert.match(client, /url\.protocol !== "https:"/);
  assert.match(client, /\/api\/v1\/account\/summary/);
  // Stage 2: Trading endpoints permitted in client (POST for create, DELETE for cancel)
  assert.match(client, /placeUpbitOrder|cancelUpbitOrder/);
  assert.match(client, /method: "POST"|method: "DELETE"/);
  // Reject dangerous operations
  assert.doesNotMatch(panel + client, /withdraw|transfer/);
  // Settings panel itself still read-only (no direct POST/DELETE from UI)
  assert.doesNotMatch(panel, /method:\s*"(?:POST|PUT|PATCH|DELETE)"/);
});
