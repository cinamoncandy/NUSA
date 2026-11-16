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
// Same definition as the script: sha256sum lines "<hash>  ./path" for every file except install.sh, sorted bytewise, hashed.
function manifestHash(dir) {
  const out = [];
  const walk = (d, rel) => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); const r = `${rel}/${n}`; if (fs.lstatSync(p).isDirectory()) walk(p, r); else if (n !== "install.sh") out.push([r, sha256(fs.readFileSync(p))]); } };
  walk(dir, ".");
  out.sort((a, b) => Buffer.compare(Buffer.from(a[0]), Buffer.from(b[0])));
  return sha256(out.map(([r, h]) => `${h}  ${r}\n`).join(""));
}

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
  if (!opts.noUnitFile) fs.writeFileSync(path.join(R, "etc/systemd/system/nusa.service"), `[Service]\nEnvironmentFile=${R}/etc/nusa/cloud-runtime.env\nEnvironment=HOME=/var/lib/nusa\n`);
  fs.writeFileSync(path.join(R, "etc/nusa/cloud-runtime.env"), opts.env ?? "NUSA_PAPER_ORDER_PATH=OFF\nNUSA_CLOUD_PORT=1\n");
  const bin = path.join(R, "bin"); fs.mkdirSync(bin);
  const showStub = `if [ "$1" = show ]; then ${opts.showFail ? "exit 1;" : ""} ${opts.showFailOn ? `case "$*" in *${JSON.stringify(opts.showFailOn)}*) exit 1;; esac;` : ""} case "$*" in *"-p Id"*) echo ${JSON.stringify(opts.showId ?? "nusa.service")};; *"-p EnvironmentFiles"*) printf '%b\\n' ${JSON.stringify((opts.showFiles ?? "ROOT/etc/nusa/cloud-runtime.env (ignore_errors=no)").replaceAll("ROOT", R))};; *) printf '%s\\n' ${JSON.stringify(opts.showEnv || "HOME=/var/lib/nusa")};; esac; exit 0; fi`;
  fs.writeFileSync(path.join(bin, "systemctl"), `#!/usr/bin/env bash\necho "systemctl $*" >> ${JSON.stringify(log)}\n${showStub}\nexit 0\n`, { mode: 0o755 });
  if (opts.tamperAt) {
    // A wrapper around install(1): on the first call after the private copy is checked, the release tree is changed (a race).
    const flag = path.join(R, "tampered");
    fs.writeFileSync(path.join(bin, "install"), `#!/usr/bin/env bash\nif [ ! -e ${JSON.stringify(flag)} ]; then touch ${JSON.stringify(flag)}; echo "// evil" >> ${JSON.stringify(path.join(src, "nusa-control.js"))}; fi\nexec /usr/bin/install "$@"\n`, { mode: 0o755 });
  }
  if (opts.tamperDuringPreflight) fs.writeFileSync(path.join(bin, "systemctl"), `#!/usr/bin/env bash\necho "systemctl $*" >> ${JSON.stringify(log)}\n[ "$1" = is-active ] && echo "// evil" >> ${JSON.stringify(path.join(src, "nusa-control.js"))}\n${showStub}\nexit 0\n`, { mode: 0o755 });
  if (opts.grepError) fs.writeFileSync(path.join(bin, "grep"), `#!/usr/bin/env bash\ncase "$*" in *"Environment=.*NUSA_PAPER_ORDER_PATH"*) exit 2;; esac\nexec /usr/bin/grep "$@"\n`, { mode: 0o755 });
  if (opts.sedFail) fs.writeFileSync(path.join(bin, "sed"), `#!/usr/bin/env bash\ncase "$*" in *ignore_errors*) echo "${R}/etc/nusa/cloud-runtime.env no"; exit 3;; esac\nexec /usr/bin/sed "$@"\n`, { mode: 0o755 });
  if (opts.grepCountError) fs.writeFileSync(path.join(bin, "grep"), `#!/usr/bin/env bash\ncase "$1 $2" in ${opts.grepCountError === "exact" ? '"-cx NUSA_PAPER_ORDER_PATH=OFF"' : '"-c NUSA_PAPER_ORDER_PATH"'}) echo 2; exit 2;; esac\nexec /usr/bin/grep "$@"\n`, { mode: 0o755 });
  const health = opts.health ?? JSON.stringify({ runtime: { sourceCommitSha: SHA, runMode: "COLLECT_ONLY" } });
  fs.writeFileSync(path.join(bin, "curl"), `#!/usr/bin/env bash\ncat <<'JSON'\n${health}\nJSON\n`, { mode: 0o755 });
  if (opts.symlinkInTree) fs.symlinkSync("/etc/passwd", path.join(src, "evil"));
  if (opts.extraFile) fs.writeFileSync(path.join(src, "extra.conf"), "x");
  if (opts.dropinDir) { fs.mkdirSync(path.join(R, "etc/systemd/system/nusa.service.d/sub"), { recursive: true }); }
  if (opts.dropinOrders) { fs.mkdirSync(path.join(R, "etc/systemd/system/nusa.service.d")); fs.writeFileSync(path.join(R, "etc/systemd/system/nusa.service.d/50.conf"), "[Service]\nEnvironment=NUSA_PAPER_ORDER_PATH=ON\n"); }
  if (opts.stateFile) { mk("var/lib/nusa-control", 0o700); fs.writeFileSync(path.join(R, "var/lib/nusa-control/state.json"), "{}"); }
  if (opts.unsafe) fs.chmodSync(path.join(R, opts.unsafe), 0o777);
  if (opts.notActive) { fs.rmSync(path.join(R, "opt/nusa/current")); fs.mkdirSync(path.join(R, "opt/nusa/releases", "f".repeat(40)), { recursive: true }); fs.symlinkSync(path.join(R, "opt/nusa/releases", "f".repeat(40)), path.join(R, "opt/nusa/current")); }
  const run = (...args) => spawnSync("bash", [script, SHA, ...args], { encoding: "utf8", env: { ...process.env, NUSA_INSTALL_ROOT: R, ...(opts.noTestFlag ? {} : { NUSA_INSTALL_TEST_MODE: "yes-this-is-a-test-tree" }), PATH: `${bin}:${process.env.PATH}` } });
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : []);
  const snapshot = () => { const out = []; const walk = (d) => { for (const n of fs.readdirSync(d).sort()) { const p = path.join(d, n); const st = fs.lstatSync(p); out.push(`${p}:${st.mode}:${st.isFile() ? sha256(fs.readFileSync(p)) : ""}`); if (st.isDirectory()) walk(p); } }; walk(R); return out.filter((l) => !l.includes("calls.log")).join("\n"); };
  const w = { R, src, run, calls, snapshot };
  Object.defineProperty(w, "hash", { get: () => manifestHash(src) });
  return w;
}

