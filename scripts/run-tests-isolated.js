const { readdirSync, writeFileSync, rmSync, existsSync } = require("node:fs");
const { join, relative } = require("node:path");
const { spawnSync } = require("node:child_process");
const { resolveShardConfig, selectDeterministicShard } = require("./lib/deterministic-test-shard.js");

const testsDirectory = join(process.cwd(), "tests");
const distDirectory = join(process.cwd(), "dist");
const diagnosticPath = join(process.cwd(), "isolated-test-failure.txt");
const registerDistPath = join(testsDirectory, "register-dist.cjs");
const testFileTimeoutMs = 120_000;
rmSync(diagnosticPath, { force: true });

/**
 * Tests that live next to the code they cover compile into `dist` but are not in `tests`, so
 * scanning only `tests` silently dropped them: several such files existed, all passing, none of
 * them ever executed. Coverage nobody runs is worse than no coverage, because it reads as
 * protection that is not there. Collect them too, so a co-located test cannot be lost by virtue
 * of where it was written.
 */
function collectCompiledTests(directory) {
  if (!existsSync(directory)) return [];
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...collectCompiledTests(absolute));
    else if (entry.name.endsWith(".test.js")) found.push(relative(process.cwd(), absolute));
  }
  return found;
}

const allFiles = [
  ...readdirSync(testsDirectory)
    .filter((name) => name.endsWith(".test.js"))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => join("tests", name)),
  ...collectCompiledTests(distDirectory).sort((a, b) => a.localeCompare(b))
];

if (allFiles.length === 0) {
  const message = "No test files were found.";
  writeFileSync(diagnosticPath, message, "utf8");
  console.error(message);
  process.exit(1);
}

let shard;
try {
  shard = resolveShardConfig(process.env);
} catch (error) {
  const message = `INVALID_TEST_SHARD ${error instanceof Error ? error.message : String(error)}`;
  writeFileSync(diagnosticPath, message, "utf8");
  console.error(message);
  process.exit(1);
}
const files = selectDeterministicShard(allFiles, shard);
if (files.length === 0) {
  const message = `EMPTY_TEST_SHARD ${shard.index + 1}/${shard.count} from ${allFiles.length} test files`;
  writeFileSync(diagnosticPath, message, "utf8");
  console.error(message);
  process.exit(1);
}
if (shard.count > 1) console.log(`SHARD ${shard.index + 1}/${shard.count}: ${files.length}/${allFiles.length} isolated test files`);

for (const relativePath of files) {
  console.log(`RUN ${relativePath}`);
  const args = existsSync(registerDistPath)
    ? ["--require", registerDistPath, "--test", "--test-reporter=spec", relativePath]
    : ["--test", "--test-reporter=spec", relativePath];
  const result = spawnSync(
    process.execPath,
    args,
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env },
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      timeout: testFileTimeoutMs,
      killSignal: "SIGKILL"
    }
  );

  if (result.error) {
    const timedOut = result.error.code === "ETIMEDOUT";
    const diagnostic = [
      timedOut ? `TIMED_OUT_TEST_FILE ${relativePath} after ${testFileTimeoutMs}ms` : `FAILED_TO_START ${relativePath}`,
      `SHARD ${shard.index + 1}/${shard.count}`,
      result.stdout || "",
      result.stderr || "",
      result.error.stack || result.error.message
    ].join("\n").trimEnd();
    writeFileSync(diagnosticPath, diagnostic, "utf8");
    console.error(diagnostic);
    process.exit(1);
  }

  if (result.status !== 0) {
    const diagnostic = [
      `FAILED_TEST_FILE ${relativePath}`,
      `SHARD ${shard.index + 1}/${shard.count}`,
      result.stdout || "",
      result.stderr || ""
    ].join("\n").trimEnd();
    writeFileSync(diagnosticPath, diagnostic, "utf8");
    console.error(diagnostic);
    process.exit(result.status || 1);
  }
}

console.log(`PASS ${files.length} isolated test files${shard.count > 1 ? ` in shard ${shard.index + 1}/${shard.count}` : ""}`);
