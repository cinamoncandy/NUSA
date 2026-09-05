"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const VALID_SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);
const TOKEN = "t".repeat(64);

const PAPER_UNIT = `[Unit]\nDescription=NUSA Cloud Paper Runtime\n[Service]\nUser=nusa\nGroup=nusa\nWorkingDirectory=/opt/nusa/current\nEnvironmentFile=/etc/nusa/cloud-runtime.env\nExecStart=/usr/bin/node /opt/nusa/current/scripts/start-cloud-runtime.js\nRestart=on-failure\nNoNewPrivileges=true\nProtectSystem=strict\nReadWritePaths=/var/lib/nusa /var/backups/nusa\n`;
const RESEARCH_UNIT = `[Unit]\nDescription=NUSA canonical Research\n[Service]\nType=oneshot\nUser=nusa\nGroup=nusa\nWorkingDirectory=/opt/nusa/current\nEnvironmentFile=/etc/nusa/cloud-runtime.env\nExecStart=/usr/bin/node /opt/nusa/current/scripts/run-cloud-research-snapshot.js\nNoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=strict\nProtectHome=true\nReadWritePaths=/var/lib/nusa /var/backups/nusa\n`;
const RESEARCH_TIMER = `[Unit]\nDescription=Schedule Research\n[Timer]\nOnBootSec=2min\nOnCalendar=*-*-* 09:15:00 Asia/Seoul\nPersistent=true\nRandomizedDelaySec=5min\nUnit=nusa-research.service\n[Install]\nWantedBy=timers.target\n`;

function write(root, absolute, contents) {
  const target = path.join(root, absolute.replace(/^\/+/, ""));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents, "utf8");
}

function fixture(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-oracle-validate-"));
  fs.mkdirSync(path.join(root, "var/backups/nusa"), { recursive: true });
  fs.mkdirSync(path.join(root, "var/lib/nusa"), { recursive: true });
  const values = {
    NUSA_CLOUD_DASHBOARD_PORT: "41731",
    NUSA_CLOUD_DASHBOARD_TOKEN: TOKEN,
    NUSA_CLOUD_DASHBOARD_HOST: "127.0.0.1",
    NUSA_CLOUD_STATE_DB_PATH: "/var/lib/nusa/state.sqlite",
    NUSA_SOURCE_COMMIT: VALID_SHA,
    ...overrides,
  };
  write(root, "/etc/nusa/cloud-runtime.env", Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n") + "\n");
  write(root, "/etc/systemd/system/nusa.service", PAPER_UNIT);
  write(root, "/etc/systemd/system/nusa-research.service", RESEARCH_UNIT);
  write(root, "/etc/systemd/system/nusa-research.timer", RESEARCH_TIMER);
  return root;
}

function validate(root) {
  return spawnSync(process.execPath, [path.join(__dirname, "oracle-validate.js")], {
    env: { ...process.env, NUSA_ORACLE_ROOT: root },
    encoding: "utf8",
  });
}

test("accepts a hardened Oracle PAPER + autonomous Research installation", () => {
  const root = fixture();
  const result = validate(root);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout.trim());
  assert.equal(output.status, "PASS");
  assert.equal(output.sourceCommit, VALID_SHA);
  assert.equal(output.snapshotPath, "/var/lib/nusa/research-replay-snapshots.json");
});

test("fails closed when the autonomous Research timer is missing", () => {
  const root = fixture();
  fs.rmSync(path.join(root, "etc/systemd/system/nusa-research.timer"));
  const result = validate(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing systemd unit/);
});

test("fails closed when deployed source identities disagree", () => {
  const root = fixture({ NUSA_SOURCE_COMMIT_SHA: OTHER_SHA });
  const result = validate(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /disagree/);
});

test("fails closed when Research snapshot storage escapes the hardened write path", () => {
  const root = fixture({ NUSA_RESEARCH_REPLAY_SNAPSHOT_PATH: "/tmp/research.json" });
  const result = validate(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Research replay snapshot must be inside \/var\/lib\/nusa/);
});
