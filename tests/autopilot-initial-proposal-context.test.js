const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { initialProposalContextFromGithubRunner, initialProposalContextTargets } = require("../scripts/autopilot-dispatch-retry.js");

const REAL_TARGET = "apps/autopilot/src/auditRunner.ts";
const request = (reason) => ({ reason, dedupeKey: "ci:1:aaa", executionId: "exec:1", headSha: "a".repeat(40) });

/**
 * The first proposal of an execution carried no source excerpt, so the coding model had to invent
 * the context lines that the sandbox's `git apply --check` compares byte for byte. The prompt also
 * tells the model to patch the supplied file only, so the excerpt must be of the file the request
 * is about: a guessed file would invite an unrelated change that can still validate and publish.
 */
test("the initial proposal context is only supplied for a file the request names", async (t) => {
  await t.test("a request that names no file gets no context rather than a guessed one", () => {
    for (const reason of ["evolve:ci-1:canonical CI failure", "Repeated regression", "", undefined]) {
      assert.equal(initialProposalContextFromGithubRunner(request(reason)), null, `guessed a file for ${JSON.stringify(reason)}`);
    }
    assert.equal(initialProposalContextFromGithubRunner(undefined), null);
  });

  await t.test("a named file yields an excerpt of that file from the working tree", () => {
    const context = initialProposalContextFromGithubRunner(request(`evolve:x:fault in ${REAL_TARGET}`));
    assert.equal(context.path, REAL_TARGET);
    assert.equal(context.startLine, 1);
    // The producer splits on /\r?\n/ and rejoins with \n, which is what `git apply` compares. A
    // Windows runner checks the repository out with CRLF, so the raw bytes on disk must be
    // normalised the same way before comparing, or the test fails on the checkout, not the code.
    const onDisk = fs.readFileSync(context.path, "utf8").replace(/\r\n/g, "\n");
    assert.ok(onDisk.startsWith(context.content.split("\n").slice(0, 5).join("\n")), "the excerpt must not be synthesised");
    assert.ok(Buffer.byteLength(context.content, "utf8") <= 20_000);
  });

  await t.test("a unique basename is enough, an ambiguous or forbidden mention is not", () => {
    assert.equal(initialProposalContextFromGithubRunner(request("see auditRunner.ts.")).path, REAL_TARGET);
    const [first, second] = initialProposalContextTargets();
    assert.equal(initialProposalContextFromGithubRunner(request(`${first} and ${second}`)), null);
    assert.equal(initialProposalContextFromGithubRunner(request("fix apps/autopilot/src/index.ts")), null);
    assert.equal(initialProposalContextFromGithubRunner(request("elsewhere/apps/autopilot/src/auditRunner.ts")), null);
    assert.equal(initialProposalContextFromGithubRunner(request(`${REAL_TARGET}x`)), null);
  });

  await t.test("every eligible target obeys the rules the patch assertion enforces", () => {
    // Asserting one sampled target is vacuous: a rule only bites when some real file violates it.
    // apps/autopilot/src does contain index.ts and worker.ts, so the whole set is checked instead.
    const targets = initialProposalContextTargets();
    assert.ok(targets.length > 0);
    const offending = targets.filter((target) => (
      !target.startsWith("apps/autopilot/src/")
      || !target.endsWith(".ts")
      || target.endsWith(".test.ts")
      || target.endsWith(".d.ts")
      || target === "apps/autopilot/src/index.ts"
      || target === "apps/autopilot/src/worker.ts"
      || /(?:^|\/)(?:live|live-trading|broker|order|credential|secret|secrets|withdraw|transfer|production-authority)(?:\/|$)/i.test(target)
    ));
    assert.deepEqual(offending, []);
  });

  await t.test("a file the publisher would reject is never offered", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "initial-context-"));
    const previous = process.cwd();
    try {
      fs.mkdirSync(path.join(root, "apps/autopilot/src"), { recursive: true });
      fs.writeFileSync(path.join(root, "apps/autopilot/src/small.ts"), "export const small = 1;\n");
      // Many short lines, so the only thing that can exclude this file is its total size: a single
      // long line would already be refused by the 20,000-byte excerpt bound and prove nothing.
      fs.writeFileSync(path.join(root, "apps/autopilot/src/large.ts"), "export const line = 0;\n".repeat(6_000));
      const git = (...args) => execFileSync("git", ["-c", "core.autocrlf=false", ...args], { cwd: root, stdio: "ignore" });
      git("init", "-q");
      git("add", ".");
      process.chdir(root);
      assert.equal(initialProposalContextFromGithubRunner(request("fix large.ts")), null, "above the 128,000-byte publishing limit");
      assert.equal(initialProposalContextFromGithubRunner(request("fix small.ts")).path, "apps/autopilot/src/small.ts");
    } finally {
      process.chdir(previous);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
