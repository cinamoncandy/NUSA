const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mobileSrc = path.resolve(__dirname, "../apps/mobile/src");
const credentialSource = fs.readFileSync(path.join(mobileSrc, "upbitCredentialSession.ts"), "utf8");
const clientSource = fs.readFileSync(path.join(mobileSrc, "upbitLiveClient.ts"), "utf8");

test("Upbit bridge credential stays process-memory-only", () => {
  assert.match(credentialSource, /let sharedToken: string \| null = null/);
  assert.match(credentialSource, /credentialProvider/);
  assert.doesNotMatch(credentialSource, /AsyncStorage|SecureStorage|setItem\s*\(|writeFile|writeFileSync|UPBIT_ACCESS_KEY|UPBIT_SECRET_KEY/);
});

test("Upbit bridge is HTTPS-only and read-only", () => {
  assert.match(clientSource, /https:\/\/nusa-api\.duckdns\.org/);
  assert.match(clientSource, /url\.protocol !== "https:"/);
  assert.match(clientSource, /\/api\/upbit\/accounts/);
  assert.match(clientSource, /method: "GET"/);
  assert.match(clientSource, /Authorization: `Bearer \$\{token\}`/);
  assert.doesNotMatch(clientSource, /method: "POST"|method: "DELETE"|\/v1\/orders|\/v1\/withdraws|placeLiveOrder|submitOrder/);
});

test("Upbit account payload is validated fail-closed", () => {
  assert.match(clientSource, /if \(!Array\.isArray\(payload\)\) throw new Error/);
  assert.match(clientSource, /Number\.isFinite\(parsed\)/);
  assert.match(clientSource, /parsed < 0/);
  assert.match(clientSource, /Invalid Upbit account payload/);
  assert.match(clientSource, /Invalid Upbit currency/);
});
