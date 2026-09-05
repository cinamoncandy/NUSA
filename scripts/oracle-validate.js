"use strict";
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(process.env.NUSA_ORACLE_ROOT || "/");
const rooted = (absolute) => path.join(root, absolute.replace(/^\/+/, ""));
const envPath = rooted("/etc/nusa/cloud-runtime.env");
const backupPath = rooted("/var/backups/nusa");
const servicePath = rooted("/etc/systemd/system/nusa.service");
const currentPath = rooted("/opt/nusa/current");
const fail = (message) => { throw new Error(message); };

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
const dbAbsolute = path.resolve(values.NUSA_CLOUD_STATE_DB_PATH);
if (dbAbsolute.startsWith("/opt/nusa/current/") || dbAbsolute === "/opt/nusa/current") fail("database must be outside release tree");
if (!fs.existsSync(backupPath)) fail(`missing backup directory: ${backupPath}`);
if (!fs.existsSync(servicePath)) fail(`missing systemd unit: ${servicePath}`);
if (fs.existsSync(currentPath) && !fs.lstatSync(currentPath).isSymbolicLink()) fail("/opt/nusa/current must be an atomic symlink");
const unit = fs.readFileSync(servicePath, "utf8");
for (const required of ["User=nusa", "Group=nusa", "NoNewPrivileges=true", "ProtectSystem=strict", "Restart=on-failure", "WorkingDirectory=/opt/nusa/current", "ExecStart=/usr/bin/node /opt/nusa/current/scripts/start-cloud-runtime.js"]) {
  if (!unit.includes(required)) fail(`unit missing ${required}`);
}
if (/ExecStart=.*dist\/apps\/cloud\/src\/runtime\.js/.test(unit)) fail("systemd must not bypass the supervised PAPER launcher");
console.log(JSON.stringify({ status: "PASS", envPath, dbPath: dbAbsolute, backupPath, servicePath, host }));
