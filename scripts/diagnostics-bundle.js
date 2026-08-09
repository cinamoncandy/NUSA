#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { validateDisasterRecoveryRestore } = require("./validate-disaster-recovery-restore.js");
const { scanText } = require("./security-gate.js");

const root = path.resolve(__dirname, "..");
const MAX_FILES = 200;
const MAX_BYTES = 1024 * 1024;
const FORBIDDEN_PATH = /(^|[\\/._-])(env|secret|token|password|credential|private[-_]?key|api[-_]?key)([\\/._-]|$)|\.(pem|p12|pfx|key)$/i;
const ALLOWED_ROOTS = Object.freeze([
  "package.json",
  "pnpm-lock.yaml",
  "README.md",
  "ARCHITECTURE.md",
  "RISKS.md",
  "docs/specs",
  "docs/adr",
  "docs/checklists",
  "docs/operations",
  "scripts/release-manifest.js",
  "scripts/release-artifacts.js",
  "scripts/verify-release-manifest.js",
  "scripts/validate-release-process.js",
  "scripts/validate-disaster-recovery-restore.js",
  "scripts/validate-runtime-diagnostics.js",
  ".github/workflows/ci.yml"
]);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith("--")) throw new Error(`unexpected argument: ${value}`);
    args[value.slice(2)] = argv[++i] ?? true;
  }
  return args;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeRelative(file) {
  const relative = path.relative(root, file).replaceAll("\\", "/");
  if (!relative || relative.startsWith("../") || path.isAbsolute(relative)) throw new Error(`unsafe diagnostics path: ${relative}`);
  return relative;
}

