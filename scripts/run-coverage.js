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
const produceUiE2E = process.argv.includes("--produce-ui-e2e");
const mergePrecomputed = process.argv.includes("--merge-precomputed");
const selectedModes = [reuseCoreV8, produceUiE2E, mergePrecomputed].filter(Boolean).length;
if (selectedModes > 1) throw new Error("Coverage execution modes are mutually exclusive");

const suppliedCoreV8Directory = String(process.env.NUSA_COVERAGE_CORE_V8_DIR || "").trim();
const suppliedE2EV8Directory = String(process.env.NUSA_COVERAGE_E2E_V8_DIR || "").trim();
const suppliedCombinedV8Directory = String(process.env.NUSA_COVERAGE_COMBINED_V8_DIR || "").trim();
if (reuseCoreV8 && suppliedCoreV8Directory.length === 0) throw new Error("NUSA_COVERAGE_CORE_V8_DIR is required with --reuse-core-v8");
if (produceUiE2E && suppliedE2EV8Directory.length === 0) throw new Error("NUSA_COVERAGE_E2E_V8_DIR is required with --produce-ui-e2e");
if (mergePrecomputed && suppliedCombinedV8Directory.length === 0) throw new Error("NUSA_COVERAGE_COMBINED_V8_DIR is required with --merge-precomputed");

const tempDirectory = reuseCoreV8
  ? resolve(root, suppliedCoreV8Directory)
  : produceUiE2E
    ? resolve(root, suppliedE2EV8Directory)
    : mergePrecomputed
      ? resolve(root, suppliedCombinedV8Directory)
      : join(tmpdir(), "nusa-v8-coverage");

function packageFile(prefix, packageName, file) {
  const directory = readdirSync(pnpmDirectory).find((name) => name.startsWith(`${prefix}@`));
  if (!directory) throw new Error(`Package is not installed: ${prefix}`);
  return join(pnpmDirectory, directory, "node_modules", packageName, file);
}

const typeScriptCommand = packageFile("typescript", "typescript", "bin/tsc");
const vitestCommand = packageFile("vitest", "vitest", "vitest.mjs");
const playwrightCommand = packageFile("@playwright+test", "@playwright/test", "cli.js");
const c8Command = packageFile("c8", "c8", "bin/c8.js");

main();

function main() {
  prepareDirectories();
  if (!prepared) runSetup();

  if (produceUiE2E) {
    const producerResults = runSuites(uiAndE2ESuites());
    writeFileSync(
      join(coverageDirectory, "ui-e2e-manifest.json"),
      `${JSON.stringify({
        generatedAt: new Date().toISOString(),
        repository: "NUSA",
        status: "PASS",
        prepared,
        suites: producerResults
      }, null, 2)}\n`,
      "utf8"
    );
    return;
  }

  const suites = mergePrecomputed
    ? []
    : [
        ...(reuseCoreV8 ? [] : [coreSuite()]),
        ...uiAndE2ESuites()
      ];
  const results = precomputedResults();
  results.push(...runSuites(suites));

  runCoreReport(results);
  runUnifiedReport(results);

  const summaryPath = join(coverageDirectory, "unified-summary.json");
  const summary = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, "utf8")) : null;
  writeManifest(results, "PASS", {
    prepared,
    shardedCore: reuseCoreV8 || mergePrecomputed,
    parallelUiE2E: mergePrecomputed,
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

  if (!reuseCoreV8 && !mergePrecomputed) rmSync(tempDirectory, { recursive: true, force: true });
}

function prepareDirectories() {
  if (mergePrecomputed) {
    mkdirSync(coverageDirectory, { recursive: true });
    rmSync(join(coverageDirectory, "core"), { recursive: true, force: true });
    assertRawCoverage(tempDirectory, "Precomputed combined V8 coverage directory");
    const uiCoverage = join(coverageDirectory, "ui", "coverage-final.json");
    if (!existsSync(uiCoverage)) throw new Error(`Precomputed UI coverage is missing: ${uiCoverage}`);
    return;
  }

  rmSync(coverageDirectory, { recursive: true, force: true });
  mkdirSync(coverageDirectory, { recursive: true });
  if (reuseCoreV8) {
    assertRawCoverage(tempDirectory, "Sharded core V8 coverage directory");
    return;
  }

  rmSync(tempDirectory, { recursive: true, force: true });
  mkdirSync(tempDirectory, { recursive: true });
}

function assertRawCoverage(directory, label) {
  if (!existsSync(directory)) throw new Error(`${label} is missing: ${directory}`);
  const rawCoverageFiles = readdirSync(directory).filter((name) => name.endsWith(".json"));
  if (rawCoverageFiles.length === 0) throw new Error(`${label} contains no raw coverage JSON`);
}

function runSetup() {
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

function coreSuite() {
  return {
    name: "core",
    runner: nodeCommand,
    args: [join(root, "scripts", "run-tests-isolated.js")],
    coverage: true,
    note: "Node V8 coverage for the isolated repository suite"
  };
}

function uiAndE2ESuites() {
  return [
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
}

function precomputedResults() {
  if (mergePrecomputed) {
    return [
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
        command: "GitHub Actions parallel UI coverage producer",
        startedAt: null,
        completedAt: null,
        exitCode: 0,
        coverage: "VITEST_V8",
        note: "UI coverage produced in parallel with core shards"
      },
      {
        name: "e2e",
        command: "GitHub Actions parallel E2E coverage producer",
        startedAt: null,
        completedAt: null,
        exitCode: 0,
        coverage: "NODE_V8",
        note: "Raw Node V8 E2E coverage produced in parallel with core shards"
      }
    ];
  }
  if (reuseCoreV8) {
    return [{
      name: "core",
      command: "GitHub Actions deterministic coverage-core shard matrix",
      startedAt: null,
      completedAt: null,
      exitCode: 0,
      coverage: "NODE_V8",
      note: "Raw Node V8 coverage merged from deterministic isolated-test shards"
    }];
  }
  return [];
}

function runSuites(suites) {
  const results = [];
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
  return results;
}

function runCoreReport(results) {
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
}

function runUnifiedReport(results) {
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
}

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
