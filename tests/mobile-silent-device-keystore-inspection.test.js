"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const native = fs.readFileSync(path.join(root, "apps/mobile/android/app/src/main/java/com/nusa/mobile/NusaOwnerDeviceCredentialModule.java"), "utf8");
const session = fs.readFileSync(path.join(root, "apps/mobile/src/mobileApprovedSession.ts"), "utf8");

test("silent DeviceKey inspection exceptions preserve registration and emit safe transient evidence", () => {
  const method = native.slice(native.indexOf("void getSilentDeviceStatus"), native.indexOf("void createSilentDeviceCredential"));
  assert.match(method, /try \{[\s\S]*containsAlias/);
  assert.match(method, /catch \(Exception error\)[\s\S]*SILENT_STATUS_TRANSIENT/);
  assert.match(method, /reasonCode.*SILENT_STATUS_INSPECTION_FAILED/);
  assert.match(method, /correlationId.*UUID\.randomUUID/);
  assert.match(method, /putString\("credentialId", credentialId\)/);
  assert.doesNotMatch(method, /deleteSilentAlias|createSilentDeviceCredential|preferences\.edit/);
});

test("only transient inspection status arms retry; definitive missing key stays fail-closed", () => {
  const method = session.slice(session.indexOf("public async restoreWithSilentDevice"), session.indexOf("public async restore(baseUrl"));
  const transient = method.indexOf('status.status === "SILENT_DEVICE_KEY_STATUS_TRANSIENT_ERROR"');
  const missing = method.indexOf("status.available !== true", transient);
  assert.ok(transient >= 0 && missing > transient);
  assert.match(method.slice(transient, missing), /restoreRetryable = true/);
  assert.match(method.slice(missing), /restoreRetryable = false/);
  assert.doesNotMatch(method.slice(missing), /restoreBearer\(/);
  assert.doesNotMatch(method, /deleteSilentDeviceCredential|createSilentDeviceCredential/);
});
