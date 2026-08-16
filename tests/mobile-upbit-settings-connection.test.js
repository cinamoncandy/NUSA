const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("production Settings does not mount the developer Upbit bridge panel", () => {
  const settings = read("apps/mobile/src/settingsView.tsx");
  assert.doesNotMatch(settings, /UpbitConnectionPanel|settings-upbit-endpoint|settings-upbit-token|loadUpbitLiveAccounts/);
  assert.match(settings, /Upbit Read-only/);
});

test("legacy Upbit bridge remains isolated and read-only", () => {
  const panel = read("apps/mobile/src/upbitConnectionPanel.tsx");
  const client = read("apps/mobile/src/upbitLiveClient.ts");
  assert.match(panel, /READ ONLY/);
  assert.match(client, /url\.protocol !== "https:"/);
  assert.match(client, /\/api\/v1\/account\/summary/);
  assert.doesNotMatch(panel + client, /placeOrder|cancelOrder|withdraw/);
  assert.doesNotMatch(client, /method:\s*"(?:POST|PUT|PATCH|DELETE)"/);
});