function walk(input) {
  if (!fs.existsSync(input)) return [];
  const stat = fs.lstatSync(input);
  if (stat.isSymbolicLink()) throw new Error(`symlink is prohibited in diagnostics source: ${input}`);
  if (stat.isFile()) return [input];
  if (!stat.isDirectory()) return [];
  const files = [];
  for (const entry of fs.readdirSync(input, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(input, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`symlink is prohibited in diagnostics source: ${full}`);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function redact(text) {
  const sensitiveKey = "(?:authorization|access[_-]?key|api[_-]?key|client[_-]?secret|password|passwd|secret[_-]?key|token|credential|private[_-]?key)";
  const assignment = new RegExp(`(${sensitiveKey}\\s*["']?\\s*[:=]\\s*)("[^"\\r\\n]*"|'[^'\\r\\n]*'|(?:bearer\\s+)?[^\\s,}]+)`, "gi");
  return text
    .replace(/(-----BEGIN [A-Z ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----)/g, "$1\n[REDACTED]\n$2")
    .replace(assignment, (_match, prefix, value) => {
      const quote = value[0];
      return quote === '"' || quote === "'" ? `${prefix}${quote}[REDACTED]${quote}` : `${prefix}[REDACTED]`;
    })
    .replace(/\b(?:ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9-]{16,}\b/g, "[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[REDACTED]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED]");
}

function assertNoResidualSecrets(text, file) {
  const normalized = text
    .replaceAll("[REDACTED]", "redacted")
    .replace(/(["'])(access[_-]?key|api[_-]?key|client[_-]?secret|password|passwd|secret[_-]?key|token|credential|private[_-]?key)\1\s*:/gi, "$2:");
  const findings = scanText(normalized, file);
  if (findings.length > 0) throw new Error(`residual secret material detected after redaction: ${file}`);
}

function validateRuntimeDiagnostics(input) {
  if (!input) return undefined;
  const absolute = path.resolve(input);
  if (!path.isAbsolute(absolute) || !fs.existsSync(absolute)) throw new Error("runtime diagnostics input must be an existing absolute file");
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "validate-runtime-diagnostics.js"), "--input", absolute], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`runtime diagnostics validation failed: ${(result.stderr || result.stdout).trim()}`);
  return absolute;
}

function releaseMetadataFiles() {
  const release = path.join(root, "release");
  if (!fs.existsSync(release)) return [];
  return fs.readdirSync(release).sort()
    .filter((name) => name === "build-manifest.json" || name.endsWith("-checksums.txt") || name.endsWith("-SBOM.json") || name.endsWith("-verification.json"))
    .map((name) => path.join(release, name));
}

function assertReleaseSafety(files) {
  const manifest = files.find((file) => path.basename(file) === "build-manifest.json");
  if (!manifest) return Object.freeze({ status: "NOT_PRESENT" });
  const parsed = JSON.parse(fs.readFileSync(manifest, "utf8"));
  if (parsed?.capabilityDescriptor?.productionMutationAllowed !== false) throw new Error("release diagnostics input violates productionMutationAllowed=false");
  return Object.freeze({ status: "PRESENT", commit: parsed.commit ?? "UNKNOWN", productionMutationAllowed: false });
}

function generateBundle(options) {
  const contract = validateDisasterRecoveryRestore();
  if (!contract.ok) throw new Error(`disaster-recovery contract invalid: ${contract.failures.join(",")}`);
  const output = path.resolve(options.output || "");
  if (!options.output || !path.isAbsolute(output)) throw new Error("--output must be an absolute path");
  if (fs.existsSync(output)) throw new Error("diagnostics output must not already exist");

  const runtimeInput = validateRuntimeDiagnostics(options["runtime-diagnostics"]);
  const releaseFiles = releaseMetadataFiles();
  const releaseContract = assertReleaseSafety(releaseFiles);
  const sourceFiles = [];
  for (const relative of ALLOWED_ROOTS) sourceFiles.push(...walk(path.join(root, relative)));
  sourceFiles.push(...releaseFiles);
  if (runtimeInput) sourceFiles.push(runtimeInput);
  const unique = [...new Set(sourceFiles.map((file) => path.resolve(file)))].sort();
  if (unique.length > MAX_FILES) throw new Error(`diagnostics file cap exceeded: ${unique.length} > ${MAX_FILES}`);

  fs.mkdirSync(output, { recursive: false, mode: 0o700 });
  const entries = [];
  let totalBytes = 0;
  try {
    for (const file of unique) {
      let relative;
      if (file.startsWith(`${root}${path.sep}`)) relative = normalizeRelative(file);
      else if (runtimeInput && file === runtimeInput) relative = "runtime/runtime-diagnostics.json";
      else throw new Error(`diagnostics source escaped allowlist: ${file}`);
      if (FORBIDDEN_PATH.test(relative)) throw new Error(`secret-shaped diagnostics path is prohibited: ${relative}`);
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`diagnostics source must be a regular file: ${file}`);
      if (stat.size > MAX_BYTES) throw new Error(`diagnostics source exceeds 1 MiB cap: ${relative}`);
      let content;
      try { content = fs.readFileSync(file, "utf8"); }
      catch { throw new Error(`diagnostics source must be UTF-8 text: ${relative}`); }
      const safe = redact(content);
      assertNoResidualSecrets(safe, relative);
      const bytes = Buffer.from(safe, "utf8");
      totalBytes += bytes.length;
      if (totalBytes > MAX_FILES * MAX_BYTES) throw new Error("diagnostics aggregate size cap exceeded");
      const destination = path.join(output, ...relative.split("/"));
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      fs.writeFileSync(destination, bytes, { mode: 0o600, flag: "wx" });
      entries.push(Object.freeze({ path: relative, sizeBytes: bytes.length, sha256: sha256(bytes) }));
    }
    const manifest = Object.freeze({
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      mode: "READ_ONLY_DIAGNOSTICS",
      productionMutationAllowed: false,
      evidenceMutationAllowed: false,
      secretMaterialIncluded: false,
      redactionEnabled: true,
      disasterRecoveryContract: "PASS",
      runtimeDiagnosticsValidation: runtimeInput ? "PASS" : "NOT_REQUESTED",
      releaseContract,
      fileCount: entries.length,
      totalBytes,
      entries
    });
    fs.writeFileSync(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    return manifest;
  } catch (error) {
    fs.rmSync(output, { recursive: true, force: true });
    throw error;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = generateBundle(args);
  console.log(JSON.stringify({ status: "PASS", output: path.resolve(args.output), fileCount: manifest.fileCount, totalBytes: manifest.totalBytes, secretMaterialIncluded: false, productionMutationAllowed: false }, null, 2));
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error(`[diagnostics-bundle] ${error instanceof Error ? error.message : "diagnostics bundle failed"}`);
    process.exitCode = 1;
  }
}

module.exports = { generateBundle, redact };
