const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

test("release package keeps safe Windows defaults", () => {
  assert.equal(pkg.version, "0.1.0");
  assert.equal(pkg.build.win.target, "nsis");
  assert.equal(pkg.build.asar, true);
  assert.equal(pkg.build.win.signAndEditExecutable, false);
  assert.equal(pkg.build.nsis.deleteAppDataOnUninstall, false);
  assert.equal(pkg.main, "dist/apps/desktop/src/cloudMain.js");
  assert.equal(pkg.build.extraMetadata.main, pkg.main);
});

test("release documents cover install, operation, recovery, rollback, and checklist", () => {
  for (const file of ["installation-guide.md", "operator-manual.md", "recovery-manual.md", "rollback-guide.md", "release-checklist.md"]) {
    const content = fs.readFileSync(path.join(root, "docs", "release", file), "utf8");
    assert.ok(content.length > 200, file);
  }
});
