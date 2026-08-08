"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const date = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
const reportDir = path.join(root, "docs", "audits");
const lockPath = path.join(root, "pnpm-lock.yaml");
const allowedLicenses = new Set(["0BSD", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "BlueOak-1.0.0", "CC-BY-4.0", "CC0-1.0", "ISC", "MIT", "MIT-0", "MPL-2.0", "Python-2.0", "Unlicense", "WTFPL"]);
const textExtensions = new Set([".cjs", ".cfg", ".css", ".env", ".html", ".ini", ".js", ".json", ".md", ".mjs", ".ts", ".toml", ".txt", ".yaml", ".yml"]);
const ignoredScanPaths = /(^|[\\/])(\.git|node_modules|dist|coverage|release|storybook-static|test-results|\.pnpm-store|\.tmp-nusa-install)([\\/]|$)/;
const placeholders = new Set(["", "access-key", "change-me", "example", "example-key", "hunter2hunter2", "not-configured", "redacted", "secret-key", "test", "testing", "undefined", "unknown"]);

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function trackedFiles() {
  try {
    const output = execFileSync("git", ["ls-files", "-z"], { cwd: root });
    return output.toString("utf8").split("\0").filter(Boolean).map((file) => path.join(root, file));
  } catch {
    return [];
  }
}

function scanText(value, file = "<text>") {
  const findings = [];
  const rules = [
    { id: "PRIVATE_KEY", expression: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i },
    { id: "CLOUD_ACCESS_KEY", expression: /\bAKIA[0-9A-Z]{16}\b/ },
    { id: "TOKEN_PREFIX", expression: /\b(?:ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9-]{16,}/ },
    { id: "JWT_VALUE", expression: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
    { id: "CREDENTIAL_ASSIGNMENT", expression: /\b(?:access[_-]?key|api[_-]?key|client[_-]?secret|password|passwd|secret[_-]?key|token)\b\s*[:=]\s*["']([^"']{8,})["']/i }
  ];
  for (const [lineIndex, line] of value.split(/\r?\n/).entries()) {
    for (const rule of rules) {
      const match = line.match(rule.expression);
      if (!match) continue;
      const candidate = match[1] ?? match[0];
      if (candidate === "AKIAIOSFODNN7EXAMPLE" || placeholders.has(candidate.toLowerCase())) continue;
      if (rule.id === "CREDENTIAL_ASSIGNMENT" && placeholders.has(candidate.toLowerCase())) continue;
      findings.push({ file, line: lineIndex + 1, rule: rule.id });
    }
  }
  return findings;
}

function scanSecrets() {
  const findings = [];
  for (const file of trackedFiles()) {
    const relative = path.relative(root, file).replaceAll("\\", "/");
    if (ignoredScanPaths.test(relative) || !textExtensions.has(path.extname(file).toLowerCase())) continue;
    const bytes = fs.readFileSync(file);
    if (bytes.includes(0)) continue;
    findings.push(...scanText(bytes.toString("utf8"), relative));
  }
  return findings;
}

function baseSelector(selector) {
  return selector.replace(/(?:\([^)]*\))+$/, "");
}

function sectionBlocks(lines, header) {
  const blocks = new Map();
  let inSection = false;
  let selector = null;
  let body = [];
  const flush = () => {
    if (selector !== null) blocks.set(selector, body);
    selector = null;
    body = [];
  };
  for (const line of lines) {
    if (!inSection) {
      if (line === header) inSection = true;
      continue;
    }
    if (line && !line.startsWith("  ")) {
      flush();
      break;
    }
    const match = line.match(/^  (?! )(?:'([^']+)'|([^:]+)):\s*$/);
    if (match) {
      flush();
      selector = match[1] ?? match[2];
      continue;
    }
    if (selector !== null) body.push(line);
  }
  flush();
  return blocks;
}

function parseLockfile() {
  const source = fs.readFileSync(lockPath, "utf8");
  const lines = source.split(/\r?\n/);
  const packages = [];
  for (const [rawSelector, body] of sectionBlocks(lines, "packages:")) {
    const selector = baseSelector(rawSelector);
    const at = selector.lastIndexOf("@");
    if (at <= 0) continue;
    const block = body.join("\n");
    packages.push({
      name: selector.slice(0, at),
      version: selector.slice(at + 1),
      integrity: block.match(/integrity:\s*([^\s}]+)/)?.[1] ?? null,
      platformSpecific: /(?:^|\n)    (?:cpu|os): \[[^\]]+\]/.test(block)
    });
  }
  const optional = new Set();
  for (const [rawSelector, body] of sectionBlocks(lines, "snapshots:")) {
    if (body.some((line) => /^    optional: true\s*$/.test(line))) optional.add(baseSelector(rawSelector));
  }
  for (const item of packages) item.optional = optional.has(`${item.name}@${item.version}`);
  return { source, packages };
}

