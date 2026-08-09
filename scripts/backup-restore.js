#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { validateDisasterRecoveryRestore } = require("./validate-disaster-recovery-restore.js");
const { scanText } = require("./security-gate.js");

const SCHEMA_VERSION = 2;
const CATEGORIES = new Set(["CONFIG", "EVIDENCE", "LOG", "DATABASE_SNAPSHOT"]);
const FORBIDDEN_NAME = /(^|[._-])(env|secret|token|password|credential|private[-_]?key|api[-_]?key)([._-]|$)|\.(pem|p12|pfx|key)$/i;
const SNAPSHOT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const SENSITIVE_ASSIGNMENT = /(?:^|[\s,{])["']?(?:access[_-]?key|api[_-]?key|client[_-]?secret|password|passwd|secret[_-]?key|token|credential|private[_-]?key)["']?\s*[:=]\s*(?:bearer\s+)?(?:"[^"\r\n]{8,}"|'[^'\r\n]{8,}'|[^\s,}\]]{8,})/i;
const AUTHORIZATION_VALUE = '(?:"[^"\\r\\n]+"|\'[^\'\\r\\n]+\'|[^\\s,"\'}\\]\\r\\n][^,}\\]\\r\\n]*)';
const AUTHORIZATION_ASSIGNMENT = new RegExp(`(?:^|[\\s,{;])(?:[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*\\s*\\[\\s*)?["']?authorization["']?\\s*(?:\\]\\s*)?(?::|=)\\s*${AUTHORIZATION_VALUE}`, "i");
const AUTHORIZATION_PAIR = new RegExp(`(?:^|[\\[,])\\s*["']authorization["']\\s*,\\s*${AUTHORIZATION_VALUE}`, "i");
const AUTHORIZATION_SETTER = new RegExp(`\\.\\s*(?:set|append)\\s*\\(\\s*["']authorization["']\\s*,\\s*${AUTHORIZATION_VALUE}`, "i");

function hasAuthorizationCredential(text) {
  const normalized = String(text ?? "").replace(/\\(["'])/g, "$1");
  return AUTHORIZATION_ASSIGNMENT.test(normalized)
    || AUTHORIZATION_PAIR.test(normalized)
    || AUTHORIZATION_SETTER.test(normalized);
}

function secretFindings(bytes, file) {
  const text = bytes.toString("utf8");
  const normalized = text.replace(/(["'])(authorization|access[_-]?key|api[_-]?key|client[_-]?secret|password|passwd|secret[_-]?key|token|credential|private[_-]?key)\1\s*:/gi, "$2:");
  const findings = scanText(normalized, file);
  if (SENSITIVE_ASSIGNMENT.test(text)) findings.push({ file, line: 0, rule: "SENSITIVE_ASSIGNMENT" });
  if (hasAuthorizationCredential(text)) findings.push({ file, line: 0, rule: "AUTHORIZATION_CREDENTIAL" });
  return findings;
}

function parseArgs(argv) {
  const args = { include: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--include") args.include.push(argv[++i]);
    else if (value.startsWith("--")) args[value.slice(2)] = argv[++i] ?? true;
    else if (!args.command) args.command = value;
    else throw new Error(`unexpected argument: ${value}`);
  }
  return args;
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function sha256Json(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function ensureCurrentRecoveryContract() {
  const result = validateDisasterRecoveryRestore();
  if (!result.ok) throw new Error(`current disaster-recovery contract is invalid: ${result.failures.join(",")}`);
}

function gitHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: path.resolve(__dirname, ".."), encoding: "utf8" }).trim();
  } catch {
    return "UNKNOWN";
  }
}

function normalizedAbsolute(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  const resolved = path.resolve(value);
  if (!path.isAbsolute(resolved)) throw new Error(`${label} must resolve to an absolute path`);
  return resolved;
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertNoSymlink(file, root) {
  let current = file;
  while (isInside(root, current)) {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`symlink is prohibited in recovery source: ${current}`);
    if (current === root) return;
    current = path.dirname(current);
  }
}

function readStableRegularFile(file, root) {
  assertNoSymlink(file, root);
  const before = fs.lstatSync(file, { bigint: true });
  if (!before.isFile()) throw new Error(`recovery source must remain a regular file: ${file}`);
  const expectedRealpath = fs.realpathSync(file);
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    const currentRealpath = fs.realpathSync(file);
    if (!opened.isFile()
      || opened.dev !== before.dev
      || opened.ino !== before.ino
      || opened.size !== before.size
      || currentRealpath !== expectedRealpath) {
      throw new Error(`recovery source identity changed before read: ${file}`);
    }
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (after.dev !== opened.dev
      || after.ino !== opened.ino
      || after.size !== opened.size
      || after.mtimeNs !== opened.mtimeNs
      || after.ctimeNs !== opened.ctimeNs) {
      throw new Error(`recovery source changed while being read: ${file}`);
    }
    return bytes;
  } finally {
    fs.closeSync(descriptor);
  }
}

function parseIncludes(raw) {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("at least one --include CATEGORY:/absolute/path is required");
  return raw.map((entry) => {
    const separator = entry.indexOf(":");
    if (separator < 1) throw new Error(`invalid include: ${entry}`);
    const category = entry.slice(0, separator).toUpperCase();
    if (!CATEGORIES.has(category)) throw new Error(`unsupported recovery category: ${category}`);
    const source = normalizedAbsolute(entry.slice(separator + 1), "include path");
    if (!fs.existsSync(source)) throw new Error(`recovery source does not exist: ${source}`);
    assertNoSymlink(source, source);
    return Object.freeze({ category, source });
  });
}

function walkFiles(root) {
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink()) throw new Error(`symlink is prohibited in recovery source: ${root}`);
  if (stat.isFile()) return [root];
  if (!stat.isDirectory()) throw new Error(`unsupported recovery source type: ${root}`);
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`symlink is prohibited in recovery source: ${full}`);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(full);
    }
  };
  walk(root);
  return files;
}