test("preflight on a correct host passes every check and changes nothing", posixOnly, () => {
  const w = world(); const before = w.snapshot();
  const r = w.run(w.hash);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /preflight result: 0 failure\(s\)/);
  assert.match(r.stdout, /PASS  every control file matches the manifest hash/);
  assert.equal(w.snapshot(), before, "preflight is read-only");
  assert.deepEqual(w.calls().filter((c) => !/is-active|^systemctl show/.test(c)), [], "only is-active was asked of systemd");
});

test("every precondition is enforced: a failing one fails the preflight, and --apply refuses and changes nothing", posixOnly, () => {
  const cases = [
    ["release is not the active one", { notActive: true }, /FAIL  release .* is the active release/],
    ["hash from the pull request does not match", {}, /FAIL  every control file matches the manifest hash/, "0".repeat(64)],
    ["an extra file is in the release tree", { extraFile: true }, /FAIL  every control file matches the manifest hash/, "STALE"],
    ["a symlink is in the release tree", { symlinkInTree: true }, /FAIL  source tree has no symlinks/],
    ["orders are not explicitly OFF", { env: "NUSA_CLOUD_PORT=1\n" }, /FAIL  orders are OFF from every environment source/],
    ["orders are set twice in the env file", { env: "NUSA_PAPER_ORDER_PATH=OFF\nNUSA_PAPER_ORDER_PATH=ON\n" }, /FAIL  orders are OFF from every environment source/],
    ["ON first, OFF later", { env: "NUSA_PAPER_ORDER_PATH=ON\nNUSA_PAPER_ORDER_PATH=OFF\n" }, /FAIL  orders are OFF from every environment source/],
    ["an indented ON line after OFF", { env: "NUSA_PAPER_ORDER_PATH=OFF\n  NUSA_PAPER_ORDER_PATH=ON\n" }, /FAIL  orders are OFF from every environment source/],
    ["an export ON line after OFF", { env: "NUSA_PAPER_ORDER_PATH=OFF\nexport NUSA_PAPER_ORDER_PATH=ON\n" }, /FAIL  orders are OFF from every environment source/],
    ["a quoted ON line after OFF", { env: "NUSA_PAPER_ORDER_PATH=OFF\nNUSA_PAPER_ORDER_PATH=\"ON\"\n" }, /FAIL  orders are OFF from every environment source/],
    ["orders are set in a unit drop-in", { dropinOrders: true }, /FAIL  orders are OFF from every environment source/],
    ["the unit file cannot be searched (missing unit file: grep error is not OFF)", { noUnitFile: true }, /FAIL  orders are OFF from every environment source/],
    ["a drop-in is unreadable (a directory where a file is expected)", { dropinDir: true }, /FAIL  orders are OFF from every environment source/],
    ["grep itself fails (exit 2) while searching the unit files", { grepError: true }, /FAIL  orders are OFF from every environment source/],
    ["grep -c (mentions) fails with exit 2 after printing 2", { grepCountError: "mentions", env: "NUSA_PAPER_ORDER_PATH=OFF\nNUSA_PAPER_ORDER_PATH=OFF\n" }, /FAIL  orders are OFF from every environment source/],
    ["grep -cx (exact) fails with exit 2 after printing 2", { grepCountError: "exact", env: "NUSA_PAPER_ORDER_PATH=OFF\nNUSA_PAPER_ORDER_PATH=OFF\n" }, /FAIL  orders are OFF from every environment source/],
    ["systemd cannot answer (fail closed)", { showFail: true }, /FAIL  orders are OFF from every environment source/],
    ["systemd cannot answer the Environment query only", { showFailOn: "-p Environment --value" }, /FAIL  orders are OFF from every environment source/],
    ["systemd cannot answer the EnvironmentFiles query only", { showFailOn: "-p EnvironmentFiles" }, /FAIL  orders are OFF from every environment source/],
    ["the unit does not read cloud-runtime.env (empty EnvironmentFiles)", { showFiles: "" }, /FAIL  orders are OFF from every environment source/],
    ["only run-mode.env is registered", { showFiles: "ROOT/etc/nusa/run-mode.env (ignore_errors=no)" }, /FAIL  orders are OFF from every environment source/],
    ["a second foreign file on the same line", { showFiles: "ROOT/etc/nusa/cloud-runtime.env (ignore_errors=no) /etc/nusa/extra.env (ignore_errors=yes)" }, /FAIL  orders are OFF from every environment source/],
    ["cloud-runtime.env is registered with ignore_errors=yes", { showFiles: "ROOT/etc/nusa/cloud-runtime.env (ignore_errors=yes)" }, /FAIL  orders are OFF from every environment source/],
    ["a file entry without its ignore_errors flag", { showFiles: "ROOT/etc/nusa/cloud-runtime.env" }, /FAIL  orders are OFF from every environment source/],
    ["the parser (sed) itself fails", { sedFail: true }, /FAIL  orders are OFF from every environment source/],
    ["systemd answers for another unit", { showId: "other.service" }, /FAIL  orders are OFF from every environment source/],
    ["another EnvironmentFile feeds the unit", { showFiles: "/etc/nusa/extra.env (ignore_errors=no)" }, /FAIL  orders are OFF from every environment source/],
    ["orders are set in the unit environment as systemd sees it", { showEnv: "Environment=NUSA_PAPER_ORDER_PATH=ON" }, /FAIL  orders are OFF from every environment source/],
    ["a run mode is already set", { env: "NUSA_PAPER_ORDER_PATH=OFF\nNUSA_RUN_MODE=PAPER_ORDERS\n" }, /FAIL  no NUSA_RUN_MODE is set/],
    ["another build is running", { health: JSON.stringify({ runtime: { sourceCommitSha: "a".repeat(40), runMode: "COLLECT_ONLY" } }) }, /FAIL  \/health is valid JSON from the commit/],
    ["the running runtime is not the new one (no runMode)", { health: JSON.stringify({ runtime: { sourceCommitSha: SHA } }) }, /FAIL  \/health is valid JSON from the commit/],
    ["a state file already exists", { stateFile: true }, /FAIL  no controller state file exists yet/],
    ["/etc/nusa is writable by others", { unsafe: "etc/nusa" }, /FAIL  directory \/etc\/nusa is real, root-owned and not group\/other-writable/],
  ];
  for (const [label, opts, expected, hashOverride] of cases) {
    const w = world(opts); const before = w.snapshot();
    const useHash = hashOverride === "STALE" ? "1".repeat(64) : hashOverride || w.hash;
    const pre = w.run(useHash);
    assert.notEqual(pre.status, 0, label); assert.match(pre.stdout, expected, label);
    const apply = w.run(useHash, "--apply");
    assert.notEqual(apply.status, 0, `${label}: apply refuses`); assert.match(apply.stderr + apply.stdout, /nothing was changed/, label);
    assert.equal(w.snapshot(), before, `${label}: nothing changed`);
  }
});

