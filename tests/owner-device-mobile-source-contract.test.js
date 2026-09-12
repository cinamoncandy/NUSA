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
  assert.doesNotMatch(native, /Authenticators\.DEVICE_CREDENTIAL|AUTH_DEVICE_CREDENTIAL/);
  assert.doesNotMatch(native, /getPrivateKey|exportPrivate|PrivateKey\s*\.\s*getEncoded/);
  assert.doesNotMatch(bridge, /privateKey|export.*key/i);
  assert.doesNotMatch(session, /setSecret\(SESSION_STORAGE_KEY|setSecret\(PAIRING_STORAGE_KEY|getSecret\(SESSION_STORAGE_KEY|getSecret\(PAIRING_STORAGE_KEY/);
});

test("primary owner flow is password enrollment then biometric authentication; pairing remains secondary", () => {
  const root = path.resolve(__dirname, "..");
  const source = fs.readFileSync(path.join(root, "apps/mobile/src/settingsView.tsx"), "utf8");
  const http = fs.readFileSync(path.join(root, "apps/cloud/src/mobileSessionHttp.ts"), "utf8");
  const server = fs.readFileSync(path.join(root, "apps/cloud/src/server.ts"), "utf8");
  assert.match(source, /로그인 및 이 휴대폰 등록/);
  assert.match(source, /소유자 인증/);
  assert.match(source, /호환 코드 연결/);
  assert.doesNotMatch(source, /ChatGPT/);
  assert.match(http, /signInWithOwnerPassword\(\{ password: input\?\.password, deviceId \}\)/);
  assert.doesNotMatch(http, /signInWithOwnerPassword\(\{ userId:/);
  assert.match(server, /capabilities: \{ passwordSignIn:/);
});
