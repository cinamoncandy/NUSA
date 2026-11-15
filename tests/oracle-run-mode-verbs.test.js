"use strict";
// R1 of docs/NUSA_REDESIGN_PROPOSAL_2026-11-15.md: the helper verbs `stop` and `start` that let the owner stop and start the PAPER service
// from a GitHub button instead of a shell. The hard rules pinned here: both take the activation lock; `stop` only stops; `start` only starts
// and ONLY when the runtime env says NUSA_PAPER_ORDER_PATH=OFF (collection only), so the verb can never bring up the PAPER order path.
// The helper is run for real in a temporary layout with a stub `systemctl`; only the lock acquisition (root-only by design) and the host
// paths are replaced in the copy, and a static test asserts the real script still takes the lock first.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const script = fs.readFileSync(path.join(root, "deploy", "oracle", "nusa-release-step.sh"), "utf8").replace(/\r\n/g, "\n");
const posixOnly = process.platform === "win32" ? { skip: "the release helper runs only on the Linux host" } : {};

function verb(name) {
  const start = script.indexOf(`\n  ${name})\n`);
  assert.ok(start > 0, `verb ${name} exists`);
  const end = script.indexOf("\n    ;;", start);
  assert.ok(end > start, `verb ${name} ends`);
  return script.slice(start, end);
}

test("stop and start take the activation lock first, like every verb that changes the service", () => {
  for (const name of ["stop", "start"]) assert.match(verb(name), /^\s*\n?\s*(stop|start)\)\n\s+acquire_paper_activation_lock\n/, `verb ${name}`);
});

test("stop only stops and start only starts: no enable, disable, install, daemon-reload, restart, rollback or switch", () => {
  const forbidden = /enable_units|install_units_from_release|restart_units|rollback|atomic-deploy|daemon-reload|systemctl\s+(enable|disable|mask|restart|reload|kill|daemon-reload)/;
  for (const name of ["stop", "start"]) assert.doesNotMatch(verb(name), forbidden, `verb ${name}`);
  assert.match(verb("stop"), /systemctl stop "\$SERVICE"/);
  assert.match(verb("start"), /systemctl start "\$SERVICE"/);
});

test("start refuses unless the env file sets the order path exactly OFF (checked before any systemctl call)", () => {
  const body = verb("start");
  assert.match(body, /\[ "\$order_path" = "OFF" \] \|\| die/);
  assert.ok(body.indexOf('"$order_path" = "OFF"') < body.indexOf('systemctl start'), "the OFF check comes before the start");
});

test("the unknown-verb message lists stop and start", () => {
  assert.match(script, /Expected: backup\|preflight\|install-units\|prune\|stage\|switch\|activate\|rollback\|restart\|stop\|start\|readiness/);
});

/** A temporary host layout with a stub systemctl, and a copy of the helper whose host paths point into it. */
function layout({ env, withCurrent = true, active = false } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-runmode-"));
  const releaseSha = "3".repeat(40);
  fs.mkdirSync(path.join(base, "releases", releaseSha), { recursive: true });
  if (withCurrent) fs.symlinkSync(path.join(base, "releases", releaseSha), path.join(base, "current"));
  const envFile = path.join(base, "cloud-runtime.env");
  if (env !== undefined) fs.writeFileSync(envFile, env);
  const bin = path.join(base, "bin");
  fs.mkdirSync(bin);
  const calls = path.join(base, "systemctl-calls");
  const state = path.join(base, "state");
  fs.writeFileSync(state, active ? "active" : "inactive");
  fs.writeFileSync(path.join(bin, "systemctl"), [
    "#!/bin/sh",
    `echo "$@" >> "${calls}"`,
    'case "$1" in',
    `  is-active) s=$(cat "${state}"); q=0; for a in "$@"; do [ "$a" = --quiet ] && q=1; done; if [ "$s" = active ]; then [ $q = 1 ] || echo active; exit 0; else [ $q = 1 ] || echo inactive; exit 3; fi ;;`,
    `  start) echo active > "${state}" ;;`,
    `  stop) echo inactive > "${state}" ;;`,
    "  *) echo \"UNEXPECTED systemctl $*\" >&2; exit 99 ;;",
    "esac",
    "exit 0",
    "",
  ].join("\n"), { mode: 0o755 });
  const helper = script
    .replace("readonly DEPLOY_ROOT=/opt/nusa", `readonly DEPLOY_ROOT=${base}`)
    .replace("readonly RUNTIME_ENV=/etc/nusa/cloud-runtime.env", `readonly RUNTIME_ENV=${envFile}`)
    .replace("acquire_paper_activation_lock() {", "acquire_paper_activation_lock() { return 0;");
  assert.notEqual(helper, script, "the helper copy was rewritten");
  const helperPath = path.join(base, "helper.sh");
  fs.writeFileSync(helperPath, helper, { mode: 0o755 });
  const run = (verbName) => spawnSync("bash", [helperPath, verbName], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: "utf8" });
  const calledWith = () => (fs.existsSync(calls) ? fs.readFileSync(calls, "utf8").trim().split("\n") : []);
  return { base, run, calledWith, state: () => fs.readFileSync(state, "utf8").trim(), releaseSha, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

test("stop stops the service, prints a PASS line and calls nothing but stop and is-active", posixOnly, () => {
  const l = layout({ env: "NUSA_PAPER_ORDER_PATH=ON\n", active: true });
  try {
    const r = l.run("stop");
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout.trim()), { status: "PASS", action: "stop", service: "nusa.service", state: "inactive" });
    assert.equal(l.state(), "inactive");
    assert.deepEqual(l.calledWith().map((c) => c.split(" ")[0]), ["stop", "is-active"]);
  } finally { l.cleanup(); }
});

