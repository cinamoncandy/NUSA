const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");

test("desktop runtime files and entrypoints are internally consistent", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(root, "scripts", "validate-desktop-runtime.js")],
    {
      cwd: root,
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
