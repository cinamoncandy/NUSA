const { readdirSync, writeFileSync, rmSync, existsSync } = require("node:fs");
const { join } = require("node:path");
const { spawn } = require("node:child_process");
const os = require("node:os");

const testsDirectory = join(process.cwd(), "tests");
const diagnosticPath = join(process.cwd(), "isolated-test-failure.txt");
const registerDistPath = join(testsDirectory, "register-dist.cjs");
rmSync(diagnosticPath, { force: true });

const files = readdirSync(testsDirectory)
  .filter((name) => name.endsWith(".test.js"))
  .sort((a, b) => a.localeCompare(b));

if (files.length === 0) {
  const message = "No test files were found.";
  writeFileSync(diagnosticPath, message, "utf8");
  console.error(message);
  process.exit(1);
}

// Each file still runs in its own fresh Node process -- same isolation guarantee
// as before (module-level state, e.g. in-memory credential sessions, must not
// leak between test files). Only the scheduling changed: N processes run
// concurrently instead of one at a time, bounded by CPU count so this doesn't
// oversubscribe a small runner. Override with NUSA_TEST_CONCURRENCY for CI tuning.
const concurrency = Math.max(1, Number(process.env.NUSA_TEST_CONCURRENCY) || os.cpus().length);

function runOne(file) {
  const relativePath = join("tests", file);
  const args = existsSync(registerDistPath)
    ? ["--require", registerDistPath, "--test", "--test-reporter=spec", relativePath]
    : ["--test", "--test-reporter=spec", relativePath];
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(process.execPath, args, { cwd: process.cwd(), windowsHide: true, env: process.env });
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      resolve({ relativePath, status: null, stdout, stderr, spawnError: error });
    });
    child.on("close", (status) => {
      resolve({ relativePath, status, stdout, stderr, spawnError: null });
    });
  });
}

async function main() {
  const queue = [...files];
  let failure = null;
  let completed = 0;

  async function worker() {
    while (queue.length > 0 && failure === null) {
      const file = queue.shift();
      if (file === undefined) return;
      console.log(`RUN ${join("tests", file)}`);
      const result = await runOne(file);
      completed += 1;

      if (result.spawnError) {
        failure = failure ?? {
          diagnostic: [`FAILED_TO_START ${result.relativePath}`, result.spawnError.stack || result.spawnError.message].join("\n")
        };
        continue;
      }
      if (result.status !== 0) {
        failure = failure ?? {
          diagnostic: [`FAILED_TEST_FILE ${result.relativePath}`, result.stdout || "", result.stderr || ""].join("\n").trimEnd(),
          status: result.status || 1
        };
      }
    }
  }

  // Bounded worker pool: each slot pulls the next file off the queue as soon as
  // it's free, so total wall time tracks the slowest lane rather than the sum
  // of every file.
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, () => worker()));

  if (failure) {
    console.error(failure.diagnostic);
    writeFileSync(diagnosticPath, failure.diagnostic, "utf8");
    process.exit(failure.status ?? 1);
  }

  console.log(`PASS ${completed} isolated test files`);
}

void main();
