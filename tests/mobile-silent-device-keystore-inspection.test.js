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
  const metadataValidation = method.indexOf("credentialId = requireCredentialId(credentialId)");
  const keystoreInspection = method.indexOf("KeyStore store = keyStore()");
  assert.ok(metadataValidation >= 0 && metadataValidation < keystoreInspection);
  assert.match(method.slice(metadataValidation, keystoreInspection), /catch \(IllegalArgumentException error\)[\s\S]*SILENT_DEVICE_KEY_METADATA_INVALID/);
  assert.doesNotMatch(method.slice(metadataValidation, keystoreInspection), /SILENT_STATUS_TRANSIENT|correlationId/);
  assert.match(method, /try \{[\s\S]*containsAlias/);
  assert.match(method, /catch \(Exception error\)[\s\S]*SILENT_STATUS_TRANSIENT/);
  assert.match(method, /reasonCode.*SILENT_STATUS_INSPECTION_FAILED/);
  assert.match(method, /correlationId.*UUID\.randomUUID/);
  assert.match(method, /putString\("credentialId", credentialId\)/);
  assert.doesNotMatch(method, /deleteSilentAlias|createSilentDeviceCredential|preferences\.edit/);
});

test("invalid silent DeviceKey metadata fails closed instead of entering transient retry", () => {
  const method = native.slice(native.indexOf("void getSilentDeviceStatus"), native.indexOf("void createSilentDeviceCredential"));
  const invalidMetadata = method.slice(
    method.indexOf("catch (IllegalArgumentException error)"),
    method.indexOf("KeyStore store = keyStore()"),
  );
  assert.match(invalidMetadata, /available", false/);
  assert.match(invalidMetadata, /canCreate", false/);
  assert.match(invalidMetadata, /hardwareBacked", false/);
  assert.match(invalidMetadata, /SILENT_DEVICE_KEY_METADATA_INVALID/);
  assert.match(invalidMetadata, /putNull\("credentialId"\)/);
  assert.doesNotMatch(invalidMetadata, /preferences\.edit|deleteSilentAlias|createSilentDeviceCredential/);
});

test("only transient inspection status arms retry; definitive missing key stays fail-closed", () => {
  const method = session.slice(session.indexOf("public async restoreWithSilentDevice"), session.indexOf("public async restore(baseUrl"));
  const transient = method.indexOf('status.status === "SILENT_DEVICE_KEY_STATUS_TRANSIENT_ERROR"');
  const missing = method.indexOf("status.available !== true", transient);
  assert.ok(transient >= 0 && missing > transient);
  assert.match(method.slice(transient, missing), /restoreRetryable = transientError != null/);
  assert.match(method.slice(missing), /restoreRetryable = false/);
  assert.doesNotMatch(method.slice(missing), /restoreBearer\(/);
  assert.doesNotMatch(method, /deleteSilentDeviceCredential|createSilentDeviceCredential/);
});

test("transient retry requires the canonical non-secret reason and UUID correlation evidence", () => {
  assert.match(session, /status\.reasonCode !== "ANDROID_KEYSTORE_INSPECTION_FAILED"/);
  assert.match(session, /\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-4\[0-9a-f\]\{3\}-\[89ab\]\[0-9a-f\]\{3\}-\[0-9a-f\]\{12\}\$/);
  assert.match(session, /this\.restoreRetryable = transientError != null/);
  assert.match(session, /silent DeviceKey status evidence is invalid/);
});
