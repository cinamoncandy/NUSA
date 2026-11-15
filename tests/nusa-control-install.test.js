"use strict";
// The one-time install script (deploy/control/install.sh) run against a temporary directory tree with stub systemctl, curl and
// controller. Proves: preflight is read-only and checks every precondition; --apply refuses unless all pass; the order of
// the steps; the hash gate; the failure hint; rollback.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const script = path.join(root, "deploy", "control", "install.sh");
const SHA = "e".repeat(40);
const posixOnly = process.platform === "win32" ? { skip: "bash installer" } : {};
const sha256 = (t) => crypto.createHash("sha256").update(t).digest("hex");

function world(opts = {}) {
  const R = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-install-"));
  const mk = (p, mode = 0o755) => { fs.mkdirSync(path.join(R, p), { recursive: true }); fs.chmodSync(path.join(R, p), mode); };
  for (const d of ["opt", "opt/nusa", "etc", "etc/nusa", "etc/systemd/system", "var/lib"]) mk(d);
  mk(`opt/nusa/releases/${SHA}/deploy/control/dropins`);
  const src = path.join(R, "opt/nusa/releases", SHA, "deploy/control");
  const log = path.join(R, "calls.log");
  const stubJs = `// stub controller ${opts.tag || ""}\n`;
  fs.writeFileSync(path.join(src, "nusa-control.js"), stubJs);
  fs.writeFileSync(path.join(src, "nusa-control.sh"), `#!/usr/bin/env bash\necho "controller $*" >> ${JSON.stringify(log)}\n${opts.failVerb ? `[ "$1" = ${JSON.stringify(opts.failVerb)} ] && exit 1\n` : ""}exit 0\n`);
  for (const f of ["nusa-control-reconcile.service", "nusa-control-verify.service", "nusa-control-verify.timer"]) fs.copyFileSync(path.join(root, "deploy/control", f), path.join(src, f));
  for (const u of ["nusa.service", "nusa-research.timer", "nusa-research.service"]) {
    fs.mkdirSync(path.join(src, "dropins", `${u}.d`), { recursive: true });
    for (const c of fs.readdirSync(path.join(root, "deploy/control/dropins", `${u}.d`))) fs.copyFileSync(path.join(root, "deploy/control/dropins", `${u}.d`, c), path.join(src, "dropins", `${u}.d`, c));
  }
  fs.symlinkSync(path.join(R, "opt/nusa/releases", SHA), path.join(R, "opt/nusa/current"));
  fs.writeFileSync(path.join(R, "etc/nusa/cloud-runtime.env"), opts.env ?? "NUSA_PAPER_ORDER_PATH=OFF\nNUSA_CLOUD_PORT=1\n");
  const bin = path.join(R, "bin"); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "systemctl"), `#!/usr/bin/env bash\necho "systemctl $*" >> ${JSON.stringify(log)}\nexit 0\n`, { mode: 0o755 });
  const health = opts.health ?? JSON.stringify({ runtime: { sourceCommitSha: SHA, runMode: "COLLECT_ONLY" } });
  fs.writeFileSync(path.join(bin, "curl"), `#!/usr/bin/env bash\ncat <<'JSON'\n${health}\nJSON\n`, { mode: 0o755 });
  if (opts.stateFile) { mk("var/lib/nusa-control", 0o700); fs.writeFileSync(path.join(R, "var/lib/nusa-control/state.json"), "{}"); }
  if (opts.unsafe) fs.chmodSync(path.join(R, opts.unsafe), 0o777);
  if (opts.notActive) { fs.rmSync(path.join(R, "opt/nusa/current")); fs.mkdirSync(path.join(R, "opt/nusa/releases", "f".repeat(40)), { recursive: true }); fs.symlinkSync(path.join(R, "opt/nusa/releases", "f".repeat(40)), path.join(R, "opt/nusa/current")); }
  const run = (...args) => spawnSync("bash", [script, SHA, ...args], { encoding: "utf8", env: { ...process.env, NUSA_INSTALL_ROOT: R, PATH: `${bin}:${process.env.PATH}` } });
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : []);
  const snapshot = () => { const out = []; const walk = (d) => { for (const n of fs.readdirSync(d).sort()) { const p = path.join(d, n); const st = fs.lstatSync(p); out.push(`${p}:${st.mode}:${st.isFile() ? sha256(fs.readFileSync(p)) : ""}`); if (st.isDirectory()) walk(p); } }; walk(R); return out.filter((l) => !l.includes("calls.log")).join("\n"); };
  return { R, src, run, calls, snapshot, hash: sha256(stubJs) };
}

test("preflight on a correct host passes every check and changes nothing", posixOnly, () => {
  const w = world(); const before = w.snapshot();
  const r = w.run(w.hash);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /preflight result: 0 failure\(s\)/);
  assert.match(r.stdout, /PASS  nusa-control\.js matches the hash from the reviewed pull request/);
  assert.equal(w.snapshot(), before, "preflight is read-only");
  assert.deepEqual(w.calls().filter((c) => !/is-active/.test(c)), [], "only is-active was asked of systemd");
});

