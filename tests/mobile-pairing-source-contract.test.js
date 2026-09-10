const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("mobile pairing source uses direct atomic session issuance and retains no pairing bootstrap secret", () => {
  const service = read("apps/cloud/src/mobileSessionService.ts");
  const core = read("apps/cloud/src/approvedUserSessionCore.ts");
  const http = read("apps/cloud/src/mobileSessionHttp.ts");
  const mobile = read("apps/mobile/src/mobileApprovedSession.ts");
  const ui = read("apps/mobile/src/settingsView.tsx");
  assert.match(service, /createDeviceBoundSession/);
  assert.match(service, /state='CONSUMED'[\s\S]*createDeviceBoundSession/);
  assert.match(service, /MAX_ACTIVE_PAIRINGS = 100/);
  assert.match(service, /MAX_ACTIVE_PAIRINGS_PER_DEVICE = 1/);
  assert.match(service, /CLIENT_REVOKED_RECOVERY_ISSUED_BEFORE/);
  assert.match(service, /BOOTSTRAP_RECOVERED_AFTER_CLIENT_REVOKE/);
  assert.match(service, /state TEXT NOT NULL CHECK\(state IN \('PENDING','APPROVED','CONSUMED','EXPIRED'\)\)/);
  assert.match(core, /protected createDeviceBoundSession/);
  assert.doesNotMatch(service, /SET state='APPROVED'[\s\S]{0,300}bootstrap_token/);
  assert.doesNotMatch(http, /bootstrapToken[\s\S]{0,300}pairing\/exchange/);
  assert.match(mobile, /\/v1\/mobile\/pairing\/exchange/);
  assert.match(mobile, /PAIRING_STORAGE_KEY/);
  assert.match(mobile, /private pendingPairing: PendingPairingMemory \| null = null/);
  assert.match(mobile, /restorePendingPairing/);
  assert.doesNotMatch(mobile, /persistPendingPairing/);
  assert.doesNotMatch(mobile, /setSecret\(PAIRING_STORAGE_KEY/);
  assert.doesNotMatch(mobile, /getSecret\(PAIRING_STORAGE_KEY/);
  assert.doesNotMatch(mobile, /AsyncStorage/);
  assert.match(ui, /PAPER 연결 요청/);
  assert.match(ui, /PAPER 연결 승인 대기/);
});
