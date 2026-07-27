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
 *   - The three capability flags come from a source scan. A scan can only prove PRESENCE,
 *     never absence: `liveTradingCapabilityPresent: false` means "no known live-trading
 *     pattern was found", not "this build provably cannot trade live". That distinction is
 *     recorded in the output as `capabilityEvidence.method` so a reader cannot mistake a
 *     grep for a proof.
 *   - `killSwitchReachable` is verified by locating the kill-switch entry point in the
 *     shipping source. It is NOT a runtime test; only a real drill proves reachability.
 *
 * When an `--expected-*` value is not supplied it is set equal to the observed value. That
 * makes the corresponding gate check vacuous, so the descriptor records
 * `expectationsSupplied` listing which comparisons are real. A descriptor generated with no
 * expectations can never produce ARTIFACT_HASH_MISMATCH or SOURCE_COMMIT_MISMATCH, and
 * saying so plainly is the point.
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
    /\bplaceLiveOrder\b/
  ],
  privateApiCapabilityPresent: [
    /api\.upbit\.com\/v1\/orders/,
    /api\.upbit\.com\/v1\/accounts/,
    /api\.upbit\.com\/v1\/withdraws/
  ],
  credentialStoragePresent: [
    /\b(access_key|secret_key)\b/,
    /\bUPBIT_(ACCESS|SECRET)_KEY\b/,
    /Authorization["']?\s*:\s*[`"']Bearer /
  ]
});

// No trailing \b: the identifier almost always appears as part of a longer name
// (`killSwitchActive`, `KILL_SWITCH_ENGAGED`), which a word boundary would exclude.
const KILL_SWITCH_PATTERNS = [/kill[\s_-]?switch/i, /emergency[\s_-]?stop/i];

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

/** Deterministic tree hash: sorted relative paths, each with its own content digest. */
function hashTree(root) {
  if (!fs.existsSync(root)) return null;
  const files = walk(root, () => true);
  const summary = files.map((file) => `${path.relative(root, file).split(path.sep).join("/")}:${createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`);
  return { sha256: createHash("sha256").update(summary.join("\n"), "utf8").digest("hex"), fileCount: files.length };
}

function scanCapabilities() {
  const files = SHIPPING_DIRS
    .map((dir) => path.join(REPO_ROOT, dir))
    .filter((dir) => fs.existsSync(dir))
    .flatMap((dir) => walk(dir, (file) => SOURCE_EXTENSIONS.has(path.extname(file))));

  const findings = { liveTradingCapabilityPresent: [], privateApiCapabilityPresent: [], credentialStoragePresent: [] };
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
    // Paper automation must be opt-in after every install and upgrade. This is asserted by
    // the caller because it is a runtime default, not something a source scan establishes.
    autoTradeDefaultEnabled: options.autoTradeDefaultEnabled === true,
    riskGatewayPresent: fs.existsSync(path.join(REPO_ROOT, "apps", "desktop", "src", "independentRiskGateway.ts"))
  };

  return {
    descriptor,
    provenance: {
      artifactFileCount: artifact.fileCount,
      scannedFileCount: scan.scannedFileCount,
      expectationsSupplied,
      capabilityEvidence: {
        // Stated in the artifact itself so a reader cannot mistake a scan for a proof.
        method: "STATIC_SOURCE_SCAN",
        provesAbsence: false,
        note: "A scan proves presence only. `false` means no known pattern matched, not that the capability is impossible.",
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
  if (provenance.expectationsSupplied.length === 0) {
    console.log("[deployment] no --expected-* value was supplied, so the artifact, commit, and schema comparisons are vacuous for this descriptor.");
  } else {
    console.log(`[deployment] real comparisons: ${provenance.expectationsSupplied.join(", ")}`);
  }
}

if (require.main === module) main();

module.exports = { buildDescriptor, hashTree, scanCapabilities };
