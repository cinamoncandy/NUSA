const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const yaml = require("js-yaml");

const workflow = yaml.load(fs.readFileSync(".github/workflows/autopilot-deterministic-audit-release.yml", "utf8"));
const step = workflow.jobs.release.steps.find(item => item.name === "Recover post-merge CI retries and dispatch Cloudflare Deploy");

function probe(error, failures = 1) {
  const match = step.run.match(/(read_release_api\(\) \{[\s\S]*?\n\})\n/);
  assert.ok(match, "canonical read retry boundary must exist");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-release-read-"));
  try {
    const result = spawnSync("bash", ["-c", `
      set -euo pipefail
      gh() {
        local count=0
        if [ -f calls ]; then read -r count < calls; fi
        count=$((count + 1)); printf '%s\\n' "$count" > calls
        if [ "$count" -le "$FAILURES" ]; then printf '%s\\n' "$FAILURE" >&2; return 1; fi
        printf '%s' '{"workflow_runs":[]}'
      }
      sleep() { printf '%s\\n' "$1" >> sleeps; }
      ${match[1]}
      read_release_api repos/example/NUSA/actions/runs
    `], { cwd: directory, encoding: "utf8", timeout: 5000, env: { ...process.env, FAILURE: error, FAILURES: String(failures) } });
    assert.ifError(result.error);
    return { ...result, calls: Number(fs.readFileSync(path.join(directory, "calls"), "utf8")), sleeps: fs.existsSync(path.join(directory, "sleeps")) ? fs.readFileSync(path.join(directory, "sleeps"), "utf8").trim().split(/\r?\n/) : [] };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test("unexpected JSON EOF is recovered without poll or write duplication", () => {
  const result = probe("unexpected end of JSON input");
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '{"workflow_runs":[]}');
  assert.equal(result.calls, 2);
  assert.deepEqual(result.sleeps, ["2"]);
});

test("persistent transient reads stop after three attempts", () => {
  const result = probe("HTTP 503", 10);
  assert.equal(result.status, 1);
  assert.equal(result.calls, 3);
  assert.deepEqual(result.sleeps, ["2", "4"]);
  assert.equal(result.stdout, "");
});

test("auth, configuration, quota and unknown errors are not automatically retried", () => {
  for (const error of ["HTTP 401", "HTTP 403", "HTTP 404", "HTTP 429", "unknown failure", "HTTP 429 unexpected end of JSON input"]) {
    const result = probe(error, 10);
    assert.equal(result.status, 1, error);
    assert.equal(result.calls, 1, error);
    assert.deepEqual(result.sleeps, [], error);
    assert.equal(result.stdout, "", error);
    assert.ok(!result.stderr.includes(error), "raw failure is not logged");
  }
});

test("retry boundary never wraps mutating API operations", () => {
  assert.doesNotMatch(step.run, /read_release_api[^\n]*--method/);
  assert.match(step.run, /gh api --method POST/);
  assert.match(step.run, /for poll in \$\(seq 1 40\)/);
  assert.match(step.run, /\[ "\$current_main" != "\$MERGED_MAIN" \]/);
  assert.match(step.run, /jq -r --arg sha "\$MERGED_MAIN"/);
});

test("malformed or missing main identity fails the actual recovery step with zero mutations", () => {
  for (const failureStage of ["initial", "after-ci"]) {
  for (const mainSha of ["null", "", "invalid", "a".repeat(39)]) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-release-identity-"));
    try {
      const result = spawnSync("bash", ["-c", `
        gh() {
          if [[ "$*" == *"--method POST"* ]]; then printf 'mutation' > mutations; return 0; fi
          if [[ "$*" == *"actions/runs"* ]]; then printf '%s' '{"workflow_runs":[]}'; return 0; fi
          local count=0
          if [ -f main_reads ]; then read -r count < main_reads; fi
          count=$((count + 1)); printf '%s\\n' "$count" > main_reads
          if [ "$FAILURE_STAGE" = 'after-ci' ] && [ "$count" -eq 1 ]; then printf '%s' "$MERGED_MAIN"; return 0; fi
          printf '%s' "$MAIN_SHA"
        }
        jq() { printf '123'; }
        ${step.run}
      `], { cwd: directory, encoding: "utf8", timeout: 5000, env: { ...process.env, MAIN_SHA: mainSha, FAILURE_STAGE: failureStage, MERGED_MAIN: "a".repeat(40), GITHUB_REPOSITORY: "example/NUSA" } });
      assert.ifError(result.error);
      assert.equal(result.status, 1, `missing/malformed identity ${mainSha}`);
      assert.match(result.stdout, /RELEASE_MAIN_SHA_INVALID/);
      assert.doesNotMatch(result.stdout, /Main advanced/);
      assert.equal(fs.existsSync(path.join(directory, "mutations")), false);
      assert.equal(Number(fs.readFileSync(path.join(directory, "main_reads"), "utf8")), failureStage === "initial" ? 1 : 2);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  }
  }
});
