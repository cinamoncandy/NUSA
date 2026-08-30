"use strict";

const { existsSync, mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");

function toRunnableTest(relativePath) {
  const normalized = relativePath.trim().replaceAll("\\", "/");
  if (!normalized) return null;
  if (/\.test\.(?:js|cjs|mjs)$/.test(normalized)) return normalized;
  if (/\.test\.ts$/.test(normalized)) return normalized;
  return null;
}

function runTest(vitestCli, relativePath, root) {
  const tempConfigDir = mkdtempSync(join(tmpdir(), "nusa-vitest-"));
  const configPath = join(tempConfigDir, "config.mjs");
  const escapedPath = JSON.stringify(relativePath);
  writeFileSync(
    configPath,
    `import { defineConfig } from ${JSON.stringify("vitest/config")};\n\nexport default defineConfig({\n  test: {\n    environment: "node",\n    include: [${escapedPath}]\n  }\n});\n`,
    "utf8"
  );

  try {
    const result = spawnSync(process.execPath, [vitestCli, "run", "--config", configPath], {
      cwd: root,
      env: { ...process.env },
      encoding: "utf8",
      stdio: "inherit",
      shell: false,
      windowsHide: true,
      timeout: 120_000,
      killSignal: "SIGKILL"
    });
    if (result.error) console.error(result.error.stack || result.error.message);
    return result.error || result.status !== 0 ? (result.status || 1) : 0;
  } finally {
    rmSync(tempConfigDir, { recursive: true, force: true });
  }
}

function main() {
  const root = process.cwd();
  const vitestCli = join(root, "node_modules", "vitest", "vitest.mjs");
  const isPrimaryPullRequestCi = process.env.GITHUB_ACTIONS === "true"
    && process.env.GITHUB_EVENT_NAME === "pull_request"
    && process.env.GITHUB_WORKFLOW === "CI";
  const explicitBase = process.env.NUSA_CHANGED_TEST_BASE?.trim();

  if (!isPrimaryPullRequestCi && !explicitBase) {
    console.log("SKIP changed-test fast gate: not the primary pull-request CI workflow");
    return;
  }

  if (!explicitBase && !process.env.GITHUB_BASE_REF) {
    console.error("Changed-test fast gate requires GITHUB_BASE_REF in pull-request CI");
    process.exit(1);
  }

  const base = explicitBase || `origin/${process.env.GITHUB_BASE_REF}`;
  const diff = spawnSync("git", ["diff", "--name-only", "--diff-filter=ACMRTUXB", `${base}...HEAD`], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true
  });

  if (diff.error || diff.status !== 0) {
    console.error(diff.stdout || "");
    console.error(diff.stderr || "");
    console.error(`Changed-test fast gate could not diff ${base}...HEAD`);
    process.exit(diff.status || 1);
  }

  const tests = [...new Set(
    diff.stdout
      .split(/\r?\n/)
      .map(toRunnableTest)
      .filter(Boolean)
      .filter((relativePath) => existsSync(join(root, relativePath)))
  )].sort((left, right) => left.localeCompare(right));

  if (tests.length === 0) {
    console.log(`PASS changed-test fast gate: no changed runnable tests in ${base}...HEAD`);
    return;
  }

  if (!existsSync(vitestCli)) {
    console.error(`Changed-test fast gate could not find Vitest CLI at ${vitestCli}`);
    process.exit(1);
  }

  console.log(`FAST_GATE ${tests.length} changed test file(s): ${tests.join(", ")}`);
  for (const relativePath of tests) {
    const status = runTest(vitestCli, relativePath, root);
    if (status !== 0) process.exit(status);
  }

  console.log(`PASS ${tests.length} changed test file(s) before expensive CI gates`);
}

if (require.main === module) main();

module.exports = { toRunnableTest };
