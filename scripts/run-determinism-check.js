const { createHash } = require("node:crypto");
const { existsSync, readdirSync, readFileSync, statSync, writeFileSync } = require("node:fs");
const { join, relative } = require("node:path");
const { spawnSync } = require("node:child_process");

const root = process.cwd();
const runs = Number(process.env.NUSA_DETERMINISM_RUNS || 10);
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const commands = [
  ["typecheck", "run", "typecheck"],
  ["build", "run", "build"],
  ["lint", "run", "lint"],
  ["full-tests", "test"],
  ["ui-tests", "run", "test:ui"],
  ["e2e-tests", "run", "test:e2e"],
  ["coverage", "run", "coverage"]
];

if (!Number.isInteger(runs) || runs < 1) throw new Error("NUSA_DETERMINISM_RUNS must be a positive integer");

const results = [];
for (let run = 1; run <= runs; run += 1) {
  const runResults = [];
  for (const [name, ...args] of commands) {
    const started = Date.now();
    const result = spawnSync(packageManager, args, {
      cwd: root,
      env: { ...process.env, CI: "true", TZ: "UTC", NUSA_TEST_SEED: "0" },
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      timeout: 10 * 60 * 1000,
      shell: process.platform === "win32",
      windowsHide: true
    });
    const output = `${result.stdout || ""}\n${result.stderr || ""}\n${result.error?.stack || ""}`;
    runResults.push({
      name,
      command: `${packageManager} ${args.join(" ")}`,
      exitCode: result.error ? 1 : result.status ?? 1,
      durationMs: Date.now() - started,
      passCount: count(output, /(?:Tests|tests|Test Files|test files)\s+(\d+)\s+passed/g),
      failCount: count(output, /(?:Tests|tests|Test Files|test files)\s+(\d+)\s+failed/g),
      isolatedFiles: matchNumber(output, /PASS\s+(\d+) isolated test files/),
      failureTail: result.error || result.status !== 0 ? output.trim().slice(-4000) : undefined
    });
  }

  const coverage = readCoverage();
  const passed = runResults.every((item) => item.exitCode === 0);
  results.push({
    run,
    commands: runResults,
    passed,
    buildHash: hashTree(join(root, "dist")),
    coverage,
    artifactSignature: coverage?.artifacts?.join("|") || null
  });
  console.log(`DETERMINISM RUN ${run}/${runs}: ${passed ? "PASS" : "FAIL"}`);
}

const comparison = compareRuns(results);
const reportDate = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
const reportPath = join(root, "docs", "audits", `deterministic-execution-${reportDate}.md`);
writeFileSync(reportPath, markdown(results, comparison), "utf8");
console.log(`Report: ${relative(root, reportPath)}`);
if (!comparison.pass) process.exit(1);

function readCoverage() {
  const summaryPath = join(root, "coverage", "unified-summary.json");
  const manifestPath = join(root, "coverage", "baseline-manifest.json");
  if (!existsSync(summaryPath) || !existsSync(manifestPath)) return null;
  const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  return {
    statements: summary.totals.statements.pct,
    branches: summary.totals.branches.pct,
    functions: summary.totals.functions.pct,
    lines: summary.totals.lines.pct,
    status: manifest.status,
    artifacts: [...(manifest.reportFiles || [])].sort()
  };
}

function hashTree(directory) {
  if (!existsSync(directory)) return null;
  const hash = createHash("sha256");
  for (const file of files(directory).sort()) {
    hash.update(relative(directory, file).replaceAll("\\", "/"));
    hash.update(readFileSync(file));
  }
  return hash.digest("hex");
}

function files(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

function count(text, pattern) {
  return [...text.matchAll(pattern)].reduce((sum, match) => sum + Number(match[1]), 0) || null;
}

function matchNumber(text, pattern) {
  const match = text.match(pattern);
  return match ? Number(match[1]) : null;
}

function compareRuns(allRuns) {
  const signatures = allRuns.map((run) => JSON.stringify({
    passed: run.passed,
    commands: run.commands.map((command) => ({ name: command.name, exitCode: command.exitCode, passCount: command.passCount, failCount: command.failCount, isolatedFiles: command.isolatedFiles })),
    buildHash: run.buildHash,
    coverage: run.coverage,
    artifactSignature: run.artifactSignature
  }));
  return {
    pass: signatures.length === runs && allRuns.every((run) => run.passed) && signatures.every((signature) => signature === signatures[0]),
    signatures
  };
}

function markdown(allRuns, comparison) {
  const first = allRuns[0];
  const rows = allRuns.map((run) => `| ${run.run} | ${run.passed ? "PASS" : "FAIL"} | ${run.buildHash || "unavailable"} | ${run.coverage?.statements ?? "unavailable"} | ${run.coverage?.branches ?? "unavailable"} | ${run.coverage?.functions ?? "unavailable"} | ${run.coverage?.lines ?? "unavailable"} |`).join("\n");
  const failures = allRuns.flatMap((run) => run.commands.filter((command) => command.failureTail).map((command) => `### Run ${run.run}: ${command.name}\n\n` + "```text\n" + command.failureTail + "\n```" )).join("\n\n");
  return `# NUSA Deterministic Execution Report\n\nGenerated: ${new Date().toISOString()}\nRuns: ${runs}\nEnvironment: Node ${process.version}, platform ${process.platform}, architecture ${process.arch}, TZ=UTC, NUSA_TEST_SEED=0\n\n## Verdict\n\n${comparison.pass ? "PASS: all repeated command, coverage, build, and artifact signatures are identical." : "FAIL: repeated execution produced different results or a command failure."}\n\n## Repeated results\n\n| Run | Result | Build SHA-256 | Statements | Branches | Functions | Lines |\n|---:|---|---|---:|---:|---:|---:|\n${rows}\n\n## Baseline\n\n${first?.coverage ? `Coverage artifacts: ${first.coverage.artifacts.join(", ")}\n\nArtifact status: ${first.coverage.status}` : "Coverage artifact was not produced."}\n\n## Controls\n\n- Test files are executed in sorted order by the isolated runner.\n- CI, UTC, and a fixed test seed are injected for every command.\n- Build reproducibility is checked with a SHA-256 hash of the complete dist tree.\n- Coverage reproducibility is checked using all four aggregate metrics and the artifact manifest.\n- Browser page execution remains separate from Node/Vitest coverage.\n${failures ? `\n## Failures\n\n${failures}` : ""}\n`;
}
