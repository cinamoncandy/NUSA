const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const workflow = fs
  .readFileSync('.github/workflows/android-stable-release.yml', 'utf8')
  .replace(/\r\n/g, '\n');

test('android stable release checks signing readiness before build', () => {
  assert.match(workflow, /signing-readiness:\n[\s\S]*name: Android release signing readiness/);
  assert.match(workflow, /NUSA_ANDROID_RELEASE_KEYSTORE_B64/);
  assert.match(workflow, /NUSA_ANDROID_RELEASE_STORE_PASSWORD/);
  assert.match(workflow, /NUSA_ANDROID_RELEASE_KEY_ALIAS/);
  assert.match(workflow, /NUSA_ANDROID_RELEASE_KEY_PASSWORD/);
  assert.match(workflow, /NUSA_ANDROID_RELEASE_CERT_SHA256/);
  assert.match(workflow, /ANDROID_RELEASE_SIGNING_CONFIGURATION_BLOCKED/);
  assert.match(workflow, /base64 --decode/);
  assert.match(workflow, /keytool -list/);
  assert.match(workflow, /keytool -importkeystore/);
  assert.match(workflow, /openssl x509 -noout -fingerprint -sha256/);
});

test('missing or invalid signing config blocks deployment without starting build', () => {
  assert.match(workflow, /echo "ready=false" >> "\$GITHUB_OUTPUT"/);
  assert.match(workflow, /echo "ready=true" >> "\$GITHUB_OUTPUT"/);
  assert.match(workflow, /needs: \[resolve, signing-readiness\]/);
  assert.match(workflow, /needs\.signing-readiness\.outputs\.ready == 'true'/);
  assert.match(workflow, /deployment_started: \\`false\\`/);
});

test('release safety invariants remain fail closed', () => {
  assert.match(workflow, /liveAuthority: \\`NONE\\`/);
  assert.match(workflow, /productionMutationAllowed: \\`false\\`/);
  assert.match(workflow, /aiAuthority: \\`ZERO_AUTHORITY\\`/);
  assert.doesNotMatch(workflow, /signingConfig[\s\S]*debug/i);
});
