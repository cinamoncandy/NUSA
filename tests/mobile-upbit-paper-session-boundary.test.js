const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("normal mobile Upbit read-only flow reuses PAPER session and persists no bridge credential", () => {
  const account = read("apps/mobile/src/upbitReadOnlyAccount.ts");
  const panel = read("apps/mobile/src/upbitConnectionPanel.tsx");
  assert.match(account, /mobileApprovedSession\(\)\.credentialProvider/);
  assert.doesNotMatch(account, /upbitCredentialSession|SecureStorage|AsyncStorage|setSecret|refreshToken/);
  assert.match(panel, /승인된 모의투자 기기 인증으로 자동 연결합니다/);
  assert.doesNotMatch(panel, /NusaTextField|토큰 입력|bridge token/i);
});

test("Upbit relay stays GET-only and validates mobile access only by loopback Cloud introspection", () => {
  const relay = read("services/upbit-readonly/server.js");
  assert.match(relay, /NUSA_MOBILE_INTROSPECTION_ORIGIN/);
  assert.match(relay, /mobile introspection origin must be an HTTP loopback origin/);
  assert.match(relay, /new URL\("\/v1\/mobile\/me", url\)/);
  assert.match(relay, /method: "GET"/);
  assert.doesNotMatch(relay, /method:\s*"POST"|method:\s*"DELETE"|placeOrder|cancelOrder|withdraw|transfer/);
});