function dependencyIntegrity() {
  const { source, packages } = parseLockfile();
  const findings = [];
  if (!/^lockfileVersion:\s*['"]?9\.0['"]?/m.test(source)) findings.push({ rule: "LOCKFILE_VERSION", detail: "pnpm-lock.yaml is not lockfile v9" });
  if (packages.length === 0) findings.push({ rule: "LOCKFILE_PACKAGES", detail: "No package resolutions found" });
  const missingIntegrity = packages.filter((item) => item.integrity == null);
  for (const item of missingIntegrity) findings.push({ rule: "MISSING_PACKAGE_INTEGRITY", detail: `${item.name}@${item.version}` });
  const direct = { ...(packageJson.dependencies ?? {}), ...(packageJson.devDependencies ?? {}) };
  for (const [name, specifier] of Object.entries(direct)) {
    const matching = packages.find((item) => item.name === name && item.version === String(specifier).replace(/^[^0-9]*/, ""));
    if (!matching) findings.push({ rule: "DIRECT_DEPENDENCY_NOT_LOCKED", detail: `${name}@${specifier}` });
  }
  return { packageCount: packages.length, missingIntegrity: missingIntegrity.length, findings, packages };
}

function packageMetadata() {
  const result = new Map();
  const roots = [path.join(root, "node_modules")];
  const visit = (directory) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) visit(full);
      if (entry.isFile() && entry.name === "package.json") {
        try {
          const value = JSON.parse(fs.readFileSync(full, "utf8"));
          if (value.name && value.version) result.set(`${value.name}@${value.version}`, { ...value, __directory: path.dirname(full) });
        } catch { /* malformed metadata is reported by the caller when missing */ }
      }
    }
  };
  for (const directory of roots) visit(directory);
  return result;
}

function licenseAudit(lock) {
  const metadata = packageMetadata();
  const missing = [];
  const disallowed = [];
  const hasLicenseFile = (directory, depth = 0) => {
    if (depth > 2 || !fs.existsSync(directory)) return false;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (/^(?:license|copying|notice)/i.test(entry.name)) return true;
      if (entry.isDirectory() && !entry.isSymbolicLink() && hasLicenseFile(path.join(directory, entry.name), depth + 1)) return true;
    }
    return false;
  };
  for (const item of lock.packages) {
    if (item.optional || item.platformSpecific) continue;
    const packageInfo = metadata.get(`${item.name}@${item.version}`);
    if (!packageInfo) { missing.push(`${item.name}@${item.version}`); continue; }
    let licenses = Array.isArray(packageInfo.licenses) ? packageInfo.licenses.map((entry) => entry.type ?? entry) : [packageInfo.license];
    licenses = licenses.flatMap((license) => String(license ?? "").split(/\s+OR\s+|\s*\|\s*/i)).map((license) => license.replace(/[()]/g, "").trim()).filter(Boolean);
    const hasFile = hasLicenseFile(packageInfo.__directory);
    if (licenses.length === 0 && !hasFile) disallowed.push({ package: `${item.name}@${item.version}`, licenses });
    else if (licenses.length > 0 && !licenses.some((license) => allowedLicenses.has(license))) disallowed.push({ package: `${item.name}@${item.version}`, licenses });
  }
  return { installedMetadata: metadata.size, missing, disallowed };
}