test("start with the order path OFF starts the service once and prints the release", posixOnly, () => {
  const l = layout({ env: "NUSA_CLOUD_PAPER_INITIAL_CAPITAL_KRW=100000\nNUSA_PAPER_ORDER_PATH=OFF\n" });
  try {
    const r = l.run("start");
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout.trim()), { status: "PASS", action: "start", service: "nusa.service", state: "active", release: l.releaseSha });
    assert.equal(l.state(), "active");
    assert.equal(l.calledWith().filter((c) => c.startsWith("start")).length, 1);
  } finally { l.cleanup(); }
});

test("start with the duplicate OFF lines the host really has (22 and 23) still starts", posixOnly, () => {
  const l = layout({ env: "NUSA_PAPER_ORDER_PATH=OFF\nNUSA_PAPER_ORDER_PATH=OFF\n" });
  try { assert.equal(l.run("start").status, 0); } finally { l.cleanup(); }
});

test("start on an already active service starts nothing", posixOnly, () => {
  const l = layout({ env: "NUSA_PAPER_ORDER_PATH=OFF\n", active: true });
  try {
    const r = l.run("start");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /already active/);
    assert.equal(l.calledWith().some((c) => c.startsWith("start")), false);
  } finally { l.cleanup(); }
});

for (const [name, env] of [
  ["unset", "NUSA_CLOUD_PAPER_INITIAL_CAPITAL_KRW=100000\n"],
  ["ON", "NUSA_PAPER_ORDER_PATH=ON\n"],
  ["lower-case off", "NUSA_PAPER_ORDER_PATH=off\n"],
  ["OFF with a suffix", "NUSA_PAPER_ORDER_PATH=OFFX\n"],
  ["empty", "NUSA_PAPER_ORDER_PATH=\n"],
  ["OFF then ON (the last line wins)", "NUSA_PAPER_ORDER_PATH=OFF\nNUSA_PAPER_ORDER_PATH=ON\n"],
]) {
  test(`start REFUSES and starts nothing when the order path is ${name}`, posixOnly, () => {
    const l = layout({ env });
    try {
      const r = l.run("start");
      assert.notEqual(r.status, 0, "must fail closed");
      assert.match(r.stderr, /refusing to start/);
      assert.equal(l.calledWith().some((c) => c.startsWith("start")), false, "systemctl start must not be called");
      assert.equal(l.state(), "inactive");
    } finally { l.cleanup(); }
  });
}

test("start REFUSES when the env file is missing or there is no active release", posixOnly, () => {
  const noEnv = layout({});
  const noRelease = layout({ env: "NUSA_PAPER_ORDER_PATH=OFF\n", withCurrent: false });
  try {
    for (const l of [noEnv, noRelease]) {
      const r = l.run("start");
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /refusing to start/);
      assert.equal(l.calledWith().some((c) => c.startsWith("start")), false);
    }
  } finally { noEnv.cleanup(); noRelease.cleanup(); }
});
