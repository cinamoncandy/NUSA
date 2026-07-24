const { readdirSync, writeFileSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");

const testsDirectory = join(process.cwd(), "tests");
const diagnosticPath = join(process.cwd(), "isolated-test-failure.txt");
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
    const diagnostic = [
      `FAILED_TO_START ${relativePath}`,
      result.error.stack || result.error.message
    ].join("\n");
    writeFileSync(diagnosticPath, diagnostic, "utf8");
    console.error(diagnostic);
    process.exit(1);
  }

  if (result.status !== 0) {
    const diagnostic = [
      `FAILED_TEST_FILE ${relativePath}`,
      result.stdout || "",
      result.stderr || ""
    ].join("\n").trimEnd();
    writeFileSync(diagnosticPath, diagnostic, "utf8");
    console.error(diagnostic);
    process.exit(result.status || 1);
  }
}

console.log(`PASS ${files.length} isolated test files`);