test("both systemd output shapes for EnvironmentFiles are accepted (one line, or one file per line), including after the install", posixOnly, () => {
  for (const showFiles of ["ROOT/etc/nusa/cloud-runtime.env (ignore_errors=no) ROOT/etc/nusa/run-mode.env (ignore_errors=no)", "ROOT/etc/nusa/cloud-runtime.env (ignore_errors=no)\\nROOT/etc/nusa/run-mode.env (ignore_errors=no)"]) {
    const w = world({ showFiles });
    const r = w.run(w.hash); assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(w.run(w.hash, "--apply").status, 0); assert.equal(w.run("--rollback").status, 0);
  }
});

test("the real host's env file repeats the OFF line twice: that passes (every mention is exactly OFF), apply and rollback work", posixOnly, () => {
  const w = world({ env: "NUSA_PAPER_ORDER_PATH=OFF\nNUSA_CLOUD_PORT=1\nNUSA_PAPER_ORDER_PATH=OFF\n" });
  const r = w.run(w.hash); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(w.run(w.hash, "--apply").status, 0); assert.equal(w.run("--rollback").status, 0);
});

const STOPPED_STATE = { schemaVersion: 1, version: 3, desired: "STOPPED", active: "e".repeat(40), adopted: true, proven: [], attempt: null, grant: null, intent: null };
function afterRollbackWorld(opts = {}) {
  const w = world(opts);
  assert.equal(w.run(w.hash, "--apply").status, 0);
  assert.equal(w.run("--rollback").status, 0);
  fs.writeFileSync(path.join(w.R, "var/lib/nusa-control/state.json"), JSON.stringify(opts.state ?? STOPPED_STATE), { mode: 0o600 });
  return w;
}