function runDependencyAudit() {
  try {
    const windows = os.platform() === "win32";
    const executable = windows ? (process.env.ComSpec ?? "cmd.exe") : "pnpm";
    const args = windows ? ["/d", "/s", "/c", "pnpm audit --json"] : ["audit", "--json"];
    const output = execFileSync(executable, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return parseAudit(output);
  } catch (error) {
    const output = `${error.stdout ?? ""}\n${error.stderr ?? ""}\n${error.message ?? ""}`;
    if (output.includes("ERR_PNPM_MISSING_PACKAGE_INDEX_FILE")) return { unavailable: true, error: "pnpm audit could not read the installed package index; run frozen install first.", vulnerabilities: {} };
    try { return parseAudit(output); } catch {
      process.stderr.write(`pnpm audit raw output (diagnostic, truncated to 2000 chars):\n${output.slice(0, 2000)}\n`);
      return { unavailable: true, error: "pnpm audit did not return machine-readable output.", vulnerabilities: {} };
    }
  }
}

function parseAudit(output) {
  const start = output.indexOf("{");
  if (start < 0) throw new Error("audit JSON missing");
  // pnpm audit exits non-zero whenever it finds any vulnerabilities -- that's normal,
  // not a failure -- so the caller may hand us stdout with stderr/error.message appended
  // after the JSON. Extract only the balanced {...} object, ignoring trailing text.
  let depth = 0;
  let end = -1;
  for (let index = start; index < output.length; index += 1) {
    if (output[index] === "{") depth += 1;
    else if (output[index] === "}") { depth -= 1; if (depth === 0) { end = index; break; } }
  }
  if (end < 0) throw new Error("audit JSON missing");
  const value = JSON.parse(output.slice(start, end + 1));
  return { unavailable: false, error: null, vulnerabilities: value.metadata?.vulnerabilities ?? value.vulnerabilities ?? {} };
}

function verifyArtifacts(directory) {
  if (!directory || !fs.existsSync(directory)) return { status: "NOT_APPLICABLE", checksumStatus: "NOT_APPLICABLE", signingStatus: "NOT_APPLICABLE", findings: [], signed: "NOT_APPLICABLE", artifactCount: 0 };
  const findings = [];
  const manifestPath = path.join(directory, "build-manifest.json");
  if (!fs.existsSync(manifestPath)) return { status: "FAIL", checksumStatus: "FAIL", signingStatus: "UNKNOWN", findings: [{ rule: "MISSING_BUILD_MANIFEST" }], signed: "UNKNOWN", artifactCount: 0 };
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.capabilityDescriptor?.productionMutationAllowed !== false || manifest.capabilityDescriptor?.liveTradingEnabled !== false || manifest.capabilityDescriptor?.credentialsConfigured !== false) findings.push({ rule: "UNSAFE_RELEASE_DESCRIPTOR" });
  const checksumFile = fs.readdirSync(directory).find((name) => name.endsWith("-checksums.txt"));
  if (!checksumFile) findings.push({ rule: "MISSING_ARTIFACT_CHECKSUMS" });
  let artifactCount = 0;
  if (checksumFile) {
    for (const line of fs.readFileSync(path.join(directory, checksumFile), "utf8").split(/\r?\n/).filter(Boolean)) {
      const match = line.match(/^([a-f0-9]{64})  (.+)$/);
      if (!match) { findings.push({ rule: "INVALID_CHECKSUM_RECORD" }); continue; }
      const file = path.join(directory, match[2]);
      artifactCount += 1;
      if (!fs.existsSync(file) || sha256(file) !== match[1]) findings.push({ rule: "ARTIFACT_CHECKSUM_MISMATCH", artifact: match[2] });
    }
  }
  const signed = manifest.signing?.status === "CONFIGURED_BY_BUILD_ENV" ? "DECLARED_SIGNED" : "UNSIGNED";
  if (process.argv.includes("--artifacts") && signed !== "DECLARED_SIGNED") findings.push({ rule: "UNSIGNED_RELEASE_ARTIFACTS" });
  const checksumFindings = findings.filter((item) => item.rule.includes("CHECKSUM") || item.rule === "MISSING_BUILD_MANIFEST");
  return { status: findings.length === 0 ? "PASS" : "FAIL", checksumStatus: checksumFindings.length === 0 ? "PASS" : "FAIL", signingStatus: signed === "DECLARED_SIGNED" ? "PASS" : "FAIL", findings, signed, artifactCount };
}

