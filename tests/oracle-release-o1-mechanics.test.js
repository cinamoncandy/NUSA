"use strict";
// Runbook option O1 (docs/PAPER_RESTART_RUNBOOK_2026-11-14.md): move the host to a new build WITHOUT starting any service, using only the `stage` and `switch` verbs.
// These tests pin the facts that option relies on, so a later change that adds a restart to those verbs breaks a test instead of silently breaking O1.
// They do NOT prove the whole O1 procedure safe (no rehearsal on the host, no readiness or soak), see the runbook.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const script = fs.readFileSync(path.join(root, "deploy", "oracle", "nusa-release-step.sh"), "utf8").replace(/\r\n/g, "\n");
const atomicDeploy = fs.readFileSync(path.join(root, "scripts", "atomic-deploy.js"), "utf8");
const posixOnly = process.platform === "win32" ? { skip: "the release helper runs only on the Linux host" } : {};

/** The body of one verb in the final `case "$verb" in` of the helper. */
function verb(name) {
  const start = script.indexOf(`\n  ${name})\n`);
  assert.ok(start > 0, `verb ${name} exists`);
  const end = script.indexOf("\n    ;;", start);
  assert.ok(end > start, `verb ${name} ends`);
  return script.slice(start, end);
}
function fn(name) {
  const start = script.indexOf(`\n${name}() {`);
  assert.ok(start > 0, `function ${name} exists`);
  const end = script.indexOf("\n}\n", start);
  return script.slice(start, end + 3);
}
const STARTS_SOMETHING = /systemctl|restart_units|enable_units|install_units_from_release|rollback_and_restore|\bservice\b.*\bstart\b/;

test("O1: stage, switch and the rollback verb never start, enable, install or restart a unit", () => {
  for (const name of ["stage", "switch", "rollback"]) assert.doesNotMatch(verb(name), STARTS_SOMETHING, `verb ${name}`);
  assert.doesNotMatch(fn("bind_runtime_source_identity"), STARTS_SOMETHING);
  assert.doesNotMatch(atomicDeploy, /systemctl|child_process|spawn|exec(File|Sync)?\(/, "atomic-deploy.js starts no process");
});

test("O1: the verbs that DO start the service are exactly restart, activate and the automatic rollback inside a failed activation", () => {
  assert.match(verb("restart"), /restart_units/);
  assert.match(verb("activate"), /restart_units/);
  assert.match(verb("activate"), /rollback_and_restore/);
  assert.match(fn("rollback_and_restore"), /restart_units/);
  // After a manual `rollback` the link points to the previous build, so the `restart` verb would start it: this is why an O1 sequence forbids both.
  assert.match(verb("rollback"), /atomic-deploy\.js/);
});

test("R2: a failed activation restores only a PROVEN, data-compatible previous release; otherwise the host ends STOPPED", () => {
  const body = verb("activate");
  assert.match(body, /release_proven "\$previous" && rollback_schema_compatible "\$previous"/);
  assert.match(body, /safe_stop_after_failed_activation "\$1" "no proven, data-compatible previous release to restore"/);
  assert.doesNotMatch(body, /keeping \$1 active \(no rollback\)/, "the old keep-running branch is gone");
  assert.ok(body.indexOf("mark_release_proven") > body.indexOf('systemctl is-active --quiet "$AUTOPILOT_SERVICE"'), "a release is marked proven only after the final active checks");
  assert.ok(body.indexOf("mark_release_proven") > body.indexOf("safe_stop_after_failed_activation"), "never marked proven on the failure path");
});

function layout() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-o1-"));
  const oldSha = "1".repeat(40);
  const newSha = "2".repeat(40);
  for (const sha of [oldSha, newSha]) fs.mkdirSync(path.join(base, "releases", sha), { recursive: true });
  fs.symlinkSync(path.join(base, "releases", oldSha), path.join(base, "current"));
  const bin = path.join(base, "bin");
  fs.mkdirSync(bin);
  const marker = path.join(base, "systemctl-called");
  fs.writeFileSync(path.join(bin, "systemctl"), `#!/bin/sh\necho "$@" >> "${marker}"\nexit 0\n`, { mode: 0o755 });
  return { base, oldSha, newSha, bin, marker };
}
const runDeploy = (l, action, sha) => spawnSync(process.execPath, [path.join(root, "scripts", "atomic-deploy.js")], {
  env: { ...process.env, PATH: `${l.bin}:${process.env.PATH}`, NUSA_DEPLOY_ROOT: l.base, NUSA_DEPLOY_ACTION: action, ...(sha ? { NUSA_COMMIT_SHA: sha } : {}) }, encoding: "utf8",
});

test("O1: switch moves only the link and records the previous release; no systemctl is ever called", posixOnly, () => {
  const l = layout();
  try {
    const result = runDeploy(l, "switch", l.newSha);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.realpathSync(path.join(l.base, "current")), fs.realpathSync(path.join(l.base, "releases", l.newSha)));
    assert.equal(fs.readFileSync(path.join(l.base, ".previous-release"), "utf8").trim(), path.join(l.base, "releases", l.oldSha));
    assert.equal(fs.existsSync(l.marker), false, "systemctl must not be called");
    assert.match(result.stdout, /"restartRequired":true/); // the helper only REPORTS that a restart would be needed
  } finally { fs.rmSync(l.base, { recursive: true, force: true }); }
});

