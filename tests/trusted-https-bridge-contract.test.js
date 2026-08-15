const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const config = fs.readFileSync(path.join(root, 'deploy/cloudflare-tunnel/config.example.yml'), 'utf8');
const runbook = fs.readFileSync(path.join(root, 'docs/TRUSTED_HTTPS_BRIDGE.md'), 'utf8');
const androidManifest = fs.readFileSync(path.join(root, 'apps/mobile/android/app/src/main/AndroidManifest.xml'), 'utf8');
const androidGradle = fs.readFileSync(path.join(root, 'apps/mobile/android/app/build.gradle'), 'utf8');
const cloudRuntimeConfig = fs.readFileSync(path.join(root, 'apps/cloud/src/cloudRuntimeConfig.ts'), 'utf8');

const combined = `${config}\n${runbook}`;

test('trusted bridge publishes only a loopback NUSA origin and has a fail-closed catch-all', () => {
  assert.match(config, /tunnel:\s*__TUNNEL_UUID__/);
  assert.match(config, /credentials-file:\s*__ABSOLUTE_TUNNEL_CREDENTIAL_JSON_PATH__/);
  assert.match(config, /hostname:\s*__PUBLIC_HOSTNAME__/);
  assert.match(config, /service:\s*http:\/\/127\.0\.0\.1:__NUSA_CLOUD_PORT__/);
  assert.match(config, /- service:\s*http_status:404\s*$/m);
  assert.doesNotMatch(config, /service:\s*http:\/\/(?:0\.0\.0\.0|192\.168\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.)/);
});

test('runbook preserves the production loopback bind instead of weakening Cloud runtime validation', () => {
  assert.match(runbook, /NUSA_CLOUD_DASHBOARD_HOST=127\.0\.0\.1/);
  assert.match(cloudRuntimeConfig, /host !== "127\.0\.0\.1"/);
  assert.match(cloudRuntimeConfig, /host\.toLowerCase\(\) !== "localhost"/);
  assert.doesNotMatch(runbook, /NUSA_CLOUD_DASHBOARD_HOST=0\.0\.0\.0/);
});

test('Android remains cleartext-disabled for every build variant and the operator endpoint is HTTPS-only', () => {
  assert.match(androidManifest, /android:usesCleartextTraffic="\$\{usesCleartextTraffic\}"/);
  assert.match(androidGradle, /defaultConfig\s*\{[\s\S]*?manifestPlaceholders\s*=\s*\[usesCleartextTraffic:\s*"false"\]/);
  assert.match(androidGradle, /release\s*\{[\s\S]*?manifestPlaceholders\s*=\s*\[usesCleartextTraffic:\s*"false"\]/);
  assert.doesNotMatch(androidGradle, /usesCleartextTraffic\s*:\s*"true"/);
  assert.doesNotMatch(androidManifest, /android:usesCleartextTraffic="true"/);
  assert.match(runbook, /https:\/\/paper\.example\.com/);
  assert.match(runbook, /Do not add HTTP fallback/);
});

test('bridge artifacts do not embed the NUSA bearer token or URL credentials', () => {
  assert.doesNotMatch(config, /NUSA_CLOUD_DASHBOARD_TOKEN/);
  assert.doesNotMatch(config, /Authorization:/i);
  assert.doesNotMatch(config, /Bearer\s+/i);
  assert.doesNotMatch(config, /https?:\/\/[^\s/@]+:[^\s/@]+@/);
  assert.match(runbook, /Never put it in the public hostname, URL query string, tunnel config/);
});

test('bridge contract explicitly retains PAPER-only and AI zero-authority boundaries', () => {
  assert.match(combined, /liveAuthority=NONE/);
  assert.match(combined, /productionMutationAllowed=false/);
  assert.match(combined, /AI remains ZERO_AUTHORITY\/read-only/);
  assert.match(runbook, /HUMAN_ENVIRONMENT_ONLY/);
});

test('runbook keeps setup, lifecycle, recovery, and credential rotation repository-controlled', () => {
  assert.match(runbook, /## One-time setup/);
  assert.match(runbook, /cloudflared tunnel create/);
  assert.match(runbook, /cloudflared tunnel route dns/);
  assert.match(runbook, /ingress validate/);
  assert.match(runbook, /## Start/);
  assert.match(runbook, /## Stop/);
  assert.match(runbook, /## Recovery \/ rotation/);
  assert.match(runbook, /replace `NUSA_CLOUD_DASHBOARD_TOKEN`/);
  assert.match(runbook, /Tunnel credential compromise/);
});