test("--after-rollback installs again after a rollback: the leftovers are moved aside (never deleted) and a new manifest and anchor are written", posixOnly, () => {
  const w = afterRollbackWorld();
  // without the flag the leftovers are refused
  const plain = w.run(w.hash);
  assert.notEqual(plain.status, 0); assert.match(plain.stdout, /FAIL  no controller state file exists yet/);
  const pre = w.run(w.hash, "--after-rollback");
  assert.equal(pre.status, 0, pre.stdout + pre.stderr);
  assert.match(pre.stdout, /PASS  only the leftovers of a rollback/);
  const before = w.snapshot();
  assert.equal(w.run(w.hash, "--after-rollback").status, 0); assert.equal(w.snapshot(), before, "preflight with the flag is read-only too");
  const stateDir = path.join(w.R, "var/lib/nusa-control");
  const oldManifest = fs.readFileSync(path.join(w.R, "opt/nusa-control/INSTALL-MANIFEST"), "utf8");
  const r = w.run(w.hash, "--apply", "--after-rollback");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /DONE  controller installed/);
  const names = fs.readdirSync(stateDir);
  assert.ok(names.some((n) => /^state\.json\.rolled-back-\d{8}T\d{6}Z$/.test(n)), `the old state is kept: ${names}`);
  assert.ok(names.some((n) => /^install-manifest\.sha256\.rolled-back-/.test(n)), "the old anchor is kept");
  assert.equal(names.includes("state.json"), false, "no stale state is left for the new init");
  const aside = fs.readdirSync(path.join(w.R, "opt/nusa-control")).find((n) => /^INSTALL-MANIFEST\.rolled-back-/.test(n));
  assert.equal(fs.readFileSync(path.join(w.R, "opt/nusa-control", aside), "utf8"), oldManifest);
  assert.ok(names.includes("install-manifest.sha256"), "a new anchor");
  const calls = w.calls().filter((c) => /controller (init|collect|status)/.test(c));
  assert.deepEqual(calls.slice(-3), [`controller init ${SHA}`, "controller collect", "controller status"]);
  // and the new install can be rolled back again
  assert.equal(w.run("--rollback").status, 0);
});

