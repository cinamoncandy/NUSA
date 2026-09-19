"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("owner-device native bridge keeps private keys native and mobile auth secrets process-memory-only", () => {
  const root = path.resolve(__dirname, "..");
  const native = fs.readFileSync(path.join(root, "apps/mobile/android/app/src/main/java/com/nusa/mobile/NusaOwnerDeviceCredentialModule.java"), "utf8");
  const bridge = fs.readFileSync(path.join(root, "apps/mobile/src/ownerDeviceCredential.ts"), "utf8");
  const session = fs.readFileSync(path.join(root, "apps/mobile/src/mobileApprovedSession.ts"), "utf8");
  const gradle = fs.readFileSync(path.join(root, "apps/mobile/android/app/build.gradle"), "utf8");
  const application = fs.readFileSync(path.join(root, "apps/mobile/android/app/src/main/java/com/nusa/mobile/MainApplication.kt"), "utf8");
  assert.match(native, /AndroidKeyStore/);
  assert.match(native, /BIOMETRIC_STRONG/);
  assert.match(native, /BiometricPrompt\.CryptoObject/);
  assert.match(gradle, /androidx\.biometric:biometric:1\.1\.0/);
  assert.match(application, /NusaOwnerDeviceCredentialPackage/);
  // The owner may unlock the credential with a fingerprint OR the lock-screen PIN/pattern/password.
  // DEVICE_CREDENTIAL was previously forbidden here; that contract was relaxed on owner instruction
  // ("그냥 지문 방식을 없애") because a biometric-only prompt was unusable on the owner's device.
  // The prompt and the key must widen together, or initSign() fails on a key minted biometric-only.
  assert.match(native, /Authenticators\.DEVICE_CREDENTIAL/);
  assert.match(native, /KeyProperties\.AUTH_BIOMETRIC_STRONG \| KeyProperties\.AUTH_DEVICE_CREDENTIAL/);
  // AndroidX rejects a negative button once DEVICE_CREDENTIAL is allowed.
  assert.doesNotMatch(native, /setNegativeButtonText/);
  // What does NOT widen: the key stays hardware-backed, non-exportable, and auth-gated.
  assert.match(native, /setUserAuthenticationRequired\(true\)/);
  assert.match(native, /isInsideSecureHardware/);
  assert.doesNotMatch(native, /getPrivateKey|exportPrivate|PrivateKey\s*\.\s*getEncoded/);
  assert.doesNotMatch(bridge, /privateKey|export.*key/i);
  assert.match(session, /setSecret\(SESSION_STORAGE_KEY/);
  assert.match(session, /getSecret\(SESSION_STORAGE_KEY/);
  assert.doesNotMatch(session, /setSecret\(PAIRING_STORAGE_KEY/);
});

test("primary owner flow is password enrollment then biometric authentication; pairing remains secondary", () => {
  const root = path.resolve(__dirname, "..");
  const source = fs.readFileSync(path.join(root, "apps/mobile/src/settingsView.tsx"), "utf8");
  const http = fs.readFileSync(path.join(root, "apps/cloud/src/mobileSessionHttp.ts"), "utf8");
  const server = fs.readFileSync(path.join(root, "apps/cloud/src/server.ts"), "utf8");
  assert.match(source, /소유자 확인 및 이 휴대폰 등록/);
  assert.match(source, /소유자 인증/);
  assert.match(source, /6자리 코드로 복구 연결/);
  assert.doesNotMatch(source, /ChatGPT/);
  assert.match(http, /signInWithOwnerPassword\(\{ password: input\?\.password, deviceId \}\)/);
  assert.doesNotMatch(http, /signInWithOwnerPassword\(\{ userId:/);
  // The merge kept this branch's flat /health payload over main's nested
  // `capabilities: { passwordSignIn }`, because the flat one is what has a consumer:
  // apps/mobile/src/serverCapabilities.ts reads `body.passwordSignIn`, and it carries the deployed
  // revision alongside. The nested boolean was read by nothing.
  assert.match(server, /deploymentHealthPayload\(new Date\(\)\.toISOString\(\), process\.env, mobileSessionService\?\.ownerPasswordConfigured\(\) === true\)/);
});

test("mobile owner-auth endpoint contract is present in client, server, and Oracle readiness", () => {
  const root = path.resolve(__dirname, "..");
  const mobile = fs.readFileSync(path.join(root, "apps/mobile/src/mobileApprovedSession.ts"), "utf8");
  const server = fs.readFileSync(path.join(root, "apps/cloud/src/server.ts"), "utf8");
  const readiness = fs.readFileSync(path.join(root, "scripts/oracle-readiness-check.js"), "utf8");
  for (const route of ["/v1/mobile/session/password", "/v1/mobile/session/password/change"]) {
    const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(mobile, new RegExp(escaped), `${route} must remain consumed by mobile`);
    assert.match(server, new RegExp(escaped), `${route} must remain served by cloud`);
    assert.match(readiness, new RegExp(escaped), `${route} must be release-gated`);
  }
});
