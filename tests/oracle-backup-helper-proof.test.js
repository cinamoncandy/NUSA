const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const yaml = require("js-yaml");

const workflow = yaml.load(fs.readFileSync(".github/workflows/oracle-paper-release.yml", "utf8"));
const { prepare, backup, release } = workflow.jobs;
const proof = backup.steps.find((step) => step.name === "Require reviewed root-owned helper exact match before backup");

test("backup receives only the exact-source helper artifact, while activation retains the sealed full release", () => {
  const upload = prepare.steps.find((step) => step.with?.name === "nusa-paper-release-helper");
  assert.ok(upload, "prepare must publish the source helper separately from the full built release");
  assert.equal(upload.with.path, "deploy/oracle/nusa-release-step.sh");
  assert.equal(upload.with["if-no-files-found"], "error");
  assert.equal(prepare.outputs.helper_sha, "${{ steps.bundle.outputs.helper_sha }}");
  const seal = prepare.steps.find((step) => step.id === "bundle");
  assert.match(seal.run, /sha256sum deploy\/oracle\/nusa-release-step\.sh/);
  assert.equal(backup.env.HELPER_SHA, "${{ needs.prepare.outputs.helper_sha }}");
  const downloads = backup.steps.filter((step) => step.uses?.startsWith("actions/download-artifact@"));
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].with.name, "nusa-paper-release-helper");
  assert.equal(downloads[0].with.path, "${{ runner.temp }}/nusa-backup-helper");
  assert.doesNotMatch(backup.steps.map((step) => step.run ?? "").join("\n"), /nusa-release\.tar\.gz|tar\s+-x/);
  assert.ok(release.steps.some((step) => step.with?.name === "nusa-paper-release"));
  assert.ok(release.steps.some((step) => /sha256sum --check --status/.test(step.run ?? "")));
  assert.ok(backup.steps.indexOf(proof) < backup.steps.findIndex((step) => /sudo "\$STEP" backup/.test(step.run ?? "")));
  assert.equal(proof.if, "steps.source_fresh.outputs.fresh == 'true'");
});

test("the production proof rejects tampering, missing files and wrong installed helper before backup", () => {
  assert.ok(proof?.run, "production helper proof must exist");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-helper-proof-"));
  const artifactDir = path.join(dir, "nusa-backup-helper");
  const artifact = path.join(artifactDir, "nusa-release-step.sh");
  const installed = path.join(dir, "installed-helper.sh");
  const source = "#!/usr/bin/env bash\nexit 0\n";
  const digest = createHash("sha256").update(source).digest("hex");
  fs.mkdirSync(artifactDir);
  const run = (expectedDigest = digest) => spawnSync("bash", ["-s"], {
    input: proof.run,
    encoding: "utf8",
    env: { ...process.env, RUNNER_TEMP: dir.replaceAll("\\", "/"), STEP: installed.replaceAll("\\", "/"), HELPER_SHA: expectedDigest },
  });
  try {
    fs.writeFileSync(artifact, source);
    fs.writeFileSync(installed, source);
    const valid = run();
    assert.equal(valid.status, 0, `${valid.error ?? ""}\n${valid.stderr}`);
    assert.notEqual(run("not-a-digest").status, 0);
    fs.writeFileSync(artifact, `${source}# tampered\n`);
    assert.notEqual(run().status, 0, "artifact substitution must fail digest verification");
    fs.writeFileSync(artifact, source);
    fs.writeFileSync(installed, `${source}# other installed version\n`);
    assert.notEqual(run().status, 0, "a correct artifact cannot bless a different installed helper");
    fs.writeFileSync(installed, source);
    fs.rmSync(artifact);
    assert.notEqual(run().status, 0, "missing artifact must fail closed");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