test("--after-rollback refuses anything that is not exactly a rollback leftover, and changes nothing", posixOnly, () => {
  const damage = {
    "state says COLLECT_ONLY": (w) => fs.writeFileSync(path.join(w.R, "var/lib/nusa-control/state.json"), JSON.stringify({ ...STOPPED_STATE, desired: "COLLECT_ONLY" })),
    "state has an attempt": (w) => fs.writeFileSync(path.join(w.R, "var/lib/nusa-control/state.json"), JSON.stringify({ ...STOPPED_STATE, attempt: { sha: "x", count: 1 } })),
    "state has an intent": (w) => fs.writeFileSync(path.join(w.R, "var/lib/nusa-control/state.json"), JSON.stringify({ ...STOPPED_STATE, intent: { verb: "collect" } })),
    "state has a grant": (w) => fs.writeFileSync(path.join(w.R, "var/lib/nusa-control/state.json"), JSON.stringify({ ...STOPPED_STATE, grant: { sha: "x" } })),
    "state is not JSON": (w) => fs.writeFileSync(path.join(w.R, "var/lib/nusa-control/state.json"), "not json"),
    "no state file": (w) => fs.rmSync(path.join(w.R, "var/lib/nusa-control/state.json")),
    "state is a symlink": (w) => { const f = path.join(w.R, "var/lib/nusa-control/state.json"); fs.renameSync(f, path.join(w.R, "real-state.json")); fs.symlinkSync(path.join(w.R, "real-state.json"), f); },
    "a controller unit is still installed": (w) => fs.writeFileSync(path.join(w.R, "etc/systemd/system/nusa-control-verify.timer"), "[Timer]\n"),
    "a drop-in is still installed": (w) => { fs.mkdirSync(path.join(w.R, "etc/systemd/system/nusa.service.d"), { recursive: true }); fs.writeFileSync(path.join(w.R, "etc/systemd/system/nusa.service.d/20-run-mode.conf"), "[Service]\n"); },
    "the mode file is still there": (w) => fs.writeFileSync(path.join(w.R, "etc/nusa/run-mode.env"), "NUSA_RUN_MODE=COLLECT_ONLY\n"),
    "the anchor does not match the manifest": (w) => fs.writeFileSync(path.join(w.R, "var/lib/nusa-control/install-manifest.sha256"), "0".repeat(64) + "\n", { mode: 0o600 }),
    "the manifest was edited": (w) => fs.appendFileSync(path.join(w.R, "opt/nusa-control/INSTALL-MANIFEST"), "x\n"),
    "the controller script was changed": (w) => fs.appendFileSync(path.join(w.R, "opt/nusa-control/nusa-control.js"), "//x\n"),
    "the manifest is missing": (w) => fs.rmSync(path.join(w.R, "opt/nusa-control/INSTALL-MANIFEST")),
  };
  for (const [label, fn] of Object.entries(damage)) {
    const w = afterRollbackWorld(); fn(w);
    const before = w.snapshot(); const callsBefore = w.calls().length;
    const pre = w.run(w.hash, "--after-rollback");
    assert.notEqual(pre.status, 0, label); assert.match(pre.stdout, /FAIL  only the leftovers of a rollback/, label);
    const apply = w.run(w.hash, "--apply", "--after-rollback");
    assert.notEqual(apply.status, 0, `${label}: apply refuses`); assert.match(apply.stderr + apply.stdout, /nothing was changed/, label);
    assert.equal(w.snapshot(), before, `${label}: nothing changed`);
    assert.equal(w.calls().filter((c) => !/is-active|^systemctl show/.test(c)).length, w.calls().slice(0, callsBefore).filter((c) => !/is-active|^systemctl show/.test(c)).length, `${label}: no new mutation`);
  }
  // on a fresh host (no leftovers) the flag is refused too
  const fresh = world(); const r = fresh.run(fresh.hash, "--after-rollback");
  assert.notEqual(r.status, 0); assert.match(r.stdout, /FAIL  only the leftovers of a rollback/);
});

