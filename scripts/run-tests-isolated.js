const { readdirSync } = require("node:fs");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");

const testsDirectory = join(process.cwd(), "tests");
const files = readdirSync(testsDirectory)
  .filter((name) => name.endsWith(".test.js"))
  .sort((a, b) => a.localeCompare(b));

if (files.length === 0) {
  console.error("No test files were found.");
  process.exit(1);
}

for (const file of files) {
  const relativePath = join("tests", file);
  console.log(`RUN ${relativePath}`);
  const result = spawnSync(
    process.execPath,
    ["--test", "--test-reporter=spec", relativePath],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env },
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024
    }
  );

  if (result.error) {
    console.error(`FAILED_TO_START ${relativePath}`);
    console.error(result.error.stack || result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`FAILED_TEST_FILE ${relativePath}`);
    if (result.stdout) console.error(result.stdout.trimEnd());
    if (result.stderr) console.error(result.stderr.trimEnd());
    process.exit(result.status || 1);
  }
}

console.log(`PASS ${files.length} isolated test files`);
