"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const text = fs.readFileSync(".github/workflows/oracle-access-audit.yml", "utf8").replace(/\r\n/g, "\n");
const code = text.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
const posixOnly = process.platform === "win32" ? { skip: "bash filters" } : {};

// The filter functions are taken verbatim from the workflow, so the tests exercise the real code.
const run = text.slice(text.indexOf("        run: |\n") + "        run: |\n".length);
const filters = run.slice(run.indexOf("# --- filters begin"), run.indexOf("# --- filters end")).split("\n").map((l) => l.replace(/^ {10}/, "")).join("\n");
const bash = (script, input = "") => spawnSync("bash", ["-c", `${filters}\n${script}`], { input, encoding: "utf8" });

const SECRETS = ["AKIAABCD1234EFGH5678", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcDEF123_-xyz", "c2VjcmV0LXZhbHVlLWluLWJhc2U2NA==", "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08", "MyCredential123", "p@ssw0rd!", "sk-live-0123456789abcdef", "supersecretlowercasetokenvalue"];

test("the access audit is manual, read-only, checks out no code, takes no secrets and runs on the host runner only", () => {
  assert.match(code, /^on:\n  workflow_dispatch:\n/m);
  assert.doesNotMatch(code, /\bschedule:|\bpush:|\bpull_request/);
  assert.match(code, /permissions:\n  contents: read\n/);
  assert.doesNotMatch(code, /actions\/checkout|secrets\.|GITHUB_TOKEN|curl |wget |gh api/);
  assert.match(code, /runs-on: \[self-hosted, Linux, nusa-paper-host\]/);
});

test("the audit never changes state: no systemctl mutation, no write command, no redirect into system paths, and sudo only as `sudo -n -l`", () => {
  assert.doesNotMatch(code, /systemctl\s+(start|stop|restart|enable|disable|daemon-reload|mask|reload|kill|reset-failed)\b/);
  assert.doesNotMatch(code, /(?:^|[|;&(]\s*)\s*(rm|mv|cp|chmod|chown|tee|truncate|useradd|usermod|passwd|install|ln)\s/m, "no write command in command position");
  assert.doesNotMatch(code, />>?\s*\/(etc|opt|var|home|root|usr)\b/, "no redirection into system paths");
  const sudo = [...code.matchAll(/(?:^|[|;&(]\s*|=")\s*sudo\b[^\n]*/gm)].map((m) => m[0].trim()).filter((l) => /^(\$\(|=")?sudo\s/.test(l.replace(/^[|;&(]\s*/, "")));
  for (const line of sudo) assert.match(line, /sudo -n -l\b/, `only the rule listing may use sudo: ${line}`);
});

test("the audit prints metadata only: it never reads env, key, token or credential file contents", () => {
  assert.doesNotMatch(code, /\bcat\s+[^|\n]*(\.env|authorized_keys|id_rsa|id_ed25519|cloud-runtime|\.token|credentials)/i);
  assert.doesNotMatch(code, /\b(head|tail|less|more)\s+[^|\n]*(cloud-runtime\.env|id_rsa|id_ed25519|authorized_keys)/i);
  assert.match(code, /stat -c '%U:%G %a %n' "\$home\/\.ssh" "\$home\/\.ssh\/authorized_keys"/);
  assert.match(code, /grep -cE '\^\(ssh\|ecdsa\|sk-\)'/, "authorized_keys is only counted");
  assert.doesNotMatch(code, /grep -(h|o)?E?[^-\n]*authorized_keys[^|\n]*\|\s*(head|cat|sort)/);
  assert.doesNotMatch(code, /-p Environment\b(?!Files)/, "systemctl show never prints Environment values");
});

test("safe_tokens prints only harmless shapes: verbs, wildcards, safe absolute paths, options and unit names; every synthetic secret becomes <arg>", posixOnly, () => {
  const r = bash(`printf '%s\\n' "restart nusa.service * /opt/nusa/bin/nusa-release-step --status ${SECRETS.join(" ")}" | safe_tokens`);
  assert.equal(r.status, 0, r.stderr);
  for (const s of SECRETS.filter((x) => !/^[a-z]+$/.test(x))) assert.ok(!r.stdout.includes(s), `leaked ${s}`);
  assert.match(r.stdout, /^restart nusa\.service \* \/opt\/nusa\/bin\/nusa-release-step --status /);
  assert.equal((r.stdout.match(/<arg>/g) || []).length, SECRETS.length - 1 + 1 - 0, "every secret-like token is replaced (the long lowercase one too, being over 24 characters)");
});

test("sudo_rules keeps the rule structure and filters every command token", posixOnly, () => {
  const input = [
    "User runner may run the following commands on host:",
    "    (root) NOPASSWD: /opt/nusa/bin/nusa-release-step *, /usr/bin/systemctl restart nusa.service",
    "    (root) NOPASSWD: /usr/bin/deploy --token=AKIAABCD1234EFGH5678 MyCredential123",
  ].join("\n");
  const r = bash("sudo_rules", input);
  assert.match(r.stdout, /\(root\) NOPASSWD: \/opt\/nusa\/bin\/nusa-release-step \*/);
  assert.match(r.stdout, /systemctl restart nusa\.service/);
  assert.ok(!/AKIA|MyCredential/.test(r.stdout), r.stdout);
});

test("sudo_journal reduces COMMAND lines to user, executable and filtered words: arguments with secrets never appear", posixOnly, () => {
  const input = [
    "sentinelx : TTY=pts/0 ; PWD=/home/x ; USER=root ; COMMAND=/usr/bin/systemctl stop nusa.service",
    "runner : TTY=unknown ; PWD=/x ; USER=root ; COMMAND=/usr/bin/curl -H Authorization:Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcDEF123_-xyz https://x.example/?key=sk-live-0123456789abcdef",
  ].join("\n");
  const r = bash("sudo_journal", input);
  assert.match(r.stdout, /^root \/usr\/bin\/systemctl stop nusa\.service$/m);
  assert.ok(!/eyJ|sk-live|Authorization/.test(r.stdout), r.stdout);
});

test("unit_allowlist prints allowlisted directives, Environment variable NAMES only, and the ExecStart executable without arguments", posixOnly, () => {
  const input = [
    "[Service]", "Type=simple", "User=nusa", "Restart=on-failure",
    'Environment="API_KEY=supersecretlowercasetokenvalue" HOME=/var/lib/nusa "MyCredential=MyCredential123"',
    "Environment=NUSA_REQUIRE_RUN_MODE=1",
    "EnvironmentFile=/etc/nusa/run-mode.env",
    "ExecStart=/usr/bin/env -u NODE_OPTIONS /usr/bin/node /opt/nusa/current/scripts/start.js --token sk-live-0123456789abcdef",
    "SomethingElse=eyJhbGciOiJIUzI1NiJ9.abc", "ExecStartPre=-/bin/sh -c 'echo p@ssw0rd!'",
  ].join("\n");
  const r = bash("unit_allowlist", input);
  assert.match(r.stdout, /Type=simple/); assert.match(r.stdout, /EnvironmentFile=\/etc\/nusa\/run-mode\.env/);
  assert.match(r.stdout, /Environment\(names only\): API_KEY HOME MyCredential/);
  assert.match(r.stdout, /Environment\(names only\): NUSA_REQUIRE_RUN_MODE/);
  assert.match(r.stdout, /ExecStart=\/usr\/bin\/env <args hidden>/);
  for (const s of ["supersecret", "MyCredential123", "sk-live", "eyJ", "p@ssw0rd", "SomethingElse"]) assert.ok(!r.stdout.includes(s), `leaked ${s}: ${r.stdout}`);
});

test("check() labels every outcome: OBSERVED, OBSERVED-EMPTY, DENIED, NOT_CHECKED, ERROR and TRUNCATED are never reported as OBSERVED", posixOnly, () => {
  const out = (cmd) => bash(cmd).stdout;
  assert.match(out('check "a" 5 printf "x\\ny\\n"'), /^\[OBSERVED\] a\nx\ny\n/);
  assert.match(out('check "b" 5 bash -c ":"'), /^\[OBSERVED-EMPTY\] b/);
  assert.match(out('check "c" 5 bash -c "echo Permission denied >&2; exit 1"'), /^\[DENIED\] c$/m);
  assert.match(out('check "d" 5 nusa-no-such-tool-xyz'), /^\[NOT_CHECKED\] d/);
  assert.match(out('check "e" 5 bash -c "echo boom >&2; exit 3"'), /^\[ERROR\] e \(exit 3\): boom/m);
  const t = out('check "f" 2 printf "1\\n2\\n3\\n4\\n"');
  assert.match(t, /\[TRUNCATED\] f \(4 lines, first 2 shown\)/); assert.ok(!/^3$/m.test(t), "the cut lines are not shown");
  assert.doesNotMatch(out('check "g" 5 bash -c "echo SECRET1234abcdXYZ >&2; exit 2"'), /SECRET1234abcdXYZ/, "error text is filtered too");
});

test("the audit covers every start path of the design and states what it cannot check", () => {
  for (const needle of ["/etc/passwd", "sudo -n -l", "sshd_config", "authorized_keys", "list-timers", "list-unit-files", "/etc/cron.d", "atq", "linger", "systemd/user", "actions.runner", ".runner", "polkit-1", "systemctl cat", "UnsetEnvironment", "EnvironmentFiles", "getfacl", "namei", "readlink -f", "/opt/nusa-control", "/etc/systemd/system", "_COMM=sudo", "nusa-control-reconcile.service"]) assert.ok(code.includes(needle), needle);
  assert.match(code, /\[NOT_CHECKED\] effective sshd -T/);
  assert.match(code, /DENIED/);
});