function safeRelative(root, file) {
  const relative = fs.lstatSync(root).isFile() ? path.basename(root) : path.relative(root, file);
  const normalized = relative.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("../") || path.isAbsolute(normalized)) throw new Error(`unsafe recovery path: ${normalized}`);
  return normalized;
}

function releaseContract(releaseRoot) {
  if (!releaseRoot) return Object.freeze({ status: "NOT_REQUESTED" });
  const root = normalizedAbsolute(releaseRoot, "release-root");
  const buildManifest = path.join(root, "build-manifest.json");
  if (!fs.existsSync(buildManifest)) throw new Error("release build-manifest.json is required when --release-root is provided");
  const files = fs.readdirSync(root).sort();
  const checksum = files.find((name) => name.endsWith("-checksums.txt"));
  const sbom = files.find((name) => name.endsWith("-SBOM.json"));
  if (!checksum || !sbom) throw new Error("release checksums and SBOM are required when --release-root is provided");
  const manifest = JSON.parse(fs.readFileSync(buildManifest, "utf8"));
  if (manifest?.capabilityDescriptor?.productionMutationAllowed !== false) throw new Error("release manifest must preserve productionMutationAllowed=false");
  return Object.freeze({
    status: "VERIFIED_INPUTS_PRESENT",
    commit: manifest.commit ?? "UNKNOWN",
    productionMutationAllowed: false,
    buildManifestSha256: sha256File(buildManifest),
    checksumsSha256: sha256File(path.join(root, checksum)),
    sbomSha256: sha256File(path.join(root, sbom))
  });
}

function snapshotId(requested) {
  const value = requested || process.env.NUSA_RECOVERY_SNAPSHOT_ID || `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${crypto.randomBytes(4).toString("hex")}`;
  if (!SNAPSHOT_ID.test(value)) throw new Error("snapshot id contains unsupported characters");
  return value;
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, file);
}