test("the test root is refused unless the test flag is set (a stray variable cannot redirect a root install)", posixOnly, () => {
  const w = world({ noTestFlag: true }); const r = w.run(w.hash);
  assert.notEqual(r.status, 0); assert.match(r.stderr, /NUSA_INSTALL_ROOT is for tests only/);
  assert.deepEqual(w.calls(), []);
});

test("a release tree changed after the check cannot change what is installed (private copy)", posixOnly, () => {
  // changed after the preflight but before the copy: the private copy no longer matches the reviewed hash, nothing is installed
  const a = world({ tamperDuringPreflight: true }); const h = a.hash; const before = a.snapshot();
  const ra = a.run(h, "--apply");
  assert.notEqual(ra.status, 0); assert.match(ra.stderr, /private copy does not match the reviewed manifest hash/);
  assert.equal(fs.existsSync(path.join(a.R, "opt/nusa-control")), false); assert.equal(fs.existsSync(path.join(a.R, "etc/nusa/run-mode.env")), false);
  // changed after the private copy was verified: the installed file is still the verified one
  const b = world({ tamperAt: true }); const original = fs.readFileSync(path.join(b.src, "nusa-control.js"), "utf8");
  const rb = b.run(b.hash, "--apply");
  assert.equal(rb.status, 0, rb.stdout + rb.stderr);
  assert.equal(fs.readFileSync(path.join(b.R, "opt/nusa-control/nusa-control.js"), "utf8"), original);
  assert.notEqual(fs.readFileSync(path.join(b.src, "nusa-control.js"), "utf8"), original, "the race really happened");
  void before;
});

test("--apply needs the reviewed hash as its second argument", posixOnly, () => {
  const w = world(); const r = w.run("--apply");
  assert.notEqual(r.status, 0);
  assert.equal(w.calls().filter((c) => !/is-active|^systemctl show/.test(c)).length, 0);
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
  const calls = w.calls().filter((c) => !/is-active|^systemctl show/.test(c));
  assert.deepEqual(calls, ["systemctl daemon-reload", "systemctl enable nusa-control-reconcile.service nusa-control-verify.timer", "systemctl start nusa-control-verify.timer", `controller init ${SHA}`, "controller collect", "controller status"]);
  assert.match(r.stdout, /DONE  controller installed/);
  const manifest = fs.readFileSync(path.join(w.R, "opt/nusa-control/INSTALL-MANIFEST"), "utf8").replace(/\r\n/g, "\n");
  assert.match(manifest, /etc\/nusa\/run-mode\.env/); assert.match(manifest, /opt\/nusa-control\/nusa-control\.js/); assert.match(manifest, /nusa\.service\.d\/20-run-mode\.conf/);
  assert.deepEqual(fs.readdirSync(path.join(w.R, "var/lib")).filter((n) => n.startsWith(".nusa-install")), [], "the private copy is removed");
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
  const calls = w.calls().filter((c) => !/is-active|^systemctl show/.test(c));
  const tail = calls.slice(calls.indexOf("systemctl daemon-reload", calls.indexOf("controller status")));
  assert.deepEqual(tail.slice(-4), ["systemctl daemon-reload", "systemctl enable nusa.service nusa-research.timer", "systemctl restart nusa.service", "systemctl start nusa-research.timer"]);
});

