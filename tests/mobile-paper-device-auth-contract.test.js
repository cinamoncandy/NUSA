const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("the persisted PAPER session key requires Android system biometric or device PIN authentication", () => {
  const native = read("apps/mobile/android/app/src/main/java/com/nusa/mobile/NusaSecureStorageModule.java");
  const session = read("apps/mobile/src/mobileApprovedSession.ts");
  assert.match(native, /PAPER_SESSION_STORAGE_KEY = "nusa\.mobile\.approved-session\.v2"/);
  assert.match(native, /setUserAuthenticationRequired\(true\)/);
  assert.match(native, /setUserAuthenticationValidityDurationSeconds\(PAPER_SESSION_AUTH_VALIDITY_SECONDS\)/);
  assert.match(native, /E_NUSA_SECURE_STORAGE_AUTH_REQUIRED/);
  assert.match(session, /MobileSecureStorageAuthenticationRequiredError/);
  assert.match(session, /requiresDeviceAuthentication/);
  assert.doesNotMatch(native + session, /UPBIT_ACCESS_KEY|UPBIT_SECRET_KEY|liveAuthority\s*=\s*true|productionMutationAllowed\s*=\s*true/);
});