function createBackup(args) {
  ensureCurrentRecoveryContract();
  const includes = parseIncludes(args.include);
  const destinationRoot = normalizedAbsolute(args.destination, "destination");
  for (const { source } of includes) {
    if (isInside(source, destinationRoot)) throw new Error("backup destination must not be inside a recovery source");
  }
  fs.mkdirSync(destinationRoot, { recursive: true, mode: 0o700 });
  const id = snapshotId(args["snapshot-id"]);
  const snapshot = path.join(destinationRoot, id);
  if (fs.existsSync(snapshot)) throw new Error(`backup snapshot already exists: ${snapshot}`);
  fs.mkdirSync(snapshot, { recursive: false, mode: 0o700 });

  const entries = [];
  let secretExcludedCount = 0;
  try {
    for (const { category, source } of includes) {
      for (const file of walkFiles(source)) {
        const relative = safeRelative(source, file);
        if (relative.split("/").some((segment) => FORBIDDEN_NAME.test(segment))) {
          secretExcludedCount += 1;
          continue;
        }
        const sourceBytes = readStableRegularFile(file, source);
        if (secretFindings(sourceBytes, relative).length > 0) {
          secretExcludedCount += 1;
          continue;
        }
        const outputRelative = `${category}/${crypto.createHash("sha256").update(source).digest("hex").slice(0, 12)}/${relative}`;
        const output = path.join(snapshot, ...outputRelative.split("/"));
        fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
        fs.writeFileSync(output, sourceBytes, { mode: 0o600, flag: "wx" });
        entries.push(Object.freeze({
          category,
          path: outputRelative,
          sizeBytes: sourceBytes.length,
          sha256: crypto.createHash("sha256").update(sourceBytes).digest("hex")
        }));
      }
    }
    entries.sort((a, b) => a.path.localeCompare(b.path));
    if (entries.length === 0) throw new Error("backup contains no non-secret files");
    const manifest = Object.freeze({
      schemaVersion: SCHEMA_VERSION,
      snapshotId: id,
      createdAt: new Date().toISOString(),
      sourceCommit: gitHead(),
      mode: "BACKUP_COPY_ONLY",
      destructiveRestoreAllowed: false,
      productionMutationAllowed: false,
      evidenceMutationAllowed: false,
      secretMaterialIncluded: false,
      secretExcludedCount,
      releaseContract: releaseContract(args["release-root"]),
      entries
    });
    atomicJson(path.join(snapshot, "manifest.json"), manifest);
    return Object.freeze({ snapshot, manifest });
  } catch (error) {
    fs.rmSync(snapshot, { recursive: true, force: true });
    throw error;
  }
}

function readAndVerify(snapshotPath) {
  ensureCurrentRecoveryContract();
  const snapshot = normalizedAbsolute(snapshotPath, "snapshot");
  const manifestPath = path.join(snapshot, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.schemaVersion !== SCHEMA_VERSION) throw new Error(`unsupported recovery manifest schema: ${manifest.schemaVersion}`);
  if (manifest.destructiveRestoreAllowed !== false || manifest.productionMutationAllowed !== false || manifest.evidenceMutationAllowed !== false || manifest.secretMaterialIncluded !== false) {
    throw new Error("recovery manifest safety invariants are invalid");
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) throw new Error("recovery manifest entries are required");
  const seen = new Set();
  for (const entry of manifest.entries) {
    if (!CATEGORIES.has(entry.category)) throw new Error(`invalid recovery category: ${entry.category}`);
    if (typeof entry.path !== "string" || entry.path.startsWith("/") || entry.path.includes("../")) throw new Error(`unsafe manifest path: ${entry.path}`);
    if (entry.path.split("/").some((segment) => FORBIDDEN_NAME.test(segment))) throw new Error(`secret-shaped path in manifest: ${entry.path}`);
    if (seen.has(entry.path)) throw new Error(`duplicate manifest path: ${entry.path}`);
    seen.add(entry.path);
    const file = path.join(snapshot, ...entry.path.split("/"));
    if (!isInside(snapshot, file) || !fs.existsSync(file) || !fs.lstatSync(file).isFile()) throw new Error(`missing recovery artifact: ${entry.path}`);
    if (fs.statSync(file).size !== entry.sizeBytes) throw new Error(`size mismatch: ${entry.path}`);
    if (sha256File(file) !== entry.sha256) throw new Error(`checksum mismatch: ${entry.path}`);
    if (secretFindings(fs.readFileSync(file), entry.path).length > 0) throw new Error(`secret material detected in recovery artifact: ${entry.path}`);
  }
  return Object.freeze({ snapshot, manifest, manifestPath, manifestSha256: sha256File(manifestPath) });
}

