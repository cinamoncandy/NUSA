#!/usr/bin/env node
"use strict";
/**
 * Produces a `DeploymentSafetyDescriptor` (WO-0032) from the repository as it actually is,
 * so the deployment safety gate is fed measurements rather than assertions.
 *
 * Usage:
 *   node scripts/build-deployment-descriptor.js --dist dist --output <descriptor.json> \
 *        [--expected-artifact <sha256>] [--expected-commit <sha>] [--expected-schema <n>]
 *
 * What it measures, and what it does not:
 *
 *   - `artifactSha256` is a real deterministic hash of the built tree (sorted relative
 *     paths + per-file digests), not a placeholder.
 *   - `sourceCommitSha` comes from git.
 *   - Capability flags come from a source scan. A scan can only prove PRESENCE, never
 *     absence. Read-only authenticated observation is recorded separately from economic
 *     mutation capability so adding account reconciliation does not masquerade as an
 *     enabled live-order path.
 *   - `killSwitchReachable` is verified by locating the kill-switch entry point in the
 *     shipping source. It is NOT a runtime test; only a real drill proves reachability.
 *
 * When an `--expected-*` value is not supplied it is set equal to the observed value. That
 * makes the corresponding gate check vacuous, so the descriptor records
 * `expectationsSupplied` listing which comparisons are real.
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");

const REPO_ROOT = path.resolve(__dirname, "..");

/** Patterns that indicate a real capability, not a mention of one. */
const CAPABILITY_PATTERNS = Object.freeze({
  liveTradingCapabilityPresent: [
    /\bLIVE_TRADING\s*[:=]\s*true\b/,
    /\btradingMode\s*[:=]\s*["']LIVE["']/,
    /\bplaceLiveOrder\b/,
    /\bsubmitOrder\s*\([^)]*\)\s*\{(?![\s\S]{0,240}LiveMutationDisabledError)/
  ],
  // Authenticated reads are useful for reconciliation but do not mutate exchange state.
  readOnlyPrivateApiCapabilityPresent: [
    /\bgetAccounts\s*\(/,
    /\bgetOpenOrders\s*\(/,
    /\bgetOrder\s*\(/,
    /["']\/v1\/accounts["']/,
    /["']\/v1\/orders["']/,
    /["']\/v1\/order["']/
  ],
  // This descriptor field is intentionally mutation-oriented for the Paper deployment gate.
  privateApiCapabilityPresent: [
    /["']POST["'][\s\S]{0,180}["']\/v1\/orders["']/,
    /["']DELETE["'][\s\S]{0,180}["']\/v1\/order["']/,
    /["']POST["'][\s\S]{0,180}["']\/v1\/withdraws/,
    /\bplaceLiveOrder\b/
  ],
  // Detect persistence or retrieval of secrets, not ordinary in-memory JWT construction.
  credentialStoragePresent: [
    /\bkeytar\b/,
    /\bcredential(Store|Vault)\b/i,
    /\b(writeFile|writeFileSync|setItem)\s*\([^\n]{0,160}(access[_-]?key|secret[_-]?key|credential)/i,
    /\bUPBIT_(ACCESS|SECRET)_KEY\b[\s\S]{0,120}\b(writeFile|setItem|store|persist)\b/i
  ]
});

// Matching the words "kill switch" anywhere finds the renderer's read-only status label just as
// easily as an actual control, and on this tree that is exactly what happened: the descriptor
// reported killSwitchReachable: true on the strength of a display string, while no code path
// could set the switch at all. Require something that actually flips it -- an activation call,
// an assignment, or an IPC channel that reaches one.
const KILL_SWITCH_PATTERNS = [
  /\bkillSwitch\s*\.\s*trigger\s*\(/,
  /\btrigger(?:Many)?\s*\(\s*["'`](?:MANUAL_STOP|EXCHANGE_DISCONNECT|DAILY_LOSS_EXCEEDED|EXPOSURE_EXCEEDED|API_FAILURE|UNKNOWN_SUBMISSION|RECONCILIATION_FAILURE|BALANCE_MISMATCH)["'`]/,
  /\b(?:activate|engage|pull)KillSwitch\s*\(/,
  /\bkillSwitch(?:Active)?\s*=\s*true\b/,
  /ipcMain\s*\.\s*handle\s*\(\s*["'`][^"'`]*kill[\s_-]?switch/i
];
const SHIPPING_DIRS = ["apps", "packages"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

function walk(root, filter) {
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        stack.push(full);
      } else if (entry.isFile() && filter(full)) {
        out.push(full);
      }
    }
  }
  return out.sort();
}

function hashTree(root) {
  if (!fs.existsSync(root)) return null;
  const files = walk(root, () => true);
  const summary = files.map((file) => `${path.relative(root, file).split(path.sep).join("/")}:${createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`);
  return { sha256: createHash("sha256").update(summary.join("\n"), "utf8").digest("hex"), fileCount: files.length };
}

// `root` exists so the scanner can be exercised against a fixture tree. Without it the only way
// to test a detection rule is to add matching code to the repository itself, which is how a rule
// ends up verified by the thing it is supposed to be judging.
function scanCapabilities(root = REPO_ROOT) {
  const files = SHIPPING_DIRS
    .map((dir) => path.join(root, dir))
    .filter((dir) => fs.existsSync(dir))
    .flatMap((dir) => walk(dir, (file) => {
      if (!SOURCE_EXTENSIONS.has(path.extname(file))) return false;
      return !/\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
    }));

  const findings = {
    liveTradingCapabilityPresent: [],
    readOnlyPrivateApiCapabilityPresent: [],
    privateApiCapabilityPresent: [],
    credentialStoragePresent: []
  };
  let killSwitchReachable = false;

  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const relative = path.relative(REPO_ROOT, file).split(path.sep).join("/");
    for (const [flag, patterns] of Object.entries(CAPABILITY_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(text)) findings[flag].push({ file: relative, pattern: String(pattern) });
      }
    }
    if (!killSwitchReachable && KILL_SWITCH_PATTERNS.some((pattern) => pattern.test(text))) killSwitchReachable = true;
  }

  return { findings, killSwitchReachable, scannedFileCount: files.length };
}

function gitCommitSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index].startsWith("--")) {
      args[argv[index].slice(2)] = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function buildDescriptor(options = {}) {
  const distRoot = path.resolve(REPO_ROOT, options.dist ?? "dist");
  const artifact = hashTree(distRoot);
  if (artifact === null) throw new Error(`build output not found at ${distRoot}; run the build before generating a descriptor`);

  const commit = gitCommitSha();
  if (commit === null) throw new Error("could not read the source commit from git");

  const scan = scanCapabilities();
  const schemaVersion = Number.isInteger(options.persistenceSchemaVersion) ? options.persistenceSchemaVersion : 1;

  const expectationsSupplied = [];
  if (options.expectedArtifactSha256) expectationsSupplied.push("artifactSha256");
  if (options.expectedSourceCommitSha) expectationsSupplied.push("sourceCommitSha");
  if (Number.isInteger(options.expectedPersistenceSchemaVersion)) expectationsSupplied.push("persistenceSchemaVersion");

  const descriptor = {
    schemaVersion: 1,
    deploymentId: `${commit.slice(0, 12)}-${artifact.sha256.slice(0, 12)}`,
    sourceCommitSha: commit,
    expectedSourceCommitSha: options.expectedSourceCommitSha ?? commit,
    artifactSha256: artifact.sha256,
    expectedArtifactSha256: options.expectedArtifactSha256 ?? artifact.sha256,
    persistenceSchemaVersion: schemaVersion,
    expectedPersistenceSchemaVersion: Number.isInteger(options.expectedPersistenceSchemaVersion) ? options.expectedPersistenceSchemaVersion : schemaVersion,
    liveTradingCapabilityPresent: scan.findings.liveTradingCapabilityPresent.length > 0,
    privateApiCapabilityPresent: scan.findings.privateApiCapabilityPresent.length > 0,
    credentialStoragePresent: scan.findings.credentialStoragePresent.length > 0,
    killSwitchReachable: scan.killSwitchReachable,
    autoTradeDefaultEnabled: options.autoTradeDefaultEnabled === true,
    riskGatewayPresent: fs.existsSync(path.join(REPO_ROOT, "apps", "desktop", "src", "risk", "independentRiskGateway.ts"))
  };

  return {
    descriptor,
    provenance: {
      artifactFileCount: artifact.fileCount,
      scannedFileCount: scan.scannedFileCount,
      expectationsSupplied,
      capabilityEvidence: {
        method: "STATIC_SOURCE_SCAN",
        provesAbsence: false,
        note: "A scan proves presence only. Read-only authenticated observation is recorded separately from exchange mutation and credential persistence.",
        findings: scan.findings
      },
      killSwitchEvidence: {
        method: "STATIC_SOURCE_SCAN",
        provesRuntimeReachability: false,
        note: "Locating the kill-switch entry point is not a drill. Only an executed kill-switch drill proves reachability."
      }
    }
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.output) {
    console.error("usage: node scripts/build-deployment-descriptor.js --output <descriptor.json> [--dist dist] [--expected-artifact <sha256>] [--expected-commit <sha>] [--expected-schema <n>]");
    process.exitCode = 1;
    return;
  }
  if (fs.existsSync(args.output)) {
    console.error(`refusing to overwrite existing output file: ${args.output}`);
    process.exitCode = 1;
    return;
  }

  const built = buildDescriptor({
    dist: args.dist,
    expectedArtifactSha256: args["expected-artifact"],
    expectedSourceCommitSha: args["expected-commit"],
    expectedPersistenceSchemaVersion: args["expected-schema"] === undefined ? undefined : Number(args["expected-schema"]),
    autoTradeDefaultEnabled: args["auto-trade-default"] === "true"
  });

  fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
  fs.writeFileSync(args.output, JSON.stringify(built, null, 2));

  const { descriptor, provenance } = built;
  console.log(`[deployment] artifact ${descriptor.artifactSha256.slice(0, 16)} over ${provenance.artifactFileCount} files`);
  console.log(`[deployment] commit ${descriptor.sourceCommitSha.slice(0, 12)}; scanned ${provenance.scannedFileCount} source files`);
  for (const flag of ["liveTradingCapabilityPresent", "privateApiCapabilityPresent", "credentialStoragePresent"]) {
    console.log(`[deployment] ${flag}: ${descriptor[flag]}`);
  }
  console.log(`[deployment] readOnlyPrivateApiCapabilityPresent: ${provenance.capabilityEvidence.findings.readOnlyPrivateApiCapabilityPresent.length > 0}`);
  if (provenance.expectationsSupplied.length === 0) {
    console.log("[deployment] no --expected-* value was supplied, so the artifact, commit, and schema comparisons are vacuous for this descriptor.");
  } else {
    console.log(`[deployment] real comparisons: ${provenance.expectationsSupplied.join(", ")}`);
  }

  // The release boundary is Paper/Shadow only (README, "Release boundary"). A descriptor is
  // worthless as a gate if it can report a dangerous capability and still exit 0 -- CI would
  // keep going green while the invariant it exists to check quietly stopped holding.
  const dangerous = ["liveTradingCapabilityPresent", "privateApiCapabilityPresent", "credentialStoragePresent"].filter((flag) => descriptor[flag]);
  if (dangerous.length > 0) {
    console.error(`[deployment] FAIL: forbidden capability present: ${dangerous.join(", ")}`);
    for (const flag of dangerous) {
      for (const finding of provenance.capabilityEvidence.findings[flag]) console.error(`  - ${flag}: ${finding.file} matched ${finding.pattern}`);
    }
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { buildDescriptor, hashTree, scanCapabilities };