test("every precondition is enforced: a failing one fails the preflight, and --apply refuses and changes nothing", posixOnly, () => {
  const cases = [
    ["release is not the active one", { notActive: true }, /FAIL  release .* is the active release/],
    ["hash from the pull request does not match", {}, /FAIL  nusa-control\.js matches the hash/, "0".repeat(64)],
    ["orders are not explicitly OFF", { env: "NUSA_CLOUD_PORT=1\n" }, /FAIL  orders are explicitly OFF/],
    ["a run mode is already set", { env: "NUSA_PAPER_ORDER_PATH=OFF\nNUSA_RUN_MODE=PAPER_ORDERS\n" }, /FAIL  no NUSA_RUN_MODE is set/],
    ["another build is running", { health: JSON.stringify({ runtime: { sourceCommitSha: "a".repeat(40), runMode: "COLLECT_ONLY" } }) }, /FAIL  \/health answers with this commit/],
    ["the running runtime is not the new one (no runMode)", { health: JSON.stringify({ runtime: { sourceCommitSha: SHA } }) }, /FAIL  \/health reports runMode COLLECT_ONLY/],
    ["a state file already exists", { stateFile: true }, /FAIL  no controller state file exists yet/],
    ["/etc/nusa is writable by others", { unsafe: "etc/nusa" }, /FAIL  directory \/etc\/nusa is real, root-owned and not group\/other-writable/],
  ];
  for (const [label, opts, expected, hashOverride] of cases) {
    const w = world(opts); const before = w.snapshot();
    const pre = w.run(hashOverride || w.hash);
    assert.notEqual(pre.status, 0, label); assert.match(pre.stdout, expected, label);
    const apply = w.run(hashOverride || w.hash, "--apply");
    assert.notEqual(apply.status, 0, `${label}: apply refuses`); assert.match(apply.stderr + apply.stdout, /nothing was changed/, label);
    assert.equal(w.snapshot(), before, `${label}: nothing changed`);
  }
});

test("--apply needs the reviewed hash as its second argument", posixOnly, () => {
  const w = world(); const r = w.run("--apply");
  assert.notEqual(r.status, 0);
  assert.equal(w.calls().filter((c) => !/is-active/.test(c)).length, 0);
});

test("--apply installs in the safe order with the right owners and modes, then init, then collect, then status", posixOnly, () => {
  const w = world();
  const r = w.run(w.hash, "--apply");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const mode = (p) => (fs.statSync(path.join(w.R, p)).mode & 0o777).toString(8);
  assert.equal(fs.readFileSync(path.join(w.R, "etc/nusa/run-mode.env"), "utf8"), "NUSA_RUN_MODE=COLLECT_ONLY\n");
  assert.equal(mode("etc/nusa/run-mode.env"), "644"); assert.equal(mode("var/lib/nusa-control"), "700");
  assert.equal(mode("opt/nusa-control/nusa-control.js"), "755"); assert.equal(mode("opt/nusa-control/nusa-control.sh"), "755");
  for (const f of ["nusa-control-reconcile.service", "nusa-control-verify.service", "nusa-control-verify.timer", "nusa.service.d/10-control-gate.conf", "nusa.service.d/20-run-mode.conf", "nusa-research.timer.d/10-control-gate.conf", "nusa-research.service.d/10-control-gate.conf"]) assert.equal(mode(`etc/systemd/system/${f}`), "644", f);
  const calls = w.calls().filter((c) => !/is-active/.test(c));
  assert.deepEqual(calls, ["systemctl daemon-reload", "systemctl enable nusa-control-reconcile.service nusa-control-verify.timer", "systemctl start nusa-control-verify.timer", `controller init ${SHA}`, "controller collect", "controller status"]);
  assert.match(r.stdout, /DONE  controller installed/);
  const files = fs.readFileSync(path.join(w.R, "etc/nusa/cloud-runtime.env"), "utf8");
  assert.equal(files, "NUSA_PAPER_ORDER_PATH=OFF\nNUSA_CLOUD_PORT=1\n", "the runtime environment file is never modified");
});

test("a failing step prints the rollback hint, stops, and the order switch is still OFF", posixOnly, () => {
  for (const failVerb of ["init", "collect"]) {
    const w = world({ failVerb });
    const r = w.run(w.hash, "--apply");
    assert.notEqual(r.status, 0, failVerb);
    assert.match(r.stderr, /failed at: .*Nothing orders \(orders are OFF\)\. Run:  sudo bash .* --rollback/s, failVerb);
    assert.equal(fs.readFileSync(path.join(w.R, "etc/nusa/cloud-runtime.env"), "utf8"), "NUSA_PAPER_ORDER_PATH=OFF\nNUSA_CLOUD_PORT=1\n");
  }
});

test("--rollback removes the units, drop-ins and mode file, re-enables the runtime and keeps the controller files and the state for inspection", posixOnly, () => {
  const w = world(); w.run(w.hash, "--apply");
  const r = w.run("--rollback");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const f of ["etc/nusa/run-mode.env", "etc/systemd/system/nusa-control-reconcile.service", "etc/systemd/system/nusa.service.d/20-run-mode.conf", "etc/systemd/system/nusa.service.d/10-control-gate.conf"]) assert.equal(fs.existsSync(path.join(w.R, f)), false, f);
  assert.equal(fs.existsSync(path.join(w.R, "opt/nusa-control/nusa-control.js")), true);
  const calls = w.calls().filter((c) => !/is-active/.test(c));
  const tail = calls.slice(calls.indexOf("systemctl daemon-reload", calls.indexOf("controller status")));
  assert.deepEqual(tail.slice(-4), ["systemctl daemon-reload", "systemctl enable nusa.service nusa-research.timer", "systemctl restart nusa.service", "systemctl start nusa-research.timer"]);
});

test("the script never writes the runtime environment file or any secret path, and uses no network except the local /health", () => {
  const text = fs.readFileSync(script, "utf8");
  assert.doesNotMatch(text, />\s*"?\$R\/etc\/nusa\/cloud-runtime\.env|sed -i|tee [^\n]*cloud-runtime/);
  assert.doesNotMatch(text, /wget|git clone|https?:\/\/(?!127\.0\.0\.1)/);
  assert.match(text, /curl -fsS -m 6 http:\/\/127\.0\.0\.1:41731\/health/);
  assert.doesNotMatch(text, /PAPER_ORDERS/, "the installer never names an order mode");
});
