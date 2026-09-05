"use strict";
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(process.env.NUSA_ORACLE_ROOT || "/");
const rooted = (absolute) => path.join(root, absolute.replace(/^\/+/, ""));
const envPath = rooted("/etc/nusa/cloud-runtime.env");
const backupPath = rooted("/var/backups/nusa");
const servicePath = rooted("/etc/systemd/system/nusa.service");
const researchServicePath = rooted("/etc/systemd/system/nusa-research.service");
const researchTimerPath = rooted("/etc/systemd/system/nusa-research.timer");
const currentPath = rooted("/opt/nusa/current");
const fail = (message) => { throw new Error(message); };
const sha40 = /^[a-f0-9]{40}$/;

if (!fs.existsSync(envPath)) fail(`missing environment file: ${envPath}`);
const env = fs.readFileSync(envPath, "utf8");
const values = Object.fromEntries(env.split(/\r?\n/).filter(Boolean).map((line) => {
  const index = line.indexOf("=");
  return index < 1 ? [line, ""] : [line.slice(0, index), line.slice(index + 1)];
}));
for (const key of ["NUSA_CLOUD_DASHBOARD_PORT", "NUSA_CLOUD_DASHBOARD_TOKEN", "NUSA_CLOUD_STATE_DB_PATH"]) {
  if (!values[key]) fail(`missing ${key}`);
}
if (Buffer.byteLength(values.NUSA_CLOUD_DASHBOARD_TOKEN, "utf8") < 32) fail("dashboard token must be at least 32 bytes");
const host = values.NUSA_CLOUD_DASHBOARD_HOST || "127.0.0.1";
if (host !== "127.0.0.1" && host.toLowerCase() !== "localhost") fail("dashboard host must be localhost");
const sourceCommit = String(values.NUSA_SOURCE_COMMIT_SHA || values.NUSA_SOURCE_COMMIT || "").trim().toLowerCase();
if (!sha40.test(sourceCommit)) fail("missing exact NUSA_SOURCE_COMMIT(_SHA)");
if (values.NUSA_SOURCE_COMMIT && values.NUSA_SOURCE_COMMIT_SHA && values.NUSA_SOURCE_COMMIT.toLowerCase() !== values.NUSA_SOURCE_COMMIT_SHA.toLowerCase()) {
  fail("NUSA_SOURCE_COMMIT and NUSA_SOURCE_COMMIT_SHA disagree");
}
const dbAbsolute = path.resolve(values.NUSA_CLOUD_STATE_DB_PATH);
if (dbAbsolute.startsWith("/opt/nusa/current/") || dbAbsolute === "/opt/nusa/current") fail("database must be outside release tree");
if (!dbAbsolute.startsWith("/var/lib/nusa/")) fail("database must be inside /var/lib/nusa for the hardened systemd unit");
const snapshotAbsolute = values.NUSA_RESEARCH_REPLAY_SNAPSHOT_PATH
  ? path.resolve(values.NUSA_RESEARCH_REPLAY_SNAPSHOT_PATH)
  : path.join(path.dirname(dbAbsolute), "research-replay-snapshots.json");
if (!path.isAbsolute(snapshotAbsolute) || !snapshotAbsolute.startsWith("/var/lib/nusa/")) {
  fail("Research replay snapshot must be inside /var/lib/nusa for the hardened systemd unit");
}
if (!fs.existsSync(backupPath)) fail(`missing backup directory: ${backupPath}`);
for (const requiredPath of [servicePath, researchServicePath, researchTimerPath]) {
  if (!fs.existsSync(requiredPath)) fail(`missing systemd unit: ${requiredPath}`);
}
if (fs.existsSync(currentPath) && !fs.lstatSync(currentPath).isSymbolicLink()) fail("/opt/nusa/current must be an atomic symlink");

const unit = fs.readFileSync(servicePath, "utf8");
for (const required of ["User=nusa", "Group=nusa", "NoNewPrivileges=true", "ProtectSystem=strict", "Restart=on-failure", "WorkingDirectory=/opt/nusa/current", "EnvironmentFile=/etc/nusa/cloud-runtime.env", "ExecStart=/usr/bin/node /opt/nusa/current/scripts/start-cloud-runtime.js", "ReadWritePaths=/var/lib/nusa /var/backups/nusa"]) {
  if (!unit.includes(required)) fail(`unit missing ${required}`);
}
if (/ExecStart=.*dist\/apps\/cloud\/src\/runtime\.js/.test(unit)) fail("systemd must not bypass the supervised PAPER launcher");

const researchUnit = fs.readFileSync(researchServicePath, "utf8");
for (const required of ["Type=oneshot", "User=nusa", "Group=nusa", "NoNewPrivileges=true", "ProtectSystem=strict", "ProtectHome=true", "WorkingDirectory=/opt/nusa/current", "EnvironmentFile=/etc/nusa/cloud-runtime.env", "ExecStart=/usr/bin/node /opt/nusa/current/scripts/run-cloud-research-snapshot.js", "ReadWritePaths=/var/lib/nusa /var/backups/nusa"]) {
  if (!researchUnit.includes(required)) fail(`Research unit missing ${required}`);
}
if (/ExecStart=.*research-real-market-run\.js/.test(researchUnit)) fail("Research systemd must use the canonical snapshot runner");

const timer = fs.readFileSync(researchTimerPath, "utf8");
for (const required of ["OnBootSec=2min", "OnCalendar=*-*-* 09:15:00 Asia/Seoul", "Persistent=true", "RandomizedDelaySec=5min", "Unit=nusa-research.service", "WantedBy=timers.target"]) {
  if (!timer.includes(required)) fail(`Research timer missing ${required}`);
}

console.log(JSON.stringify({ status: "PASS", envPath, dbPath: dbAbsolute, snapshotPath: snapshotAbsolute, sourceCommit, backupPath, servicePath, researchServicePath, researchTimerPath, host }));
