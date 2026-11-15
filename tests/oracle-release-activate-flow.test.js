"use strict";
// R2a: the REAL `activate` verb body of deploy/oracle/nusa-release-step.sh, run end to end against a temp layout.
// Everything that would touch the host (systemctl, node scripts, unit installation, the soak) is a stub; the control flow,
// the failure handling, the safe stop and the proof logic are the real code. Scenarios inject a failure at each step.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const script = fs.readFileSync(path.join(root, "deploy", "oracle", "nusa-release-step.sh"), "utf8").replace(/\r\n/g, "\n");
const posixOnly = process.platform === "win32" ? { skip: "the release helper runs only on the Linux host" } : {};
const NEW = "a".repeat(40);
const OLD = "b".repeat(40);
const UNITS = ["nusa.service", "nusa-autopilot.service", "nusa-research.timer", "nusa-research.service"];

const head = script.slice(0, script.indexOf('\nverb="${1'));
const activateStart = script.indexOf("\n  activate)\n");
const activateBody = script.slice(activateStart + "\n  activate)\n".length, script.indexOf("\n    ;;", activateStart));

function sandbox({ previousProven = false } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-activate-"));
  const bin = path.join(base, "bin");
  const state = path.join(base, "state");
  const log = path.join(base, "events.log");
  fs.mkdirSync(bin); fs.mkdirSync(state);
  for (const sha of [OLD, NEW]) fs.mkdirSync(path.join(base, "releases", sha), { recursive: true });
  fs.symlinkSync(path.join(base, "releases", OLD), path.join(base, "current"));
  fs.writeFileSync(path.join(base, ".previous-release"), `${path.join(base, "releases", OLD)}\n`);
  for (const u of UNITS) { fs.writeFileSync(path.join(state, u), ""); fs.writeFileSync(path.join(state, `${u}.enabled`), ""); }
  const stub = [
    "#!/usr/bin/env bash",
    `echo "systemctl $*" >> ${JSON.stringify(log)}`,
    'verb="$1"; shift',
    'if [ "${1:-}" = "--quiet" ]; then shift; fi',
    'case "$verb" in',
    `  stop) if [ "\${STOP_RC:-0}" != 0 ]; then for u in "$@"; do rm -f ${JSON.stringify(state)}/$u; done; exit "$STOP_RC"; fi; for u in "$@"; do case " \${STUCK:-} " in *" $u "*) ;; *) rm -f ${JSON.stringify(state)}/$u;; esac; done;;`,
    `  disable) for u in "$@"; do case " \${STUCK_ENABLED:-} " in *" $u "*) ;; *) rm -f ${JSON.stringify(state)}/$u.enabled;; esac; done;;`,
    `  is-active) if [ "\${ISACTIVE_RC:-}" != "" ]; then exit "$ISACTIVE_RC"; fi; [ -e ${JSON.stringify(state)}/$1 ] || exit 3;;`,
    `  is-enabled) if [ "\${ISENABLED_RC:-}" != "" ]; then exit "$ISENABLED_RC"; fi; [ -e ${JSON.stringify(state)}/$1.enabled ] || exit 1;;`,
    "esac",
  ].join("\n");
  fs.writeFileSync(path.join(bin, "systemctl"), `${stub}\n`, { mode: 0o755 });
  return { base, bin, state, log, previousProven };
}

