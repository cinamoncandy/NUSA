"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const text = fs.readFileSync(".github/workflows/oracle-access-audit.yml", "utf8").replace(/\r\n/g, "\n");
const code = text.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

test("the access audit is manual, read-only, checks out no code, takes no secrets and runs on the host runner only", () => {
  assert.match(code, /^on:\n  workflow_dispatch:\n/m);
  assert.doesNotMatch(code, /\bschedule:|\bpush:|\bpull_request/);
  assert.match(code, /permissions:\n  contents: read\n/);
  assert.doesNotMatch(code, /actions\/checkout|secrets\.|GITHUB_TOKEN|curl |wget |gh api/);
  assert.match(code, /runs-on: \[self-hosted, Linux, nusa-paper-host\]/);
});

test("the audit never changes state: no systemctl mutation, no write, and sudo only as `sudo -n -l`", () => {
  assert.doesNotMatch(code, /systemctl\s+(start|stop|restart|enable|disable|daemon-reload|mask|reload|kill|reset-failed)\b/);
  assert.doesNotMatch(code, /(?:^|[|;&(]\s*)\s*(rm|mv|cp|chmod|chown|tee|truncate|useradd|usermod|passwd|install|ln)\s/m, "no write command in command position");
  assert.doesNotMatch(code, />>?\s*\/(etc|opt|var|home|root|usr)\b/, "no redirection into system paths");
  // Only sudo used AS A COMMAND counts (start of a line or after | ; & ( ), not the word inside an echo label.
  const sudo = [...code.matchAll(/(?:^|[|;&(]\s*)\s*sudo\b[^\n]*/gm)].map((m) => m[0].trim());
  assert.ok(sudo.length >= 1);
  for (const line of sudo) assert.match(line, /sudo -n -l\b/, `only the rule listing may use sudo: ${line}`);
});

test("the audit prints metadata only: it never reads env, key, token or credential file contents", () => {
  assert.doesNotMatch(code, /\bcat\s+[^|\n]*(\.env|authorized_keys|id_rsa|id_ed25519|cloud-runtime|\.token|credentials)/i);
  assert.doesNotMatch(code, /\b(head|tail|less|more|grep|awk|sed)\s+[^|\n]*(cloud-runtime\.env|id_rsa|id_ed25519)/i);
  // authorized_keys is only stat-ed and counted (grep -c prints a number, never the key text)
  assert.match(code, /stat -c '%U:%G %a %n' "\$home\/\.ssh" "\$home\/\.ssh\/authorized_keys"/);
  assert.match(code, /grep -cE/);
  assert.doesNotMatch(code, /grep -(h|o)?E?[^-\n]*authorized_keys/, "no grep prints key lines");
  assert.match(code, /DENIED/, "unreadable items are reported as DENIED, never as safe");
});

test("the audit covers every start path named in the design: accounts, sudo, ssh, timers, cron, at, linger, runners, polkit, unit drop-ins, unit file ownership, the sudo journal", () => {
  for (const needle of ["/etc/passwd", "sudo -n -l", "sshd_config", "authorized_keys", "list-timers", "/etc/cron.d", "atq", "linger", "actions.runner", "polkit-1", "systemctl cat", "UnsetEnvironment", "EnvironmentFiles", "/opt/nusa-control", "/etc/systemd/system", "COMMAND="]) assert.ok(code.includes(needle), needle);
});