function writeDrillLog(args, verified, result, targetRemoved) {
  const logFile = normalizedAbsolute(
    args["drill-log"] || path.join(path.dirname(verified.snapshot), `${verified.manifest.snapshotId}.drill-log.json`),
    "drill-log"
  );
  if (isInside(verified.snapshot, logFile)) throw new Error("drill log must be outside the immutable recovery snapshot");
  if (fs.existsSync(logFile)) throw new Error("drill log must not already exist");
  const payload = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    eventType: "RECOVERY_DRILL_EVIDENCE",
    createdAt: new Date().toISOString(),
    sourceCommit: gitHead(),
    snapshotId: verified.manifest.snapshotId,
    snapshotManifestSha256: verified.manifestSha256,
    status: result.status,
    mode: result.mode,
    artifactCount: result.artifactCount,
    targetRemoved,
    automaticRestartAllowed: false,
    destructiveRestoreAllowed: false,
    productionMutationAllowed: false,
    evidenceMutationAllowed: false
  });
  const evidenceHashSha256 = sha256Json(payload);
  const evidence = Object.freeze({ ...payload, evidenceHashSha256 });
  atomicJson(logFile, evidence);
  return Object.freeze({ logFile, evidence });
}

function runDrill(args) {
  const verified = readAndVerify(args.snapshot);
  const target = normalizedAbsolute(args["drill-target"] || path.join(os.tmpdir(), `nusa-recovery-drill-${process.pid}`), "drill-target");
  if (fs.existsSync(target)) throw new Error("drill target must not already exist");
  fs.mkdirSync(target, { recursive: false, mode: 0o700 });
  try {
    for (const entry of verified.manifest.entries) {
      const source = path.join(verified.snapshot, ...entry.path.split("/"));
      const output = path.join(target, ...entry.path.split("/"));
      fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
      fs.copyFileSync(source, output, fs.constants.COPYFILE_EXCL);
      if (sha256File(output) !== entry.sha256) throw new Error(`drill checksum mismatch: ${entry.path}`);
    }
    const keepTarget = args.keep === "true";
    const result = Object.freeze({
      status: "PASS",
      mode: "VERIFY_ONLY_RESTORE_DRILL",
      snapshotId: verified.manifest.snapshotId,
      artifactCount: verified.manifest.entries.length,
      target,
      automaticRestartAllowed: false,
      destructiveRestoreAllowed: false,
      productionMutationAllowed: false,
      evidenceMutationAllowed: false
    });
    if (!keepTarget) fs.rmSync(target, { recursive: true, force: true });
    const drillLog = writeDrillLog(args, verified, result, !keepTarget);
    return Object.freeze({ ...result, drillLog: drillLog.logFile, evidenceHashSha256: drillLog.evidence.evidenceHashSha256, targetRemoved: !keepTarget });
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    throw error;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "backup") {
    const result = createBackup(args);
    console.log(JSON.stringify({ status: "PASS", mode: "BACKUP_COPY_ONLY", snapshot: result.snapshot, artifactCount: result.manifest.entries.length, secretExcludedCount: result.manifest.secretExcludedCount, productionMutationAllowed: false }, null, 2));
    return;
  }
  if (args.command === "verify") {
    const result = readAndVerify(args.snapshot);
    console.log(JSON.stringify({ status: "PASS", mode: "VERIFY_ONLY", snapshotId: result.manifest.snapshotId, artifactCount: result.manifest.entries.length, manifestSha256: result.manifestSha256, productionMutationAllowed: false }, null, 2));
    return;
  }
  if (args.command === "drill") {
    console.log(JSON.stringify(runDrill(args), null, 2));
    return;
  }
  if (args.command === "restore") throw new Error("destructive restore is intentionally unsupported; use the verify-only drill command");
  throw new Error("usage: backup-restore.js <backup|verify|drill> [options]");
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error(`[backup-restore] ${error instanceof Error ? error.message : "recovery operation failed"}`);
    process.exitCode = 1;
  }
}

module.exports = { createBackup, readAndVerify, runDrill, parseIncludes, writeDrillLog };
