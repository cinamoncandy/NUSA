const { createHash } = require("node:crypto");
const { mkdirSync, writeFileSync } = require("node:fs");
const { dirname, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const REQUIRED_CHECKS = Object.freeze([
  Object.freeze({ id: "paper-approval-service", file: "tests/paper-approval-service.test.js" }),
  Object.freeze({ id: "kill-switch-audit-persistence", file: "tests/kill-switch-audit-persistence.test.js" }),
  Object.freeze({ id: "risk-safety-runtime-wiring", file: "tests/risk-safety-runtime-wiring.test.js" }),
]);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function gitRevision(root) {
  if (process.env.GITHUB_SHA && /^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA)) return process.env.GITHUB_SHA;
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", shell: false });
  if (result.status === 0) return result.stdout.trim();
  return "UNKNOWN";
}

function runCheck(root, check, spawn = spawnSync) {
  const startedAt = Date.now();
  const result = spawn(process.execPath, ["--test", "--test-reporter=spec", check.file], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    env: { ...process.env, NUSA_MODE: "PAPER", NUSA_LIVE_MUTATION: "PROHIBITED" },
  });
  return Object.freeze({
    id: check.id,
    file: check.file,
    status: result.status === 0 ? "PASS" : "FAIL",
    exit_code: result.status ?? 1,
    duration_ms: Date.now() - startedAt,
    stdout_sha256: sha256(result.stdout || ""),
    stderr_sha256: sha256(result.stderr || ""),
  });
}

function buildEvidence({ root = process.cwd(), outputPath, spawn = spawnSync, now = () => new Date().toISOString() } = {}) {
  const checks = REQUIRED_CHECKS.map((check) => runCheck(root, check, spawn));
  const result = checks.every((check) => check.status === "PASS") ? "PASS" : "FAIL";
  const payload = {
    schema_version: 1,
    evidence_type: "nusa.paper-runtime.operational-verification",
    command: "nusa verify paper-runtime",
    mode: "PAPER",
    live_trading_mutation: "PROHIBITED",
    code_revision: gitRevision(root),
    observed_at: now(),
    configuration: {
      node: process.version,
      platform: process.platform,
      required_checks: REQUIRED_CHECKS.map((check) => check.file),
    },
    assertions: {
      approval_lifecycle: "REQUIRED",
      canonical_risk_broker_admission: "REQUIRED",
      kill_switch_fail_closed: "REQUIRED",
      audit_persistence: "REQUIRED",
      dashboard_projection: "REQUIRED",
      restart_recovery_fail_closed: "REQUIRED",
      live_mutation_prohibited: true,
    },
    checks,
    result,
  };
  const evidence = {
    ...payload,
    artifact_hash: { algorithm: "sha256", value: sha256(canonical(payload)) },
  };

  if (outputPath) {
    const absolute = resolve(root, outputPath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  }
  return evidence;
}

function parseOutput(args) {
  const index = args.indexOf("--output");
  if (index < 0) return "artifacts/operational-evidence/paper-runtime.json";
  if (!args[index + 1] || args[index + 1].startsWith("-")) throw new Error("missing --output value");
  return args[index + 1];
}

if (require.main === module) {
  try {
    const outputPath = parseOutput(process.argv.slice(2));
    const evidence = buildEvidence({ outputPath });
    process.stdout.write(`${JSON.stringify({ result: evidence.result, artifact: outputPath, artifact_hash: evidence.artifact_hash.value })}\n`);
    if (evidence.result !== "PASS") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`paper-runtime verification failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  }
}

module.exports = { REQUIRED_CHECKS, buildEvidence, canonical, parseOutput, runCheck, sha256 };
