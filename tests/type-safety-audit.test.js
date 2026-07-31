const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");

function runAudit(cwd) {
  return spawnSync(process.execPath, [path.join(cwd, "scripts", "type-safety-audit.js")], { cwd, encoding: "utf8" });
}

test("type-safety audit passes against the real repository", () => {
  const result = runAudit(root);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("type-safety audit fails closed for 'as any', @ts-ignore, and eslint-disable", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-type-safety-"));
  try {
    fs.mkdirSync(path.join(directory, "apps", "fixture", "src"), { recursive: true });
    fs.mkdirSync(path.join(directory, "scripts"), { recursive: true });
    fs.copyFileSync(path.join(root, "scripts", "type-safety-audit.js"), path.join(directory, "scripts", "type-safety-audit.js"));

    fs.writeFileSync(
      path.join(directory, "apps", "fixture", "src", "unsafe.ts"),
      "const value = input as any;\n// @ts-ignore\nconst other: string = 1;\n// eslint-disable-next-line no-console\nconsole.log(value, other);\n"
    );

    const result = runAudit(directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unchecked 'as any' type assertion/);
    assert.match(result.stderr, /TypeScript error\/check suppression comment/);
    assert.match(result.stderr, /lint suppression comment/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("type-safety audit ignores declaration files and non-src TypeScript", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-type-safety-"));
  try {
    fs.mkdirSync(path.join(directory, "apps", "fixture", "src"), { recursive: true });
    fs.mkdirSync(path.join(directory, "scripts"), { recursive: true });
    fs.copyFileSync(path.join(root, "scripts", "type-safety-audit.js"), path.join(directory, "scripts", "type-safety-audit.js"));

    fs.writeFileSync(path.join(directory, "apps", "fixture", "src", "types.d.ts"), "declare const x: any;\n");
    fs.writeFileSync(path.join(directory, "outside-src.ts"), "const value = input as any;\n");

    const result = runAudit(directory);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
