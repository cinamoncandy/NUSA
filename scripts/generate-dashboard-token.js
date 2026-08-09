"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const destination = process.env.NUSA_ENV_FILE || "/etc/nusa/cloud-runtime.env";
const token = crypto.randomBytes(32).toString("base64url");
const defaults = "NUSA_CLOUD_DASHBOARD_PORT=3000\nNUSA_CLOUD_DASHBOARD_HOST=127.0.0.1\nNUSA_CLOUD_STATE_DB_PATH=/var/lib/nusa/cloud-state.db\n";
const current = fs.existsSync(destination)
  ? fs.readFileSync(destination, "utf8").replace(/^NUSA_CLOUD_DASHBOARD_TOKEN=.*$/gm, "").replace(/\n{3,}/g, "\n")
  : defaults;
const next = `${current.trimEnd()}\nNUSA_CLOUD_DASHBOARD_TOKEN=${token}\n`;
const temporary = `${destination}.${process.pid}.tmp`;

if (process.env.NUSA_DRY_RUN === "1") {
  console.log(JSON.stringify({ status: "DRY_RUN", destination, tokenBytes: 32, restartRequired: true }));
  process.exit(0);
}

fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o750 });
fs.writeFileSync(temporary, next, { mode: 0o640, flag: "wx" });
fs.renameSync(temporary, destination);
console.log(JSON.stringify({ status: "ROTATED", destination, tokenBytes: 32, restartRequired: true }));