test("--rollback refuses (changing nothing) without a manifest, after a managed file was altered, or when orders are not OFF", posixOnly, () => {
  const cases = [
    ["no manifest", (w) => fs.rmSync(path.join(w.R, "opt/nusa-control/INSTALL-MANIFEST")), /no install manifest/],
    ["a managed file was altered", (w) => fs.appendFileSync(path.join(w.R, "opt/nusa-control/nusa-control.js"), "//x"), /differs from the install manifest/],
    ["the mode file was altered", (w) => fs.writeFileSync(path.join(w.R, "etc/nusa/run-mode.env"), "NUSA_RUN_MODE=PAPER_ORDERS\n"), /differs from the install manifest/],
    ["manifest and a managed file were both altered", (w) => { fs.appendFileSync(path.join(w.R, "opt/nusa-control/nusa-control.js"), "//x"); fs.writeFileSync(path.join(w.R, "opt/nusa-control/INSTALL-MANIFEST"), "forged\n"); }, /does not match its anchor/],
    ["a managed file became a symlink", (w) => { const f = path.join(w.R, "opt/nusa-control/nusa-control.sh"); const c = fs.readFileSync(f); fs.rmSync(f); fs.writeFileSync(path.join(w.R, "real.sh"), c); fs.symlinkSync(path.join(w.R, "real.sh"), f); }, /missing, is a link, or has unsafe/],
    ["a managed file became group-writable", (w) => fs.chmodSync(path.join(w.R, "etc/systemd/system/nusa-control-verify.timer"), 0o664), /unsafe owner or mode/],
    ["systemd cannot answer at rollback time (fail closed)", (w) => fs.writeFileSync(path.join(w.R, "bin/systemctl"), "#!/usr/bin/env bash\n[ \"$1\" = show ] && exit 1\nexit 0\n", { mode: 0o755 }), /orders are not OFF/],
    ["the anchor file became group-readable", (w) => fs.chmodSync(path.join(w.R, "var/lib/nusa-control/install-manifest.sha256"), 0o644), /unsafe owner or mode/],
    ["the state directory became group-readable", (w) => fs.chmodSync(path.join(w.R, "var/lib/nusa-control"), 0o750), /unsafe owner or mode/],
    ["the mode file says something else but manifest was forged to match", (w) => { fs.writeFileSync(path.join(w.R, "etc/nusa/run-mode.env"), "NUSA_RUN_MODE=PAPER_ORDERS\n"); const m = path.join(w.R, "opt/nusa-control/INSTALL-MANIFEST"); const c = require("node:crypto"); const lines = fs.readFileSync(m, "utf8").split("\n").map((l) => l.endsWith("etc/nusa/run-mode.env") ? `${c.createHash("sha256").update("NUSA_RUN_MODE=PAPER_ORDERS\n").digest("hex")}  etc/nusa/run-mode.env` : l).join("\n"); fs.writeFileSync(m, lines); fs.writeFileSync(path.join(w.R, "var/lib/nusa-control/install-manifest.sha256"), `${c.createHash("sha256").update(lines).digest("hex")}\n`, { mode: 0o600 }); }, /orders are not OFF/],
    ["orders turned ON in the env file", (w) => fs.writeFileSync(path.join(w.R, "etc/nusa/cloud-runtime.env"), "NUSA_PAPER_ORDER_PATH=ON\n"), /orders are not OFF/],
  ];
  for (const [label, damage, expected] of cases) {
    const w = world(); assert.equal(w.run(w.hash, "--apply").status, 0);
    damage(w); const before = w.snapshot(); const mutating = () => w.calls().filter((c) => !/is-active|^systemctl show/.test(c)).length; const callsBefore = mutating();
    const r = w.run("--rollback");
    assert.notEqual(r.status, 0, label); assert.match(r.stderr, expected, label);
    assert.equal(w.snapshot(), before, `${label}: nothing changed`);
    assert.equal(mutating(), callsBefore, `${label}: systemd was not touched`);
  }
});

test("the script never writes the runtime environment file or any secret path, and uses no network except the local /health", () => {
  const text = fs.readFileSync(script, "utf8").replace(/\r\n/g, "\n");
  assert.doesNotMatch(text, />\s*"?\$R\/etc\/nusa\/cloud-runtime\.env|sed -i|tee [^\n]*cloud-runtime/);
  assert.doesNotMatch(text, /wget|git clone|https?:\/\/(?!127\.0\.0\.1)/);
  assert.match(text, /curl -fsS -m 6 http:\/\/127\.0\.0\.1:41731\/health/);
  assert.doesNotMatch(text, /PAPER_ORDERS/, "the installer never names an order mode");
});
