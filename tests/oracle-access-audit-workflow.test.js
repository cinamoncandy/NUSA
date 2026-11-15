"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const text = fs.readFileSync(".github/workflows/oracle-access-audit.yml", "utf8").replace(/\r\n/g, "\n");
const code = text.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

// The embedded audit script is taken verbatim from the workflow and loaded as a module with injected effects.
const start = text.indexOf("node - <<'AUDIT_JS'\n") + "node - <<'AUDIT_JS'\n".length;
const end = text.indexOf("\n          AUDIT_JS");
const script = text.slice(start, end).split("\n").map((l) => l.replace(/^ {10}/, "")).join("\n");
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nusa-audit-")), "audit.js");
fs.writeFileSync(file, script);
process.env.NUSA_AUDIT_TEST = "1";
require(file);
const { audit, V } = globalThis.__audit;

const SECRETS = ["AKIAABCD1234EFGH5678", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcDEF123_-xyz", "c2VjcmV0LXZhbHVlLWluLWJhc2U2NA==", "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08", "MyCredential123", "p@ssw0rd!", "sk-live-0123456789abcdef", "supersecret", "hunter2password", "tokenvalueabc"];

function fakeWorld({ commands = {}, files = {}, dirs = {}, stats = {} } = {}) {
  const exec = (cmd, args) => { const key = `${cmd} ${args.join(" ")}`; for (const [pat, res] of Object.entries(commands)) if (key.includes(pat)) return typeof res === "function" ? res(key) : res; return { status: 127, stdout: "", stderr: "", error: Object.assign(new Error("ENOENT"), { code: "ENOENT" }) }; };
  const fail = (code) => { throw Object.assign(new Error(code), { code }); };
  return { exec, now: () => "T", readFile: (p) => (p in files ? files[p] : fail("ENOENT")), readdir: (p) => (p in dirs ? dirs[p] : fail("ENOENT")), stat: (p) => (p in stats ? stats[p] : fail("ENOENT")) };
}
const ok = (stdout) => ({ status: 0, stdout, stderr: "" });
const leaks = (lines) => SECRETS.filter((s) => lines.join("\n").includes(s));

test("the access audit is manual, read-only, checks out no code, takes no secrets and runs on the host runner only", () => {
  assert.match(code, /^on:\n  workflow_dispatch:\n/m);
  assert.doesNotMatch(code, /\bschedule:|\bpush:|\bpull_request/);
  assert.match(code, /permissions:\n  contents: read\n/);
  assert.doesNotMatch(code, /actions\/checkout|secrets\.|GITHUB_TOKEN|curl |wget |gh api/);
  assert.match(code, /runs-on: \[self-hosted, Linux, nusa-paper-host\]/);
});

test("the audit script only ever executes read-only commands: systemctl list-*/show, a fixed set of query tools, and sudo only as `sudo -n -l`", () => {
  const calls = [...script.matchAll(/\b(?:run|exec)\("([a-z0-9-]+)",\s*\[([^\]]*)\]/g)].map((m) => ({ cmd: m[1], args: m[2] }));
  assert.ok(calls.length >= 12);
  const allowedCmds = new Set(["getent", "sudo", "systemctl", "atq", "find", "getfacl", "sha256sum", "journalctl"]);
  for (const c of calls) assert.ok(allowedCmds.has(c.cmd), `command ${c.cmd}`);
  for (const c of calls.filter((x) => x.cmd === "systemctl")) assert.match(c.args, /^"(list-timers|list-unit-files|list-units|show)"/, `systemctl ${c.args}`);
  for (const c of calls.filter((x) => x.cmd === "sudo")) assert.equal(c.args.replace(/\s/g, ""), '"-n","-l"');
  assert.doesNotMatch(script, /"-delete"|"-exec"|"-execdir"|"-fprint|"-ok"/, "find never deletes or executes");
  assert.doesNotMatch(script, /writeFile|appendFile|unlink|rename|mkdir|chmod|chown|rmSync/, "the script never writes to the filesystem");
  assert.doesNotMatch(script, /execSync|\bshell:\s*true|child_process"\)\.exec\b/, "no shell is ever involved");
});

test("validators print only expected shapes and turn everything else into <type:hash8>", () => {
  V.KNOWN.add("nusa");
  assert.equal(V.user("nusa"), "nusa");
  assert.match(V.user("sentinelx"), /^<user:/, "a well-shaped name that is not an account of this host is hashed");
  for (const s of SECRETS.filter((x) => /[^a-z0-9_-]/.test(x))) assert.match(V.user(s), /^<user:[0-9a-f]{8}>$/, s);
  assert.equal(V.unit("nusa.service"), "nusa.service");
  assert.match(V.unit("actions.runner.owner-repo.host.service"), /^actions\.runner\.<runner:[0-9a-f]{8}>\.service$/, "runner names are hashed, never printed");
  for (const s of SECRETS) assert.match(V.unit(`${s}.service`), /^<unit:[0-9a-f]{8}>$/);
  assert.equal(V.path("/opt/nusa/bin/nusa-release-step"), "/opt/nusa/bin/nusa-release-step");
  assert.equal(V.path("/opt/nusa/releases/" + "a".repeat(40)), "/opt/nusa/releases/" + "a".repeat(40));
  for (const s of ["/home/supersecret", "/etc/nusa/tokenvalueabc", "/opt/nusa/" + SECRETS[0], "/var/lib/" + SECRETS[4]]) assert.match(V.path(s), /^<path:[0-9a-f]{8}>$/, s);
  assert.equal(V.word("restart"), "restart"); assert.equal(V.word("*"), "*");
  for (const s of [...SECRETS, "token", "password"]) assert.match(V.word(s), /^<arg:[0-9a-f]{8}>$/, s);
  assert.match(V.exe("/usr/bin/curl"), /^<exe:/); assert.equal(V.exe("/usr/bin/systemctl"), "/usr/bin/systemctl");
  assert.equal(V.mode("0640"), "0640"); assert.match(V.mode("rwx"), /^<mode:/);
  assert.match(V.enum("secret", ["yes", "no"]), /^<enum:/);
});

test("synthetic secrets in EVERY input channel (sudo rules, sudo journal, unit properties, file names, passwd, sshd, find, getfacl) never reach the output", () => {
  const S = SECRETS;
  const w = fakeWorld({
    files: {
      "/etc/passwd": `root:x:0:0::/root:/bin/bash\n${S[4]}:x:1001:1001::/home/x:/bin/bash\nsvc:x:1002:1002::/home/svc:/bin/${S[7]}\n`,
      "/etc/ssh/sshd_config": `PermitRootLogin ${S[7]}\nPasswordAuthentication no\nAllowUsers alice ${S[0]} ${S[1]}\n`,
      "/home/x/.ssh/authorized_keys": `ssh-ed25519 ${S[2]} comment-${S[3]}\n`,
    },
    dirs: { "/etc/sudoers.d": [S[5], "README"], "/etc/cron.d": [S[6], "nusa-health"], "/home": [S[4], "claude"], "/etc/polkit-1/rules.d": [S[3]], "/usr/share/polkit-1/rules.d": [], "/etc/ssh/sshd_config.d": [`${S[9]}.conf`], "/var/lib/systemd/linger": [S[8]] },
    stats: { "/home/claude/.ssh": { owner: "claude", mode: "700", type: "dir" }, "/etc/sudoers.d/README": { owner: S[8], mode: "440", type: "file" }, "/opt/nusa": { owner: S[7], mode: "755", type: "dir" } },
    commands: {
      "sudo -n -l": ok(`User runner may run the following commands on h:\n    (root) NOPASSWD: /usr/bin/systemctl restart nusa.service, /opt/x/${S[0]} --token=${S[1]} ${S[2]}\n    (${S[7]}) NOPASSWD: ${S[3]}\n`),
      "getent group": ok(`sudo:x:27:alice,${S[1]}\nwheel:x:10:\n`),
      "list-timers": ok(`n/a n/a ${S[4]}.timer ${S[5]}.service\nn/a n/a nusa-health-guard.timer nusa-health-guard.service\n`),
      "list-unit-files": ok(`nusa.service enabled\n${S[8]}-nusa.service enabled enabled\n`),
      "list-units --all --no-pager --no-legend actions.runner*": ok(`● actions.runner.o-r.${S[4]}.service loaded active\n`),
      "show nusa.service": ok(`FragmentPath=/etc/systemd/system/nusa.service\nDropInPaths=/etc/systemd/system/nusa.service.d/20-run-mode.conf /etc/systemd/system/nusa.service.d/${S[7]}.conf\nEnvironmentFiles=/etc/nusa/${S[3]} (ignore_errors=no)\nUnsetEnvironment=NUSA_PAPER_ORDER_PATH ${S[4]}\nRequires=${S[9]}.service nusa-control-reconcile.service\nRestart=${S[7]}\nStartLimitBurst=${S[2]}\nUser=${S[5]}\nUnitFileState=${S[6]}\nActiveState=active\n`),
      "find /opt /home /srv": ok(`/opt/actions-runner/.runner\n/home/${S[8]}/runner/.runner\n`),
      "find /etc/systemd/system": ok(`root:root 644 /etc/systemd/system/nusa.service\n${S[7]}:${S[8]} 777 /etc/systemd/system/nusa-${S[0]}.service\n`),
      "getfacl": ok(`# file: /opt/nusa\nuser:${S[4]}:rwx\ngroup::r-x\n# file: /etc/nusa\nuser:${S[7]}:r--\n`),
      "sha256sum": ok(`${"ab".repeat(32)}  /opt/nusa/bin/nusa-release-step\n`),
      "journalctl": ok(`sudo: ${S[4]} : TTY=pts/0 ; PWD=/x ; USER=root ; COMMAND=/usr/bin/curl -H Authorization:Bearer ${S[1]} https://x/?k=${S[6]}\nsudo: sentinelx : TTY=x ; PWD=/x ; USER=root ; COMMAND=/usr/bin/systemctl stop nusa.service ${S[0]}\n`),
    },
  });
  const lines = audit(w);
  assert.deepEqual(leaks(lines), [], `no synthetic secret may appear:\n${lines.join("\n")}`);
  const outText = lines.join("\n");
  assert.match(outText, /sudo_use user=<user:[0-9a-f]{8}> as=root exe=<exe:[0-9a-f]{8}>/, "an unexpected invoking user and an unexpected executable are visible only as hashes");
  assert.match(outText, /sudo_use user=<user:[0-9a-f]{8}> as=root exe=\/usr\/bin\/systemctl args=stop,nusa\.service,<arg:[0-9a-f]{8}>/, "known verbs stay readable, the rest is hashed");
  assert.match(outText, /unit_unset unit=nusa\.service name=NUSA_PAPER_ORDER_PATH/);
  assert.match(outText, new RegExp(`helper_sha256 value=${"ab".repeat(32)}`), "the sha256 of the (public) helper file is a hash, not a secret, and is printed");
});

test("every outcome gets a state: OBSERVED, OBSERVED-EMPTY, DENIED, NOT_CHECKED, ERROR; never a bare success for something unread", () => {
  const w = fakeWorld({
    files: { "/etc/passwd": "root:x:0:0::/root:/bin/bash\n" },
    commands: {
      "getent group": { status: 2, stdout: "", stderr: "boom" },
      "sudo -n -l": { status: 1, stdout: "", stderr: "sudo: a password is required" },
      "list-timers": { status: 1, stdout: "", stderr: "Failed to connect to bus: Permission denied" },
      "list-unit-files": ok(""),
      "atq": { status: 127, stdout: "", stderr: "", error: Object.assign(new Error("x"), { code: "ENOENT" }) },
      "sha256sum": { status: 1, stdout: "", stderr: "sha256sum: /opt/nusa/bin/nusa-release-step: No such file or directory" },
    },
  });
  const outText = audit(w).join("\n");
  assert.match(outText, /check name=accounts state=OBSERVED/);
  assert.match(outText, /check name=admin_groups state=ERROR/);
  assert.match(outText, /check name=runner_sudo_rules state=DENIED/);
  assert.match(outText, /check name=timers state=DENIED/);
  assert.match(outText, /check name=enabled_unit_files state=OBSERVED-EMPTY/);
  assert.match(outText, /check name=at_queue state=NOT_CHECKED/);
  assert.match(outText, /check name=helper_hash state=OBSERVED-EMPTY/, "an absent file is absence, not a denial");
  assert.match(outText, /check name=sshd_effective_T state=NOT_CHECKED/);
  assert.match(outText, /check name=sshd_config state=DENIED/, "an unreadable config is DENIED, never reported as safe");
  assert.doesNotMatch(outText, /boom|a password is required|Permission denied/, "error text is never echoed");
});

test("long lists are cut and say so", () => {
  const many = Array.from({ length: 100 }, (_, i) => `nusa-x${i}.timer`);
  const w = fakeWorld({ commands: { "list-timers": ok(many.map((u) => `n/a n/a ${u} y`).join("\n")) } });
  const lines = audit(w);
  assert.ok(lines.some((l) => /^truncated check=timers total=100 shown=60$/.test(l)));
  assert.equal(lines.filter((l) => l.startsWith("timer ")).length, 60);
});

test("the audit covers every start path of the design and states what it cannot check", () => {
  for (const needle of ["/etc/passwd", "sudo", "sshd_config", "authorized_keys", "list-timers", "list-unit-files", "/etc/cron.d", "atq", "linger", "actions.runner", ".runner", "polkit-1", "UnsetEnvironment", "EnvironmentFiles", "DropInPaths", "getfacl", "/opt/nusa-control", "/etc/systemd/system", "_COMM=sudo", "nusa-control-reconcile.service", "needs_root_C3b"]) assert.ok(script.includes(needle), needle);
});