function runActivate(box, env = {}) {
  const stubs = `
acquire_paper_activation_lock() { :; }
assert_segmented_replay_compatible() { :; }
script_in() { printf '%s' "$1/scripts/$2"; }
node() {
  case "$1" in
    */atomic-deploy.js)
      case "\${ATOMIC:-ok}" in
        ok) ln -sfn "$RELEASES/${NEW}" "$DEPLOY_ROOT/current";;
        clean) return 1;;
        partial) ln -sfn "$RELEASES/${NEW}" "$DEPLOY_ROOT/current"; return 1;;
        prevonly) echo "$RELEASES/${NEW}" > "$PREVIOUS_RELEASE_FILE"; return 1;;
        samepath) ln -sfn "$DEPLOY_ROOT/releases/../releases/${OLD}" "$DEPLOY_ROOT/current"; return 1;;
        real|realfail) NUSA_DEPLOY_ROOT="$DEPLOY_ROOT" command node ${JSON.stringify(path.join(root, "scripts", "atomic-deploy.js"))};;
      esac;;
    */oracle-readiness-check.js)
      local rc=0
      if [ -s "$SEQ" ]; then rc="$(head -n1 "$SEQ")"; tail -n +2 "$SEQ" > "$SEQ.next"; mv "$SEQ.next" "$SEQ"; fi
      return "$rc";;
    */autopilot-readiness.js) return "\${AUTOPILOT_RC:-0}";;
  esac
}
bind_runtime_source_identity() { if [ "\${BIND_DIE:-0}" = 1 ]; then die "bind failed"; fi; }
install_units_from_release() { :; }
enable_units() { :; }
restart_units() { echo restart_units >> "$EVENTS"; }
prove_post_activation_stability() { return "\${SOAK_RC:-0}"; }
recover_abandoned_writer_lease_once() { return 1; }
rollback_schema_compatible() { return "\${SCHEMA_RC:-0}"; }
rollback_and_restore() { echo rollback_and_restore >> "$EVENTS"; if [ "\${RESTORE_DIE:-0}" = 1 ]; then die "restore step failed"; fi; ln -sfn "$RELEASES/${OLD}" "$DEPLOY_ROOT/current"; }
release_proven() { [ "\${PREV_PROVEN:-0}" = 1 ]; }
mark_release_proven() { if [ "\${MARK_FAIL:-0}" = 1 ]; then die "cannot record the proof"; fi; echo mark_release_proven >> "$EVENTS"; }
`;
  const program = `${head.replace("readonly DEPLOY_ROOT=/opt/nusa", `readonly DEPLOY_ROOT=${JSON.stringify(box.base)}`)}\n${stubs}\nEVENTS=${JSON.stringify(box.log)}\nSEQ=${JSON.stringify(path.join(box.base, "ready-seq"))}\nset -- ${NEW}\n${activateBody}\n`;
  const file = path.join(box.base, "activate.sh");
  fs.writeFileSync(path.join(box.base, "ready-seq"), (env.READY_SEQ ? env.READY_SEQ.split(" ") : []).map((x) => `${x}\n`).join(""));
  fs.writeFileSync(file, program);
  return spawnSync("bash", [file], { encoding: "utf8", env: { ...process.env, PATH: `${box.bin}:${process.env.PATH}`, ...env } });
}
const events = (box) => (fs.existsSync(box.log) ? fs.readFileSync(box.log, "utf8") : "");
const active = (box, unit) => fs.existsSync(path.join(box.state, unit));
const enabled = (box, unit) => fs.existsSync(path.join(box.state, `${unit}.enabled`));
const assertStopped = (box, r) => {
  assert.equal(r.status, 1);
  assert.match(r.stderr, /STOPPED confirmed for the managed units/);
  for (const u of UNITS) assert.equal(active(box, u), false, `${u} stopped`);
  for (const u of ["nusa.service", "nusa-autopilot.service", "nusa-research.timer"]) assert.equal(enabled(box, u), false, `${u} will not start at boot or by timer`);
  assert.doesNotMatch(events(box), /mark_release_proven/, "a failed activation never records a proof");
};

test("success: a full activation records the proof last and leaves every unit running", posixOnly, () => {
  const box = sandbox();
  const r = runActivate(box);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /activation accepted/);
  assert.match(events(box), /restart_units[\s\S]*mark_release_proven/);
  for (const u of UNITS) assert.equal(active(box, u), true);
});

test("readiness fails and the previous release is not proven: the host ends STOPPED, nothing is rolled back", posixOnly, () => {
  const box = sandbox();
  const r = runActivate(box, { READY_SEQ: "1" });
  assertStopped(box, r);
  assert.match(r.stderr, /no proven, data-compatible previous release to restore/);
  assert.doesNotMatch(events(box), /rollback_and_restore/);
});

test("the soak fails: the host ends STOPPED", posixOnly, () => {
  const box = sandbox();
  assertStopped(box, runActivate(box, { SOAK_RC: "1" }));
});

test("autopilot readiness fails: the host ends STOPPED", posixOnly, () => {
  const box = sandbox();
  assertStopped(box, runActivate(box, { AUTOPILOT_RC: "1" }));
});

test("a die inside the start-up chain (bind) is a failed activation, not a bare exit: the host ends STOPPED", posixOnly, () => {
  const box = sandbox();
  const r = runActivate(box, { BIND_DIE: "1" });
  assertStopped(box, r);
  assert.match(r.stderr, /bind failed/);
});

test("the final active check fails (autopilot not running after an accepted soak): the host ends STOPPED", posixOnly, () => {
  const box = sandbox();
  fs.rmSync(path.join(box.state, "nusa-autopilot.service"));
  // readiness stubs pass, the real final check sees the autopilot inactive
  const r = runActivate(box);
  assertStopped(box, r);
  assert.match(r.stderr, /Autopilot service is not active after activation/);
});

