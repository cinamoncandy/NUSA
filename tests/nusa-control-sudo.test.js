"use strict";
// The runner's sudo audit (read-only) and the sudoers hand-over (adds exactly one file) of deploy/control, run against a temporary
// tree with stub visudo, id, sudo and systemctl.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const audit = path.join(root, "deploy/control/sudo-audit.sh");
const handover = path.join(root, "deploy/control/sudo-handover.sh");
const posixOnly = process.platform === "win32" ? { skip: "bash scripts" } : {};
const CTL = "/opt/nusa-control/nusa-control.sh";

function world(opts = {}) {
  const R = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-sudo-"));
  const mk = (p, mode = 0o755) => { fs.mkdirSync(path.join(R, p), { recursive: true }); fs.chmodSync(path.join(R, p), mode); };
  for (const d of ["etc", "etc/sudoers.d", "opt/nusa-control", "opt/nusa/bin"]) mk(d);
  fs.writeFileSync(path.join(R, "etc/sudoers"), opts.sudoers ?? "Defaults env_reset\n@includedir /etc/sudoers.d\n", { mode: 0o440 });
  fs.writeFileSync(path.join(R, "opt/nusa-control/nusa-control.sh"), "#!/bin/sh\n", { mode: opts.ctlMode ?? 0o755 });
  fs.chmodSync(path.join(R, "opt/nusa-control/nusa-control.sh"), opts.ctlMode ?? 0o755);
  fs.writeFileSync(path.join(R, "opt/nusa/bin/nusa-release-step"), "#!/bin/sh\n", { mode: 0o755 });
  if (opts.extraSudoers) fs.writeFileSync(path.join(R, "etc/sudoers.d/10-runner"), opts.extraSudoers, { mode: 0o440 });
  const bin = path.join(R, "bin"); fs.mkdirSync(bin);
  const log = path.join(R, "calls.log");
  const stub = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\necho "${name} $*" >> ${JSON.stringify(log)}\n${body}\n`, { mode: 0o755 });
  stub("visudo", opts.visudoFail ? "exit 1" : "exit 0");
  stub("id", `case "$1" in -u) [ "$2" = ghost ] && exit 1; echo 1001;; -nG) echo "${opts.groups || "runner"}";; *) echo "uid=1001(runner) gid=1001(runner) groups=${opts.groups || "runner"}";; esac`);
  stub("sudo", `echo "User runner may run the following commands:"; printf '%s\\n' ${JSON.stringify(opts.sudoL || "    (root) NOPASSWD: /opt/nusa/bin/nusa-release-step stage *")}`);
  stub("systemctl", "exit 0");
  const env = (extra = {}) => ({ ...process.env, NUSA_AUDIT_ROOT: R, NUSA_AUDIT_TEST_MODE: "yes-this-is-a-test-tree", NUSA_HANDOVER_ROOT: R, NUSA_HANDOVER_TEST_MODE: "yes-this-is-a-test-tree", PATH: `${bin}:${process.env.PATH}`, ...extra });
  const snapshot = () => { const out = []; const walk = (d) => { for (const n of fs.readdirSync(d).sort()) { const p = path.join(d, n); if (p === log || p.startsWith(bin)) continue; const st = fs.lstatSync(p); out.push(`${p}:${st.mode}:${st.isFile() ? fs.readFileSync(p, "utf8") : ""}`); if (st.isDirectory()) walk(p); } }; walk(R); return out.join("\n"); };
  return { R, run: (script, ...args) => spawnSync("bash", [script, ...args], { encoding: "utf8", env: env() }), calls: () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : []), snapshot, file: path.join(R, "etc/sudoers.d/90-nusa-control") };
}

test("the audit is read-only, prints the account, its groups, what sudo allows, and the sudoers files without comments", posixOnly, () => {
  const w = world({ extraSudoers: "# runner\nrunner ALL=(root) NOPASSWD: /opt/nusa/bin/nusa-release-step stage *\n" }); const before = w.snapshot();
  const r = w.run(audit, "runner");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /== account runner/); assert.match(r.stdout, /what sudo says/);
  assert.match(r.stdout, /nusa-release-step stage \*/); assert.doesNotMatch(r.stdout, /# runner/, "comments are not printed");
  assert.match(r.stdout, /a wildcard in an allowed command/, "a wildcard is flagged");
  assert.equal(w.snapshot(), before, "nothing was changed");
  assert.ok(!w.calls().some((c) => /^(visudo|systemctl (start|stop|restart|enable|disable))/.test(c)));
});

test("the audit warns about a dangerous group, an ALL rule, a loose sudoers file and a writable controller", posixOnly, () => {
  const w = world({ groups: "runner sudo docker", sudoL: "    (ALL) NOPASSWD: ALL", ctlMode: 0o777, extraSudoers: "runner ALL=(ALL) NOPASSWD: ALL\n" });
  fs.chmodSync(path.join(w.R, "etc/sudoers.d/10-runner"), 0o666);
  const r = w.run(audit, "runner");
  assert.equal(r.status, 0);
  for (const re of [/in group 'sudo'/, /in group 'docker'/, /may run ANY command as root/, /sudoers files should be 0440/, /nusa-control\.sh is writable by group or others/]) assert.match(r.stdout, re);
});

test("the audit refuses a bad or unknown account and a test root that looks like the real host", posixOnly, () => {
  const w = world();
  assert.notEqual(w.run(audit, "Bad User").status, 0);
  assert.notEqual(w.run(audit, "ghost").status, 0);
  const r = spawnSync("bash", [audit, "runner"], { encoding: "utf8", env: { ...process.env, NUSA_AUDIT_ROOT: w.R, PATH: `${path.join(w.R, "bin")}:${process.env.PATH}` } });
  assert.notEqual(r.status, 0); assert.match(r.stderr, /for tests only/);
});

test("hand-over preflight prints the exact rule, checks it with visudo and changes nothing", posixOnly, () => {
  const w = world(); const before = w.snapshot();
  const r = w.run(handover, "runner");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const hex = "[0-9a-f]".repeat(40);
  assert.ok(r.stdout.includes(`Cmnd_Alias NUSA_CONTROL = ${CTL} status, ${CTL} stop, ${CTL} collect, ${CTL} release ${hex}`));
  assert.match(r.stdout, /runner ALL=\(root\) NOPASSWD: NUSA_CONTROL/);
  assert.doesNotMatch(r.stdout.split("== result")[0].split("\n").filter((l) => l.startsWith("Cmnd_Alias") || l.includes("NOPASSWD")).join("\n"), /\*/, "no wildcard anywhere in the rule");
  assert.equal(w.snapshot(), before, "preflight writes nothing into the tree");
  assert.ok(w.calls().some((c) => c.startsWith("visudo -cf")));
});

test("hand-over --apply writes one 0440 file after visudo accepts it, is idempotent, and never touches other sudoers files", posixOnly, () => {
  const w = world({ extraSudoers: "runner ALL=(root) NOPASSWD: /opt/nusa/bin/nusa-release-step stage *\n" });
  const other = fs.readFileSync(path.join(w.R, "etc/sudoers.d/10-runner"), "utf8"); const main = fs.readFileSync(path.join(w.R, "etc/sudoers"), "utf8");
  const r = w.run(handover, "runner", "--apply");
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /DONE  installed/);
  assert.equal((fs.statSync(w.file).mode & 0o777).toString(8), "440");
  assert.match(fs.readFileSync(w.file, "utf8"), /NOPASSWD: NUSA_CONTROL/);
  assert.equal(fs.readFileSync(path.join(w.R, "etc/sudoers.d/10-runner"), "utf8"), other, "the existing runner rule is untouched");
  assert.equal(fs.readFileSync(path.join(w.R, "etc/sudoers"), "utf8"), main);
  assert.deepEqual(fs.readdirSync(path.join(w.R, "etc/sudoers.d")).sort(), ["10-runner", "90-nusa-control"], "no temp file is left");
  const again = w.run(handover, "runner", "--apply");
  assert.equal(again.status, 0); assert.match(again.stdout, /already installed, identical/);
});

test("hand-over refuses and writes nothing for every unsafe case", posixOnly, () => {
  const cases = [
    ["visudo rejects the rule", { visudoFail: true }, ["runner"], /FAIL  visudo accepts the rule/],
    ["the controller entry point is group/other writable", { ctlMode: 0o777 }, ["runner"], /FAIL  the controller entry point/],
    ["sudoers does not include sudoers.d", { sudoers: "Defaults env_reset\n" }, ["runner"], /FAIL  sudoers includes the directory/],
  ];
  for (const [label, o, args, re] of cases) {
    const w = world(o); const before = w.snapshot();
    const r = w.run(handover, ...args, "--apply");
    assert.notEqual(r.status, 0, label); assert.match(r.stdout, re, label);
    assert.equal(w.snapshot(), before, `${label}: nothing written`);
  }
  const w = world();
  for (const bad of ["root", "Bad User", "ghost", ""]) assert.notEqual(w.run(handover, bad, "--apply").status, 0, `account '${bad}'`);
  fs.writeFileSync(w.file, "something else\n", { mode: 0o440 });
  const r = w.run(handover, "runner", "--apply");
  assert.notEqual(r.status, 0); assert.equal(fs.readFileSync(w.file, "utf8"), "something else\n", "an existing different file is never overwritten");
});

test("hand-over --remove deletes only its own file and checks the whole configuration", posixOnly, () => {
  const w = world({ extraSudoers: "runner ALL=(root) NOPASSWD: /bin/true\n" });
  assert.notEqual(w.run(handover, "runner", "--remove").status, 0, "nothing to remove");
  assert.equal(w.run(handover, "runner", "--apply").status, 0);
  const r = w.run(handover, "runner", "--remove");
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.ok(!fs.existsSync(w.file));
  assert.ok(fs.existsSync(path.join(w.R, "etc/sudoers.d/10-runner")));
  assert.ok(w.calls().includes("visudo -c"));
});

test("neither script ever writes outside the sudoers file it owns, restarts a unit, or reaches the network", () => {
  for (const f of [audit, handover]) {
    const src = fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n");
    assert.doesNotMatch(src, /systemctl\s+(start|stop|restart|enable|disable|daemon-reload)/);
    assert.doesNotMatch(src, /\b(curl|wget|nc|ssh)\b/);
    assert.doesNotMatch(src, /NUSA_PAPER_ORDER_PATH/);
  }
  const code = fs.readFileSync(audit, "utf8").replace(/\r\n/g, "\n").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  assert.doesNotMatch(code, /\b(rm|mv|cp|chmod|chown|install|tee|mktemp)\s/, "the audit has no write command");
  const targets = [...code.matchAll(/\d?>>?\s*([^\s&|;)]+)/g)].map((m) => m[1]).filter((x) => !x.startsWith("&"));
  assert.ok(targets.every((x) => x === "/dev/null"), `the audit redirects output only to /dev/null, found: ${targets.filter((x) => x !== "/dev/null")}`);
});
