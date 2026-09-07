"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const core = require("./security-gate.js");
const { verifyBackports } = require("./security-backports.js");

const root = path.resolve(__dirname, "..");
const reportDir = path.join(root, "docs", "audits");
const date = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const COMPENSATED = Object.freeze({
  "1138808": { package: "image-size", ghsa: "GHSA-w3rx-r6r6-pgpr" },
  "1138809": { package: "image-size", ghsa: "GHSA-5p2g-fcmc-qvqq" },
  "1138813": { package: "nanoid", ghsa: "GHSA-2v37-7h3g-55p8" }
});

function parseJsonObject(output) {
  const start = output.indexOf("{");
  if (start < 0) throw new Error("AUDIT_JSON_MISSING");
  let depth = 0;
  for (let index = start; index < output.length; index += 1) {
    if (output[index] === "{") depth += 1;
    else if (output[index] === "}" && --depth === 0) return JSON.parse(output.slice(start, index + 1));
  }
  throw new Error("AUDIT_JSON_INCOMPLETE");
}

function parseAuditResult(output) {
  const value = parseJsonObject(output);
  if (value && typeof value === "object" && value.error) {
    throw new Error(`AUDIT_UNAVAILABLE:${value.error.code ?? "unknown"}`);
  }
  return value;
}

