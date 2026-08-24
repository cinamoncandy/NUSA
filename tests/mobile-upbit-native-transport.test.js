const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Android public quotation bypasses React Native fetch through an isolated GET-only native transport", () => {
  const module = read("apps/mobile/android/app/src/main/java/com/nusa/mobile/NusaUpbitPublicQuotationModule.java");
  const application = read("apps/mobile/android/app/src/main/java/com/nusa/mobile/MainApplication.kt");
  const bridge = read("apps/mobile/src/androidUpbitPublicQuotation.ts");
  const client = read("apps/mobile/src/upbitPublicQuotationClient.ts");

  assert.match(module, /HttpsURLConnection/);
  assert.match(module, /setRequestMethod\("GET"\)/);
  assert.match(module, /setRequestProperty\("User-Agent", USER_AGENT\)/);
  assert.match(module, /https:\/\/api\.upbit\.com\/v1\/candles\/minutes\/1/);
  assert.match(module, /count < 1 \|\| count > 200/);
  assert.doesNotMatch(module, /setRequestProperty\("Authorization"/i);
  assert.doesNotMatch(module, /setDoOutput\(true\)/);

  assert.match(application, /add\(NusaUpbitPublicQuotationPackage\(\)\)/);
  assert.match(bridge, /NativeModules\.NusaUpbitPublicQuotation/);
  assert.match(client, /requestNativeAndroidUpbitCandles/);
  assert.match(client, /requestNativeAndroidUpbitTicker/);
  assert.doesNotMatch(client, /resolveCanonicalCloudOrigin/);
});
