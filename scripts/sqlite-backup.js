"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const source = path.resolve(process.env.NUSA_DB || "/var/lib/nusa/cloud-state.db");
const destination = path.resolve(process.env.NUSA_BACKUP_DIR || "/var/backups/nusa");
const now = new Date();
const stamp = now.toISOString().replaceAll(/[:.]/g, "-");
const daily = path.join(destination, `daily-cloud-state-${stamp}.db`);
const weekly = path.join(destination, `weekly-cloud-state-${stamp}.db`);
const sqlString = (value) => `'${value.replaceAll("'", "''")}'`;

function prune(prefix, keep) {
  const files = fs.readdirSync(destination)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".db"))
    .sort().reverse();
  for (const name of files.slice(keep)) {
    fs.rmSync(path.join(destination, name), { force: true });
    fs.rmSync(path.join(destination, `${name}.sha256`), { force: true });
  }
}

function verifyAndManifest(output) {
  const checkDb = new DatabaseSync(output, { readOnly: true });
  try {
    const check = checkDb.prepare("PRAGMA integrity_check").get();
    if (!Object.values(check).includes("ok")) throw new Error("backup integrity check failed");
  } finally {
    checkDb.close();
  }
  const digest = crypto.createHash("sha256").update(fs.readFileSync(output)).digest("hex");
  fs.writeFileSync(`${output}.sha256`, `${digest}  ${path.basename(output)}\n`, { mode: 0o640 });
  return digest;
}

if (process.env.NUSA_DRY_RUN === "1") {
  console.log(JSON.stringify({ status: "DRY_RUN", source, destination, dailyRetention: 7, weeklyRetention: 4 }));
  process.exit(0);
}
if (!fs.existsSync(source)) throw new Error(`database does not exist: ${source}`);
fs.mkdirSync(destination, { recursive: true, mode: 0o750 });

const db = new DatabaseSync(source);
let dailyDigest;
try {
  db.exec("PRAGMA wal_checkpoint(PASSIVE)");
  db.exec(`VACUUM INTO ${sqlString(daily)}`);
  dailyDigest = verifyAndManifest(daily);
  if (now.getUTCDay() === 0) {
    fs.copyFileSync(daily, weekly, fs.constants.COPYFILE_EXCL);
    verifyAndManifest(weekly);
  }
  prune("daily-cloud-state-", 7);
  prune("weekly-cloud-state-", 4);
} finally {
  db.close();
}
console.log(JSON.stringify({ status: "PASS", output: daily, sha256: dailyDigest, dailyRetention: 7, weeklyRetention: 4 }));