function audit() {
  try {
    const windows = os.platform() === "win32";
    const executable = windows ? (process.env.ComSpec ?? "cmd.exe") : "pnpm";
    const args = windows ? ["/d", "/s", "/c", "pnpm audit --json"] : ["audit", "--json"];
    const output = execFileSync(executable, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return parseAuditResult(output);
  } catch (error) {
    const output = String(error.stdout ?? "");
    if (!output.includes("{")) throw error;
    return parseAuditResult(output);
  }
}

function trackedSecrets() {
  let files = [];
  try { files = execFileSync("git", ["ls-files", "-z"], { cwd: root }).toString("utf8").split("\0").filter(Boolean); } catch { return [{ file: "<git>", line: 0, rule: "TRACKED_FILES_UNAVAILABLE" }]; }
  const ignored = /(^|[\\/])(\.git|node_modules|dist|coverage|release|storybook-static|test-results|\.pnpm-store|\.tmp-nusa-install)([\\/]|$)/;
  const extensions = new Set([".cjs", ".cfg", ".css", ".env", ".html", ".ini", ".js", ".json", ".md", ".mjs", ".ts", ".toml", ".txt", ".yaml", ".yml"]);
  const findings = [];
  for (const relative of files) {
    if (ignored.test(relative) || !extensions.has(path.extname(relative).toLowerCase())) continue;
    const full = path.join(root, relative);
    const bytes = fs.readFileSync(full);
    if (bytes.includes(0)) continue;
    findings.push(...core.scanText(bytes.toString("utf8"), relative));
  }
  return findings;
}

function evaluateAudit(value, backports) {
  const advisories = value.advisories ?? {};
  const metadata = value.metadata?.vulnerabilities ?? {};
  const rawHighCritical = Number(metadata.high ?? 0) + Number(metadata.critical ?? 0);
  const highCriticalEntries = Object.entries(advisories).filter(([, advisory]) => ["high", "critical"].includes(String(advisory.severity).toLowerCase()));
  const mitigated = [];
  const unmitigated = [];
  for (const [id, advisory] of highCriticalEntries) {
    const expected = COMPENSATED[String(id)];
    const controlPass = expected && advisory.module_name === expected.package && backports.controls[expected.ghsa] === true;
    if (controlPass) mitigated.push({ id: String(id), package: expected.package, ghsa: expected.ghsa });
    else unmitigated.push({ id: String(id), package: advisory.module_name ?? "unknown", severity: advisory.severity ?? "unknown" });
  }
  const shapeMismatch = rawHighCritical !== highCriticalEntries.length;
  return { metadata, rawHighCritical, mitigated, unmitigated, shapeMismatch };
}

function writeReports(result) {
  fs.mkdirSync(reportDir, { recursive: true });
  const mitigated = result.audit.mitigated.map((item) => `- ${item.ghsa} (${item.package}, audit id ${item.id}): exact source backport verified`).join("\n") || "- None";
  const unmitigated = result.audit.unmitigated.map((item) => `- audit id ${item.id}: ${item.package} (${item.severity})`).join("\n") || "- None";
  const licenseLines = result.licenses.disallowed.map((item) => `- ${item.package}: ${item.licenses.join(", ")}`).join("\n") || "- None";
  const secretLines = result.secrets.map((item) => `- ${item.file}:${item.line} (${item.rule})`).join("\n") || "- None";
  fs.writeFileSync(path.join(reportDir, `dependency-audit-${date}.md`), `# NUSA Dependency Audit\n\nAudited: ${date}\n\n- Lockfile packages: ${result.integrity.packageCount}\n- Raw high/critical advisories: ${result.audit.rawHighCritical}\n- Verified compensating controls: ${result.audit.mitigated.length}\n- Unmitigated high/critical advisories: ${result.audit.unmitigated.length}\n- Audit shape mismatch: ${result.audit.shapeMismatch ? "YES" : "NO"}\n\n## Verified source backports\n\n${mitigated}\n\n## Unmitigated high/critical\n\n${unmitigated}\n\n## License violations\n\n${licenseLines}\n`);
  fs.writeFileSync(path.join(reportDir, `secret-scan-${date}.md`), `# NUSA Secret Scan\n\nAudited: ${date}\n\nNo secret values are included in this report.\n\n## Findings\n\n${secretLines}\n`);
  fs.writeFileSync(path.join(reportDir, `security-hardening-${date}.md`), `# NUSA Security Hardening Report\n\nAudited: ${date}\n\n| Gate | Result |\n|---|---|\n| Dependency vulnerability scan | ${result.audit.unmitigated.length === 0 && !result.audit.shapeMismatch && result.backports.status === "PASS" ? "PASS" : "FAIL"} |\n| Exact dependency backports | ${result.backports.status} |\n| Dependency license verification | ${result.licenses.missing.length === 0 && result.licenses.disallowed.length === 0 ? "PASS" : "FAIL"} |\n| Lockfile integrity | ${result.integrity.findings.length === 0 ? "PASS" : "FAIL"} |\n| Secret scan | ${result.secrets.length === 0 ? "PASS" : "FAIL"} |\n| Artifact checksum verification | ${result.artifacts.checksumStatus} |\n| Release signing verification | ${result.artifacts.signingStatus} (${result.artifacts.signed}) |\n\n## Compensating controls\n\n${mitigated}\n\nAny advisory outside the exact mapped IDs/packages above remains blocking. A source-shape or version mismatch fails closed.\n\n## Safety\n\n- productionMutationAllowed=false remains required for release manifests.\n- Live trading remains disabled.\n- Credentials are not introduced or printed.\n`);
  fs.writeFileSync(path.join(reportDir, `sbom-${date}.json`), `${JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.5", version: 1, metadata: { component: { type: "application", name: packageJson.name, version: packageJson.version }, timestamp: new Date().toISOString(), properties: [{ name: "nusa:security-backports", value: JSON.stringify(result.audit.mitigated) }] }, components: result.integrity.packages.map((item) => ({ type: "library", name: item.name, version: item.version, hashes: item.integrity ? [{ alg: "SHA-512", content: item.integrity.replace(/^sha512-/, "") }] : [] })).sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)) }, null, 2)}\n`, "utf8");
}

function main() {
  const backports = verifyBackports();
  const integrity = core.dependencyIntegrity();
  const licenses = core.licenseAudit(integrity);
  const secrets = trackedSecrets();
  const artifacts = core.verifyArtifacts(process.argv.includes("--artifacts") ? path.resolve(process.argv[process.argv.indexOf("--artifacts") + 1] ?? path.join(root, "release")) : null);
  let rawAudit;
  try { rawAudit = audit(); } catch (error) { console.error(`[security-gate] dependency audit unavailable: ${error.message}`); process.exit(1); }
  const auditResult = evaluateAudit(rawAudit, backports);
  const result = { backports, integrity, licenses, secrets, artifacts, audit: auditResult };
  writeReports(result);
  const failures = [];
  if (backports.status !== "PASS") failures.push(`security backports failed: ${backports.findings.join(",")}`);
  if (auditResult.shapeMismatch) failures.push("dependency audit advisory/metadata shape mismatch");
  if (auditResult.unmitigated.length > 0) failures.push(`${auditResult.unmitigated.length} unmitigated high/critical vulnerabilities`);
  if (integrity.findings.length > 0) failures.push(`${integrity.findings.length} dependency integrity findings`);
  if (licenses.missing.length > 0 || licenses.disallowed.length > 0) failures.push("license verification failed");
  if (secrets.length > 0) failures.push(`${secrets.length} secret findings`);
  if (artifacts.findings.length > 0) failures.push(`${artifacts.findings.length} artifact findings`);
  console.log(JSON.stringify({ status: failures.length === 0 ? "PASS" : "FAIL", rawHighCritical: auditResult.rawHighCritical, mitigated: auditResult.mitigated, unmitigated: auditResult.unmitigated, backports: backports.status, secrets: secrets.length, artifactStatus: artifacts.status, signing: artifacts.signed, failures }, null, 2));
  if (failures.length > 0) process.exit(1);
}

if (require.main === module) main();
module.exports = { parseJsonObject, parseAuditResult, evaluateAudit };
