"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const source = process.env.NUSA_DB || "/var/lib/nusa/cloud-state.db";
const destination = process.env.NUSA_BACKUP_DIR || "/var/backups/nusa";
const output = path.join(destination, `cloud-state-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.db`);
if (process.env.NUSA_DRY_RUN === "1") { console.log(JSON.stringify({ status: "DRY_RUN", source, output })); process.exit(0); }
fs.mkdirSync(destination, { recursive: true });
const db = new DatabaseSync(source);
try {
  db.exec("PRAGMA wal_checkpoint(PASSIVE)");
  if (typeof db.backup !== "function") throw new Error("SQLite online backup API unavailable");
  db.backup(output);
  const check = new DatabaseSync(output).prepare("PRAGMA integrity_check").get();
  if (!Object.values(check).includes("ok")) throw new Error("backup integrity check failed");
  const digest = crypto.createHash("sha256").update(fs.readFileSync(output)).digest("hex");
  fs.writeFileSync(`${output}.sha256`, `${digest}  ${path.basename(output)}\n`, { mode: 0o640 });
  console.log(JSON.stringify({ status: "PASS", output, sha256: digest }));
} finally { db.close(); }
