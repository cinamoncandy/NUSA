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
const DAILY_RETENTION = 7;
const WEEKLY_RETENTION = 4;
const BACKUP_STAMP_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/;
const SHA256_SIDECAR_RE = /^([a-f0-9]{64})  ([^\n]+)\n$/;

function backupStamp(name, prefix) {
  if (!name.startsWith(prefix) || !name.endsWith(".db")) return null;
  const stamp = name.slice(prefix.length, -3);
  const match = BACKUP_STAMP_RE.exec(stamp);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, millisecond] = match;
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}.${millisecond}Z`;
  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== iso) return null;
  return stamp;
}

function hasVerifiedSidecar(name) {
  const sidecar = path.join(destination, `${name}.sha256`);
  let manifest;
  try {
    manifest = fs.readFileSync(sidecar, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw error;
  }
  const match = SHA256_SIDECAR_RE.exec(manifest);
  return Boolean(match && match[2] === name);
}

function dailyBucket(name, prefix) {
  const stamp = backupStamp(name, prefix);
  return stamp ? stamp.slice(0, 10) : null;
}

function weeklyBucket(name, prefix) {
  const day = dailyBucket(name, prefix);
  if (!day) return null;
  const date = new Date(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return null;
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.toISOString().slice(0, 10);
}

function prune(prefix, keepBuckets, bucketForName) {
  const files = fs.readdirSync(destination)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".db"))
    .sort().reverse();
  const keptBuckets = new Set();
  for (const name of files) {
    const bucket = bucketForName(name, prefix);
    // Only a canonical timestamp plus a verification sidecar may compete for a
    // retention bucket. Preserve malformed or interrupted snapshots fail-closed:
    // they cannot displace a known-good recovery point, and this routine will
    // not delete an artifact whose verification state is uncertain.
    if (!bucket || !hasVerifiedSidecar(name)) continue;
    if (!keptBuckets.has(bucket) && keptBuckets.size < keepBuckets) {
      keptBuckets.add(bucket);
      continue;
    }
    fs.rmSync(path.join(destination, name), { force: true });
    fs.rmSync(path.join(destination, `${name}.sha256`), { force: true });
  }
}

function pruneRetention() {
  prune("daily-cloud-state-", DAILY_RETENTION, dailyBucket);
  prune("weekly-cloud-state-", WEEKLY_RETENTION, weeklyBucket);
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
  console.log(JSON.stringify({ status: "DRY_RUN", source, destination, dailyRetention: DAILY_RETENTION, weeklyRetention: WEEKLY_RETENTION }));
  process.exit(0);
}
if (!fs.existsSync(source)) throw new Error(`database does not exist: ${source}`);
fs.mkdirSync(destination, { recursive: true, mode: 0o750 });
// Collapse duplicate release-time snapshots into their intended calendar buckets before
// creating the next snapshot. This preserves one verified recovery point per retained
// UTC day/week while reclaiming same-period duplicates before VACUUM INTO needs space.
pruneRetention();

const db = new DatabaseSync(source, { readOnly: true });
let dailyDigest;
try {
  try {
    db.exec("PRAGMA wal_checkpoint(PASSIVE)");
  } catch (checkpointError) {
    // Best-effort only: a read-only source cannot checkpoint, but VACUUM INTO
    // still produces a consistent snapshot. Never fail the backup for this.
    console.error(`wal_checkpoint skipped: ${checkpointError instanceof Error ? checkpointError.message : checkpointError}`);
  }
  db.exec(`VACUUM INTO ${sqlString(daily)}`);
  dailyDigest = verifyAndManifest(daily);
  if (now.getUTCDay() === 0) {
    fs.copyFileSync(daily, weekly, fs.constants.COPYFILE_EXCL);
    verifyAndManifest(weekly);
  }
  pruneRetention();
} finally {
  db.close();
}
console.log(JSON.stringify({ status: "PASS", output: daily, sha256: dailyDigest, dailyRetention: DAILY_RETENTION, weeklyRetention: WEEKLY_RETENTION }));