test("O1: the rollback action only moves the link back (the previous build would run on the next start), and calls no systemctl", posixOnly, () => {
  const l = layout();
  try {
    assert.equal(runDeploy(l, "switch", l.newSha).status, 0);
    const back = runDeploy(l, "rollback");
    assert.equal(back.status, 0, back.stderr);
    assert.equal(fs.realpathSync(path.join(l.base, "current")), fs.realpathSync(path.join(l.base, "releases", l.oldSha)));
    assert.equal(fs.existsSync(l.marker), false);
  } finally { fs.rmSync(l.base, { recursive: true, force: true }); }
});

test("O1: switch to a build that is not staged fails and leaves the link where it was", posixOnly, () => {
  const l = layout();
  try {
    const result = runDeploy(l, "switch", "3".repeat(40));
    assert.notEqual(result.status, 0);
    assert.equal(fs.realpathSync(path.join(l.base, "current")), fs.realpathSync(path.join(l.base, "releases", l.oldSha)));
    assert.equal(runDeploy(l, "switch", "not-a-sha").status === 0, false);
  } finally { fs.rmSync(l.base, { recursive: true, force: true }); }
});

test("O1: bind_runtime_source_identity writes the new SHA into the env file and calls no systemctl", posixOnly, () => {
  const l = layout();
  try {
    const env = path.join(l.base, "cloud-runtime.env");
    fs.writeFileSync(env, "NUSA_PAPER_ORDER_PATH=OFF\nNUSA_SOURCE_COMMIT=" + "1".repeat(40) + "\nOTHER=keep\n");
    const harness = [
      "set -uo pipefail",
      `PATH=${JSON.stringify(l.bin)}:$PATH`,
      `RUNTIME_ENV=${JSON.stringify(env)}`,
      'die() { printf "%s\\n" "$*" >&2; exit 1; }',
      fn("validate_sha"),
      fn("bind_runtime_source_identity"),
      `bind_runtime_source_identity ${l.newSha}`,
    ].join("\n");
    const result = spawnSync("bash", ["-c", harness], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const text = fs.readFileSync(env, "utf8");
    assert.match(text, new RegExp(`^NUSA_SOURCE_COMMIT=${l.newSha}$`, "m"));
    assert.match(text, new RegExp(`^NUSA_SOURCE_COMMIT_SHA=${l.newSha}$`, "m"));
    assert.match(text, /^NUSA_PAPER_ORDER_PATH=OFF$/m);
    assert.match(text, /^OTHER=keep$/m);
    assert.equal(fs.existsSync(l.marker), false);
  } finally { fs.rmSync(l.base, { recursive: true, force: true }); }
});

// R2: behaviour of the proven marker and the safe stop, run for real against a temp layout and a stub systemctl.
function sandbox() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-r2-"));
  const bin = path.join(base, "bin");
  fs.mkdirSync(bin);
  const log = path.join(base, "systemctl.log");
  fs.writeFileSync(path.join(bin, "systemctl"), `#!/usr/bin/env bash\necho "$*" >> ${JSON.stringify(log)}\n`, { mode: 0o755 });
  return { base, bin, log };
}
const helperFns = () => ["release_proven() {", "mark_release_proven() {", "safe_stop_after_failed_activation() {"].map((name) => {
  const start = script.indexOf(`\n${name}`);
  assert.ok(start > 0, name);
  return script.slice(start, script.indexOf("\n}\n", start) + 3);
}).join("\n");
const bash = (box, code) => spawnSync("bash", ["-c", `set -uo pipefail\nSERVICE=nusa.service\ndie() { echo "$*" >&2; exit 1; }\n${helperFns()}\n${code}`], { encoding: "utf8", env: { ...process.env, PATH: `${box.bin}:${process.env.PATH}` } });

test("R2: an unmarked release is not proven; the safe stop stops only the PAPER service and fails the step", posixOnly, () => {
  const box = sandbox();
  const dir = path.join(box.base, "release");
  fs.mkdirSync(dir);
  assert.equal(bash(box, `release_proven ${JSON.stringify(dir)}`).status, 1, "no marker, not proven");
  fs.writeFileSync(path.join(dir, ".nusa-proven"), "");
  // The marker must be owned by root; a test process that is not root must not be accepted as proven.
  const owned = bash(box, `release_proven ${JSON.stringify(dir)}`).status;
  assert.equal(owned, process.getuid && process.getuid() === 0 ? 0 : 1, "only a root-owned marker proves a release");
  const stop = bash(box, `safe_stop_after_failed_activation ${"2".repeat(40)} "test reason"`);
  assert.equal(stop.status, 1);
  assert.match(stop.stderr, /leaving the host STOPPED \(no automatic rollback\)/);
  assert.equal(fs.readFileSync(box.log, "utf8").trim(), "stop nusa.service", "exactly one systemctl call: stop the PAPER service");
});

test("R2: mark_release_proven creates a root-owned marker that release_proven then accepts (root only)", { skip: process.platform === "win32" || (process.getuid && process.getuid() !== 0) ? "needs root to chown" : false }, () => {
  const box = sandbox();
  const dir = path.join(box.base, "release");
  fs.mkdirSync(dir);
  assert.equal(bash(box, `mark_release_proven ${JSON.stringify(dir)} && release_proven ${JSON.stringify(dir)}`).status, 0);
  assert.equal(bash(box, `mark_release_proven ${JSON.stringify(path.join(box.base, "missing"))}`).status, 1, "a missing release cannot be marked");
});
