const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const updater = fs.readFileSync(path.join(root, "apps", "desktop", "src", "update", "desktopAutoUpdate.ts"), "utf8");
const cloudMain = fs.readFileSync(path.join(root, "apps", "desktop", "src", "cloudMain.ts"), "utf8");
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "windows-desktop-stable-release.yml"), "utf8");

test("packaged Windows desktop starts the self updater", () => {
  assert.match(cloudMain, /startDesktopAutoUpdate/);
  assert.match(cloudMain, /app\.whenReady\(\)/);
  assert.match(updater, /app\.isPackaged/);
  assert.match(updater, /process\.platform !== "win32"/);
  assert.match(updater, /CHECK_INTERVAL_MS = 10 \* 60 \* 1000/);
});

test("self updater uses fixed GitHub stable assets and verifies SHA-256 before install", () => {
  assert.match(updater, /releases\/download\/nusa-windows/);
  assert.match(updater, /NUSA-Windows\.provenance\.txt/);
  assert.match(updater, /NUSA-Windows-Setup\.exe\.sha256/);
  assert.match(updater, /actualSha256 !== expectedSha256/);
  assert.match(updater, /installer SHA-256 mismatch/);
  assert.match(updater, /spawn\(installerPath, \["\/S"\]/);
  assert.match(updater, /host !== "github\.com" && !host\.endsWith\("\.githubusercontent\.com"\)/);
});

test("release pipeline stamps exact main identity into every packaged installer", () => {
  assert.match(workflow, /Stamp exact release source into packaged app/);
  assert.match(workflow, /dist\/apps\/desktop\/release-build\.json/);
  assert.match(workflow, /source_sha/);
  assert.match(workflow, /Verify source is still current main before publication/);
  assert.match(workflow, /auto_update=sha256_verified_silent_nsis/);
});

test("updater fails closed when build identity or metadata is invalid", () => {
  assert.match(updater, /packaged build lacks release-build\.json; automatic update disabled/);
  assert.match(updater, /invalid release provenance source_sha/);
  assert.match(updater, /invalid installer SHA-256 manifest/);
  assert.match(updater, /MAX_INSTALLER_BYTES/);
  assert.match(updater, /MAX_REDIRECTS/);
});