function writeReports(result) {
  fs.mkdirSync(reportDir, { recursive: true });
  const vulnerabilityLines = Object.entries(result.vulnerabilities).map(([key, value]) => `- ${key}: ${value}`).join("\n") || "- None reported";
  const licenseLines = result.licenses.disallowed.map((item) => `- ${item.package}: ${item.licenses.join(", ")}`).join("\n") || "- None";
  const secretLines = result.secrets.map((item) => `- ${item.file}:${item.line} (${item.rule})`).join("\n") || "- None";
  fs.writeFileSync(path.join(reportDir, `dependency-audit-${date}.md`), `# NUSA Dependency Audit\n\nAudited: ${date}\n\n- Lockfile packages: ${result.integrity.packageCount}\n- Missing integrity records: ${result.integrity.missingIntegrity}\n- pnpm audit unavailable: ${result.audit.unavailable ? "YES" : "NO"}\n- Missing license metadata: ${result.licenses.missing.length}\n\n## Vulnerabilities\n\n${vulnerabilityLines}\n\n## License violations\n\n${licenseLines}\n\n## Missing license metadata\n\n${result.licenses.missing.map((item) => `- ${item}`).join("\\n") || "- None"}\n`);
  fs.writeFileSync(path.join(reportDir, `secret-scan-${date}.md`), `# NUSA Secret Scan\n\nAudited: ${date}\n\nNo secret values are included in this report.\n\n## Findings\n\n${secretLines}\n`);
  fs.writeFileSync(path.join(reportDir, `security-hardening-${date}.md`), `# NUSA Security Hardening Report\n\nAudited: ${date}\n\n| Gate | Result |\n|---|---|\n| Dependency vulnerability scan | ${result.audit.unavailable ? "UNVERIFIED" : result.highVulnerabilities === 0 ? "PASS" : "FAIL"} |\n| Dependency license verification | ${result.licenses.missing.length === 0 && result.licenses.disallowed.length === 0 ? "PASS" : "FAIL"} |\n| Lockfile integrity | ${result.integrity.findings.length === 0 ? "PASS" : "FAIL"} |\n| Secret scan | ${result.secrets.length === 0 ? "PASS" : "FAIL"} |\n| Artifact checksum verification | ${result.artifacts.checksumStatus} |\n| Release signing verification | ${result.artifacts.signingStatus} (${result.artifacts.signed}) |\n\n## Safety\n\n- productionMutationAllowed=false is required and checked for release manifests.\n- Live trading remains disabled.\n- Credentials are not introduced or printed.\n`);
  fs.writeFileSync(path.join(reportDir, `sbom-${date}.json`), `${JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.5", version: 1, metadata: { component: { type: "application", name: packageJson.name, version: packageJson.version }, timestamp: new Date().toISOString() }, components: result.integrity.packages.map((item) => ({ type: "library", name: item.name, version: item.version, hashes: item.integrity ? [{ alg: "SHA-512", content: item.integrity.replace(/^sha512-/, "") }] : [] })).sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)) }, null, 2)}\n`, "utf8");
}

function main() {
  const integrity = dependencyIntegrity();
  const audit = runDependencyAudit();
  const licenses = licenseAudit(integrity);
  const secrets = scanSecrets();
  const artifacts = verifyArtifacts(process.argv.includes("--artifacts") ? path.resolve(process.argv[process.argv.indexOf("--artifacts") + 1] ?? path.join(root, "release")) : null);
  const highVulnerabilities = Number(audit.vulnerabilities.high ?? 0) + Number(audit.vulnerabilities.critical ?? 0);
  const result = { integrity, audit, licenses, secrets, artifacts, vulnerabilities: audit.vulnerabilities, highVulnerabilities };
  writeReports(result);
  const failures = [];
  if (audit.unavailable) failures.push("dependency audit unavailable");
  if (highVulnerabilities > 0) failures.push(`${highVulnerabilities} high/critical vulnerabilities`);
  if (integrity.findings.length > 0) failures.push(`${integrity.findings.length} dependency integrity findings`);
  if (licenses.missing.length > 0 || licenses.disallowed.length > 0) failures.push("license verification failed");
  if (secrets.length > 0) failures.push(`${secrets.length} secret findings`);
  if (artifacts.findings.length > 0) failures.push(`${artifacts.findings.length} artifact findings`);
  console.log(JSON.stringify({ status: failures.length === 0 ? "PASS" : "FAIL", lockfilePackages: integrity.packageCount, vulnerabilities: audit.vulnerabilities, secrets: secrets.length, artifactStatus: artifacts.status, signing: artifacts.signed, failures }, null, 2));
  if (failures.length > 0) process.exit(1);
}

if (require.main === module) main();
module.exports = { scanText, baseSelector, parseLockfile, dependencyIntegrity, licenseAudit, verifyArtifacts };
