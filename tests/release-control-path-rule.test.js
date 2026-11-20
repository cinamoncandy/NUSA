"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { evaluate, PROTECTED_PATHS, API_FILE_LIMIT } = require("../scripts/release-control-path-rule.js");

const run = (content) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "path-rule-"));
  const file = path.join(dir, "files.json");
  fs.writeFileSync(file, content);
  const result = spawnSync(process.execPath, [path.join(__dirname, "../scripts/release-control-path-rule.js"), file], { encoding: "utf8" });
  fs.rmSync(dir, { recursive: true, force: true });
  return result;
};
const files = (...names) => JSON.stringify(names.map((filename) => ({ filename })));

test("an ordinary PR is CLEAR", () => {
  assert.deepEqual(evaluate(JSON.parse(files("docs/a.md", "scripts/run-signal-screen.js", ".github/workflows/oracle-host-diagnose.yml"))), { result: "CLEAR", files: 3 });
  const r = run(files("docs/a.md"));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "RELEASE_CONTROL_PATH_RULE result=CLEAR files=1\n");
});

test("every protected path blocks auto-merge", () => {
  for (const protectedPath of PROTECTED_PATHS) {
    const r = run(files("docs/a.md", protectedPath));
    assert.equal(r.status, 0, protectedPath);
    assert.equal(r.stdout, `RELEASE_CONTROL_PATH_RULE result=PROTECTED path=${protectedPath}\n`);
  }
});

test("a rename out of a protected path, odd spellings and paginated slurp output are caught", () => {
  assert.equal(evaluate([{ filename: "docs/moved.json", previous_filename: "config/release-control.json" }]).result, "PROTECTED");
  assert.equal(evaluate([{ filename: "./config//release-control.json" }]).result, "PROTECTED");
  assert.equal(evaluate([{ filename: "config\\release-control.json" }]).result, "PROTECTED");
  assert.equal(evaluate([[{ filename: "a.md" }], [{ filename: "scripts/release-control-check.js" }]]).result, "PROTECTED");
});

test("similar but different paths are not protected", () => {
  assert.equal(evaluate([{ filename: "config/release-control.json.bak" }, { filename: "config/release-control/x.json" }, { filename: "docs/CODEOWNERS.md" }]).result, "CLEAR");
});

test("fail closed: malformed, empty-name, truncated or unreadable input exits 2", () => {
  for (const bad of ["{not json", "{}", "null", JSON.stringify([{}]), JSON.stringify([{ filename: "" }]), JSON.stringify([{ filename: 7 }]), JSON.stringify([{ filename: "a", previous_filename: 5 }]), JSON.stringify(Array.from({ length: API_FILE_LIMIT }, (_, i) => ({ filename: `f${i}` })))]) {
    const r = run(bad);
    assert.equal(r.status, 2, bad.slice(0, 40));
    assert.match(r.stderr, /fail closed/);
    assert.equal(r.stdout, "");
  }
  const missing = spawnSync(process.execPath, [path.join(__dirname, "../scripts/release-control-path-rule.js"), "/nonexistent/files.json"], { encoding: "utf8" });
  assert.equal(missing.status, 2);
});

test("the rule and the protected list cover the gate files themselves", () => {
  for (const required of ["config/release-control.json", "scripts/release-control-check.js", "scripts/release-control-path-rule.js", ".github/workflows/autopilot-deterministic-audit-release.yml"]) assert.ok(PROTECTED_PATHS.includes(required), required);
  assert.ok(fs.existsSync(path.join(__dirname, "..", "config/release-control.json")));
});
