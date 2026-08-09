const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { validateRepositoryTruth } = require("../scripts/validate-repository-truth.js");

const BASE_COMMIT = "a".repeat(40);

function write(root, relativePath, content = "") {
  const path = join(root, relativePath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "nusa-repository-truth-"));
  write(root, "README.md", `# NUSA\n\n## Cloud PAPER runtime\n\nRun with pnpm cloud:runtime.\n\nAuthority remains liveAuthority NONE and productionMutationAllowed false.\n`);
  write(root, "package.json", JSON.stringify({ scripts: {
    "cloud:runtime": "pnpm run build && node dist/apps/cloud/src/runtime.js",
    "architecture:truth": "node scripts/validate-repository-truth.js"
  } }));
  for (const path of ["apps/cloud/src/runtime.ts", "apps/cloud/src/server.ts", "apps/cloud/src/cloudRuntimeConfig.ts"]) write(root, path);
  write(root, ".aipos/evidence/WO-AI-003-completion.json", "{}\n");
  write(root, ".aipos/state.yaml", `version: 1\nactive_branch: main\nactive_pull_request: null\nbase_commit: ${BASE_COMMIT}\nverified_state:\n  work_order: WO-AI-003\n  status: COMPLETED\n  evidence: .aipos/evidence/WO-AI-003-completion.json\nverification:\n  current_commit: verified baseline remains evidence-bound\nrestricted_live_authority:\n  credential_execution_use: prohibited\n  real_money_execution: prohibited\n`);
  return root;
}

function validate(root, isAncestor = () => true) {
  return validateRepositoryTruth(root, { isAncestor });
}

test("repository truth accepts a wired Cloud runtime with evidence-bound AIPOS state", () => {
  const root = fixture();
  try {
    assert.deepEqual(validate(root), { ok: true, failures: [] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("repository truth rejects the obsolete unwired Cloud README claim", () => {
  const root = fixture();
  try {
    write(root, "README.md", `# NUSA\n\n## Cloud PAPER runtime\n\nRun with pnpm cloud:runtime.\nNot currently deployed or wired into a running process.\nliveAuthority NONE; productionMutationAllowed false.\n`);
    const result = validate(root);
    assert.equal(result.ok, false);
    assert.equal(result.failures.some((failure) => failure.startsWith("README_STALE_RUNTIME_CLAIM:")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("repository truth rejects completion state that still says verification is pending", () => {
  const root = fixture();
  try {
    const statePath = join(root, ".aipos/state.yaml");
    const source = require("node:fs").readFileSync(statePath, "utf8");
    writeFileSync(statePath, source.replace("verified baseline remains evidence-bound", "completion bookkeeping pending exact-head verification"));
    const result = validate(root);
    assert.equal(result.ok, false);
    assert.equal(result.failures.includes("AIPOS_VERIFIED_STATE_CONTRADICTS_PENDING_WORDING"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("repository truth rejects a base commit that is not an ancestor of HEAD", () => {
  const root = fixture();
  try {
    const result = validate(root, () => false);
    assert.equal(result.ok, false);
    assert.equal(result.failures.includes(`AIPOS_BASE_COMMIT_NOT_ANCESTOR:${BASE_COMMIT}`), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
