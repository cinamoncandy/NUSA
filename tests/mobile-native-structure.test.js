const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mobile = path.resolve(__dirname, "../apps/mobile");

test("mobile repository structure exposes the app and native project paths", () => {
  assert.equal(fs.existsSync(path.join(mobile, "App.tsx")), true);
  assert.equal(fs.existsSync(path.join(mobile, "package.json")), true);
  assert.equal(fs.existsSync(path.join(mobile, "android")), true);
  assert.equal(fs.existsSync(path.join(mobile, "ios")), true);
});

test("native bootstrap state is explicit and does not claim a build", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(mobile, "package.json"), "utf8"));
  assert.equal(manifest.nativeProjectStatus, "BOOTSTRAP_PENDING_TOOLCHAIN");
});
