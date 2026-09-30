"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { writeFileSync, rmSync, mkdtempSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

const ROOT = join(__dirname, "..");
const VALIDATOR = join(ROOT, "scripts", "validate-platform-independent-tests.js");

/**
 * The validator's whole value is precision. A false positive makes it something people switch off;
 * a false negative makes it decorative. Both directions are pinned here, and the positive cases are
 * the two failures it was written for -- the real ones, reduced to their shape.
 */

function runValidatorOver(files) {
  const directory = mkdtempSync(join(tmpdir(), "nusa-plat-guard-"));
  try {
    for (const [name, source] of Object.entries(files)) writeFileSync(join(directory, name), source);
    return spawnSync(process.execPath, [VALIDATOR], { encoding: "utf8", env: { ...process.env, NUSA_TEST_DIR_OVERRIDE: directory } });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("the repository currently passes, so the guard is adoptable rather than a wall of noise", () => {
  const result = spawnSync(process.execPath, [VALIDATOR], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("exactly one file is exempt, and it is the guard's own fixtures", () => {
  // An exemption list is a place failures go to hide. This pins it to the one file that cannot
  // avoid containing hazardous text, because demonstrating the difference is its job.
  const source = require("node:fs").readFileSync(join(ROOT, "scripts", "validate-platform-independent-tests.js"), "utf8");
  const declared = source.match(/const EXEMPT = Object\.freeze\(\[([^\]]*)\]\)/);
  assert.ok(declared, "the exemption list must stay declared in one place");
  const entries = declared[1].split(",").map((entry) => entry.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  assert.deepEqual(entries, ["tests/platform-independent-test-guard.test.js"]);
});

test("it catches a file read whose pattern requires a newline after a concrete character", () => {
  // The exact shape that failed on the Windows shards: `:` must be followed by `\n`, but a CRLF
  // checkout puts `\r` there.
  const result = runValidatorOver({
    "hazard.test.js": [
      'const { readFileSync } = require("node:fs");',
      'const { join } = require("node:path");',
      'const source = readFileSync(join(__dirname, "..", "some.yml"), "utf8");',
      'assert.match(source, /permissions:\\n\\s+contents: read/);',
    ].join("\n"),
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CRLF_BLIND_FILE_READ/);
});

test("it catches a git fixture that inherits the machine's autocrlf", () => {
  const result = runValidatorOver({
    "fixture.test.js": [
      'const { spawnSync } = require("node:child_process");',
      'spawnSync("git", ["init", "--initial-branch=main"], { cwd: root });',
      'spawnSync("git", ["commit", "-m", "base"], { cwd: root });',
    ].join("\n"),
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /GIT_FIXTURE_INHERITS_AUTOCRLF/);
});

test("it stays quiet for the safe shapes that fill this repository", () => {
  const result = runValidatorOver({
    // `\s*` consumes the `\r`.
    "absorbed.test.js": 'const s = readFileSync(join(__dirname, "x"), "utf8"); assert.match(s, /permissions:\\s*\\n\\s*contents/);',
    // A negated class matches `\r`.
    "negated.test.js": 'const s = readFileSync(join(__dirname, "x"), "utf8"); assert.match(s, /BTC[^\\n]*(65000000)/);',
    // Nothing is required before the newline.
    "leading.test.js": 'const s = readFileSync(join(__dirname, "x"), "utf8"); assert.match(s, /\\n\\s*stream\\.start/);',
    // Already normalised.
    "normalised.test.js": 'const s = readFileSync(join(__dirname, "x"), "utf8").replace(/\\r\\n/g, "\\n"); assert.match(s, /permissions:\\n\\s+contents/);',
    // Runs git, but pins the policy.
    "pinned.test.js": 'spawnSync("git", ["init"], { cwd: root }); spawnSync("git", ["config", "core.autocrlf", "false"], { cwd: root });',
    // Runs git, but builds no fixture.
    "nofixture.test.js": 'const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout;',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
