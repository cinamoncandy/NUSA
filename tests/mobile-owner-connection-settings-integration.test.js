"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const settings = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/settingsView.tsx"), "utf8");
const experience = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/ownerConnectionExperience.tsx"), "utf8");
const accessModel = fs.readFileSync(path.resolve(__dirname, "../apps/mobile/src/paperAccessModel.ts"), "utf8");
const slice = (from, to) => settings.slice(settings.indexOf(from), settings.indexOf(to, settings.indexOf(from)));

test("primary OWNER authentication never silently starts pairing", () => {
  const primary = slice("const requestPaperConnection = async", "const requestRecoveryPairing = async");
  const recovery = slice("const requestRecoveryPairing = async", "const enrollThisPhone = async");
  assert.match(primary, /authenticateOwnerDeviceCredential/);
  assert.doesNotMatch(primary, /startPairing/);
  assert.match(primary, /소유자 확인 후 이 휴대폰을 먼저 등록하세요/);
  assert.match(recovery, /startPairing\(configuredEndpoint, installationId\)/);
  assert.match(settings, /onRecoverWithPairing=\{\(\) => \{ void requestRecoveryPairing\(\); \}\}/);
});

test("Settings mounts Evidence Glass and derives COMPLETE only from real READY state", () => {
  assert.match(settings, /<OwnerConnectionExperience/);
  assert.match(settings, /stage=\{ownerConnectionStage\}/);
  assert.match(settings, /const ownerConnectionStage: OwnerConnectionStage = connection\.status === "READY"[\s\S]*\? "COMPLETE"/);
  assert.match(settings, /ownerCredentialReady[\s\S]*\? "VERIFY_OWNER"[\s\S]*: "VERIFY_DEVICE"/);
  assert.match(settings, /connectionFailed[\s\S]*\? "BLOCKED"/);
  assert.match(experience, /✓ 이 휴대폰이 안전하게 연결되었습니다\./);
});

test("recovery credentials stay behind explicit progressive disclosure", () => {
  const primaryStart = settings.indexOf('<View style={styles.sectionBlock} testID="settings-paper-connection">');
  const recoveryStart = settings.indexOf('{showRecoveryOptions ? <View', primaryStart);
  assert.ok(primaryStart >= 0 && recoveryStart > primaryStart);
  const primarySurface = settings.slice(primaryStart, recoveryStart);
  const recoverySurface = settings.slice(recoveryStart, settings.indexOf('</View> : null}', recoveryStart) + 14);
  assert.match(primarySurface, /OwnerConnectionExperience/);
  assert.match(primarySurface, /settings-paper-recovery-toggle/);
  assert.doesNotMatch(primarySurface, /bootstrap token|users:manage|1회용 복구 키|verificationCode/);
  assert.match(recoverySurface, /6자리 코드/);
  assert.match(recoverySurface, /1회용 복구 키/);
});

test("biometric failure remains fail-closed while public observation and authority invariants remain fixed", () => {
  const primary = slice("const requestPaperConnection = async", "const requestRecoveryPairing = async");
  assert.match(primary, /catch \(connectionError\)[\s\S]*credentialSession\.clear\(\); clearPaperConnectionVerification\(\)/);
  assert.match(settings, /connectionFailed[\s\S]*\? "BLOCKED"/);
  assert.match(experience, /공개 관측/);
  assert.match(accessModel, /publicObservationAllowed: true/);
  assert.match(accessModel, /paperMutationAllowed: verified/);
  assert.match(accessModel, /liveAuthority: "NONE"/);
  assert.match(accessModel, /productionMutationAllowed: false/);
  assert.match(accessModel, /aiAuthority: "ZERO_AUTHORITY"/);
});
