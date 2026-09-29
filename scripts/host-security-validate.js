"use strict";
const fs = require("node:fs");
const path = require("node:path");

const unit = process.env.NUSA_UNIT || path.resolve(__dirname, "..", "deploy", "oracle", "nusa.service");
const source = fs.readFileSync(unit, "utf8");
for (const required of [
  "User=nusa",
  "Group=nusa",
  "NoNewPrivileges=true",
  "PrivateTmp=true",
  "ProtectSystem=strict",
  "ProtectHome=true",
  "Restart=on-failure",
  "EnvironmentFile=/etc/nusa/cloud-runtime.env"
]) {
  if (!source.includes(required)) throw new Error(`missing ${required}`);
}
if (/User=root|Group=root/.test(source)) throw new Error("root service execution is forbidden");
if (!source.includes("ReadWritePaths=/var/lib/nusa /var/backups/nusa")) throw new Error("writable paths are not least-privilege");
console.log(JSON.stringify({ status: "PASS", unit, rootExecution: false, publicPort3000Allowed: false }));