test("atomic-deploy fails and changes nothing: the step fails, running units and pointers are untouched", posixOnly, () => {
  const box = sandbox();
  const r = runActivate(box, { ATOMIC: "clean" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /changed nothing/);
  for (const u of UNITS) assert.equal(active(box, u), true, `${u} still running`);
  assert.doesNotMatch(events(box), /systemctl (stop|disable)/);
  assert.equal(fs.realpathSync(path.join(box.base, "current")), fs.realpathSync(path.join(box.base, "releases", OLD)));
});

test("atomic-deploy fails AFTER moving the release pointer: the host ends STOPPED", posixOnly, () => {
  const box = sandbox();
  const r = runActivate(box, { ATOMIC: "partial" });
  assertStopped(box, r);
  assert.match(r.stderr, /atomic deploy failed after changing the release pointer/);
});

test("a proven, schema-compatible previous release is restored and the step still fails; if it is not ready either the host ends STOPPED", posixOnly, () => {
  const restored = sandbox();
  const r1 = runActivate(restored, { READY_SEQ: "1 0", PREV_PROVEN: "1" });
  assert.equal(r1.status, 1);
  assert.match(events(restored), /rollback_and_restore/);
  assert.match(r1.stderr, /restoring the proven previous release/);
  for (const u of UNITS) assert.equal(active(restored, u), true, "the restored release keeps running");
  const failed = sandbox();
  const r2 = runActivate(failed, { READY_SEQ: "1 1", PREV_PROVEN: "1" });
  assertStopped(failed, r2);
  assert.match(r2.stderr, /could not be restored or did not become ready/);
});

test("a proven previous release that is not schema compatible is not restored: STOPPED", posixOnly, () => {
  const box = sandbox();
  const r = runActivate(box, { READY_SEQ: "1", PREV_PROVEN: "1", SCHEMA_RC: "1" });
  assertStopped(box, r);
  assert.doesNotMatch(events(box), /rollback_and_restore/);
});

test("a unit that does not stop, or stays enabled, is reported as NOT CONFIRMED and the step still fails", posixOnly, () => {
  const stuck = sandbox();
  const r1 = runActivate(stuck, { READY_SEQ: "1", STUCK: "nusa-autopilot.service" });
  assert.equal(r1.status, 1);
  assert.match(r1.stderr, /STOP NOT CONFIRMED:.*nusa-autopilot\.service\(active\)/);
  const enabledStill = sandbox();
  const r2 = runActivate(enabledStill, { READY_SEQ: "1", STUCK_ENABLED: "nusa.service" });
  assert.equal(r2.status, 1);
  assert.match(r2.stderr, /STOP NOT CONFIRMED:.*nusa\.service\(still-enabled\)/);
});

test("atomic-deploy fails after changing ONLY the previous-release record: the host ends STOPPED", posixOnly, () => {
  const box = sandbox();
  assertStopped(box, runActivate(box, { ATOMIC: "prevonly" }));
});

test("atomic-deploy fails after replacing the link with a different literal target that resolves to the same release: detected, STOPPED", posixOnly, () => {
  const box = sandbox();
  assertStopped(box, runActivate(box, { ATOMIC: "samepath" }));
});

test("the REAL atomic-deploy.js: a successful switch completes; a refused switch (release not a real directory) changes nothing", posixOnly, () => {
  const ok = sandbox();
  const r1 = runActivate(ok, { ATOMIC: "real" });
  assert.equal(r1.status, 0, r1.stderr);
  assert.equal(fs.realpathSync(path.join(ok.base, "current")), fs.realpathSync(path.join(ok.base, "releases", NEW)));
  const refused = sandbox();
  fs.rmSync(path.join(refused.base, "releases", NEW), { recursive: true });
  fs.symlinkSync("/tmp", path.join(refused.base, "releases", NEW));
  const r2 = runActivate(refused, { ATOMIC: "realfail" });
  assert.equal(r2.status, 1);
  assert.match(r2.stderr, /changed nothing/);
  for (const u of UNITS) assert.equal(active(refused, u), true);
});

test("recording the proof fails after an accepted soak: the host ends STOPPED, the activation is not accepted", posixOnly, () => {
  const box = sandbox();
  const r = runActivate(box, { MARK_FAIL: "1" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /the proof of the accepted release could not be recorded/);
  assert.doesNotMatch(r.stdout, /activation accepted/);
  for (const u of UNITS) assert.equal(active(box, u), false);
});

test("a real die inside the restore of a proven previous release ends in the safe stop", posixOnly, () => {
  const box = sandbox();
  const r = runActivate(box, { READY_SEQ: "1", PREV_PROVEN: "1", RESTORE_DIE: "1" });
  assertStopped(box, r);
  assert.match(r.stderr, /restore step failed/);
});

test("abnormal is-active or is-enabled results, and failing stop commands, are NOT CONFIRMED", posixOnly, () => {
  const a = sandbox();
  const r1 = runActivate(a, { READY_SEQ: "1", ISACTIVE_RC: "5" });
  assert.equal(r1.status, 1);
  assert.match(r1.stderr, /STOP NOT CONFIRMED:.*is-active-check-failed:5/);
  const b = sandbox();
  const r2 = runActivate(b, { READY_SEQ: "1", ISENABLED_RC: "9" });
  assert.match(r2.stderr, /STOP NOT CONFIRMED:.*is-enabled-check-failed:9/);
  const c = sandbox();
  const r3 = runActivate(c, { READY_SEQ: "1", STOP_RC: "1" });
  assert.match(r3.stderr, /STOP NOT CONFIRMED:.*stop-failed/, "a failing stop command is never reported as a confirmed stop, even if the unit looks inactive");
});
