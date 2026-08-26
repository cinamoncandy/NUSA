const { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");
const { spawnSync } = require("node:child_process");

const root = process.cwd();
const coverageDirectory = join(root, "coverage");
const nodeCommand = process.execPath;
const pnpmDirectory = join(root, "node_modules", ".pnpm");
const prepared = process.argv.includes("--prepared");
const reuseCoreV8 = process.argv.includes("--reuse-core-v8");
const collectUiE2e = process.argv.includes("--collect-ui-e2e");
const finalizeCollected = process.argv.includes("--finalize-collected");
if ([reuseCoreV8, collectUiE2e, finalizeCollected].filter(Boolean).length > 1) {
  throw new Error("coverage phase flags are mutually exclusive");
}
const suppliedCoreV8Directory = String(process.env.NUSA_COVERAGE_CORE_V8_DIR || "").trim();
const suppliedE2eV8Directory = String(process.env.NUSA_COVERAGE_E2E_V8_DIR || "").trim();
if ((reuseCoreV8 || finalizeCollected) && suppliedCoreV8Directory.length === 0) {
  throw new Error("NUSA_COVERAGE_CORE_V8_DIR is required with reused/finalized core coverage");
}
if (collectUiE2e && suppliedE2eV8Directory.length === 0) {
  throw new Error("NUSA_COVERAGE_E2E_V8_DIR is required with --collect-ui-e2e");
}
const tempDirectory = collectUiE2e
  ? resolve(root, suppliedE2eV8Directory)
  : (reuseCoreV8 || finalizeCollected)
    ? resolve(root, suppliedCoreV8Directory)
    : join(tmpdir(), "nusa-v8-coverage");

function packageFile(prefix, packageName, file) {
  const directory = readdirSync(pnpmDirectory).find((name) => name.startsWith(`${prefix}@`));
  if (!directory) throw new Error(`Package is not installed: ${prefix}`);
  return join(pnpmDirectory, directory, "node_modules", packageName, file);
}

function requireRawCoverage(directory, label) {
  if (!existsSync(directory)) throw new Error(`${label} V8 coverage directory is missing: ${directory}`);
  const rawCoverageFiles = readdirSync(directory).filter((name) => name.endsWith(".json"));
  if (rawCoverageFiles.length === 0) throw new Error(`${label} V8 coverage directory contains no raw coverage JSON`);
}

const typeScriptCommand = packageFile("typescript", "typescript", "bin/tsc");
const vitestCommand = packageFile("vitest", "vitest", "vitest.mjs");
const playwrightCommand = packageFile("@playwright+test", "@playwright/test", "cli.js");
const c8Command = packageFile("c8", "c8", "bin/c8.js");

if (!finalizeCollected) {
  rmSync(coverageDirectory, { recursive: true, force: true });
  mkdirSync(coverageDirectory, { recursive: true });
} else {
  mkdirSync(coverageDirectory, { recursive: true });
  if (!existsSync(join(coverageDirectory, "ui", "lcov.info"))) {
    throw new Error("Collected UI coverage is missing coverage/ui/lcov.info");
  }
}
if (reuseCoreV8 || finalizeCollected) {
  requireRawCoverage(tempDirectory, reuseCoreV8 ? "Sharded core" : "Combined Node");
} else {
  rmSync(tempDirectory, { recursive: true, force: true });
  mkdirSync(tempDirectory, { recursive: true });
}

if (!prepared) {
  for (const args of [
    [join(root, "scripts", "check-runtime.js")],
    [join(root, "scripts", "validate-repository-portability.js")]
  ]) {
    const setup = spawnSync(nodeCommand, args, { cwd: root, encoding: "utf8", stdio: "inherit", windowsHide: true });
    if (setup.error || setup.status !== 0) process.exit(setup.status || 1);
  }
  const build = spawnSync(nodeCommand, [typeScriptCommand, "-p", "tsconfig.json"], {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
    windowsHide: true
  });
  if (build.error || build.status !== 0) process.exit(build.status || 1);
}

const suites = finalizeCollected ? [] : [
  ...(reuseCoreV8 || collectUiE2e ? [] : [{
    name: "core",
    runner: nodeCommand,
    args: [join(root, "scripts", "run-tests-isolated.js")],
    coverage: true,
    note: "Node V8 coverage for the isolated repository suite"
  }]),
  {
    name: "ui",
    runner: nodeCommand,
    args: [
      vitestCommand,
      "run",
      "--config",
      "vitest.config.mjs",
      "--coverage",
      "--coverage.provider=v8",
      "--coverage.reportsDirectory=coverage/ui",
      "--coverage.reporter=json",
      "--coverage.reporter=json-summary",
      "--coverage.reporter=lcov",
      "--coverage.reporter=html"
    ],
    coverage: false,
    note: "Vitest V8 provider; NODE_V8_COVERAGE is disabled because esbuild cannot start under it on this Windows path"
  },
  {
    name: "e2e",
    runner: nodeCommand,
    args: [playwrightCommand, "test"],
    coverage: true,
    note: "Node V8 coverage for the Playwright server process; Chromium page coverage is unavailable"
  }
];
const results = reuseCoreV8 ? [{
  name: "core",
  command: "GitHub Actions deterministic coverage-core shard matrix",
  startedAt: null,
  completedAt: null,
  exitCode: 0,
  coverage: "NODE_V8",
  note: "Raw Node V8 coverage merged from deterministic isolated-test shards"
}] : finalizeCollected ? [
  {
    name: "core",
    command: "GitHub Actions deterministic coverage-core shard matrix",
    startedAt: null,
    completedAt: null,
    exitCode: 0,
    coverage: "NODE_V8",
    note: "Raw Node V8 coverage merged from deterministic isolated-test shards"
  },
  {
    name: "ui",
    command: "GitHub Actions coverage-ui-e2e collector",
    startedAt: null,
    completedAt: null,
    exitCode: 0,
    coverage: "VITEST_V8",
    note: "Collected in parallel with isolated core coverage"
  },
  {
    name: "e2e",
    command: "GitHub Actions coverage-ui-e2e collector",
    startedAt: null,
    completedAt: null,
    exitCode: 0,
    coverage: "NODE_V8",
    note: "Raw Node V8 coverage collected in parallel with isolated core coverage"
  }
] : [];

for (const suite of suites) {
  const startedAt = new Date().toISOString();
  const environment = { ...process.env };
  delete environment.NODE_V8_COVERAGE;
  if (suite.coverage) environment.NODE_V8_COVERAGE = tempDirectory;

  const result = spawnSync(suite.runner, suite.args, {
    cwd: root,
    env: environment,
    encoding: "utf8",
    stdio: "inherit",
    shell: false,
    windowsHide: true
  });
  const completedAt = new Date().toISOString();
  results.push({
    name: suite.name,
    command: `${suite.runner === nodeCommand ? "node" : "pnpm"} ${suite.args.join(" ")}`,
    startedAt,
    completedAt,
    exitCode: result.status ?? 1,
    coverage: suite.coverage ? "NODE_V8" : "VITEST_V8",
    note: suite.note
  });
  if (result.error || result.status !== 0) {
    writeManifest(results, "FAIL");
    process.exit(result.status || 1);
  }
}

if (collectUiE2e) {
  requireRawCoverage(tempDirectory, "E2E");
  writeFileSync(
    join(coverageDirectory, "ui-e2e-phase.json"),
    `${JSON.stringify({ status: "PASS", prepared, suites: results }, null, 2)}\n`,
    "utf8"
  );
  process.stdout.write("PASS collected UI and E2E coverage for parallel aggregation\n");
  process.exit(0);
}

const report = spawnSync(
  nodeCommand,
  [
    c8Command,
    "report",
    "--config",
    ".c8rc.json",
    "--temp-directory",
    tempDirectory,
    "--report-dir",
    "coverage/core",
    "--reporter",
    "text",
    "--reporter",
    "json",
    "--reporter",
    "json-summary",
    "--reporter",
    "lcov",
    "--reporter",
    "html"
  ],
  {
    cwd: root,
    env: { ...process.env },
    encoding: "utf8",
    stdio: "inherit",
    shell: false,
    windowsHide: true
  }
);

if (report.error || report.status !== 0) {
  writeManifest(results, "FAIL");
  process.exit(report.status || 1);
}

const unified = spawnSync(process.execPath, [join(root, "scripts", "create-unified-coverage-report.js")], {
  cwd: root,
  env: { ...process.env },
  encoding: "utf8",
  stdio: "inherit",
  windowsHide: true
});
if (unified.error || unified.status !== 0) {
  writeManifest(results, "FAIL");
  process.exit(unified.status || 1);
}

const summaryPath = join(coverageDirectory, "unified-summary.json");
const summary = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, "utf8")) : null;
writeManifest(results, "PASS", {
  prepared,
  shardedCore: reuseCoreV8 || finalizeCollected,
  parallelUiE2e: finalizeCollected,
  summary,
  reportFiles: [
    "coverage/unified-report.md",
    "coverage/unified-summary.json",
    "coverage/core/index.html",
    "coverage/ui/index.html",
    "coverage/unified-lcov.info",
    "coverage/badge.svg"
  ],
  browserCoverage: "NOT_AVAILABLE: Playwright runs application code inside Chromium; the current static-server E2E has no browser instrumentation."
});

if (!reuseCoreV8 && !finalizeCollected) rmSync(tempDirectory, { recursive: true, force: true });

function writeManifest(suiteResults, status, extra = {}) {
  mkdirSync(coverageDirectory, { recursive: true });
  writeFileSync(
    join(coverageDirectory, "baseline-manifest.json"),
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      repository: "NUSA",
      status,
      prepared,
      ...extra,
      suites: suiteResults
    }, null, 2)}\n`,
    "utf8"
  );
}
