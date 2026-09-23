const test = require("node:test");
const assert = require("node:assert/strict");
const { initialProposalContextFromGithubRunner, initialProposalContextTargets } = require("../scripts/autopilot-dispatch-retry.js");

const execution = (dedupeKey) => ({ dedupeKey, executionId: "exec:1", headSha: "a".repeat(40) });

/**
 * The first proposal of an execution used to carry no source excerpt, so the coding model had to
 * invent the context lines that the sandbox's `git apply --check` compares byte for byte. These
 * cover the producer that now supplies attempt 1 with a real, in-scope, bounded excerpt.
 */
test("the initial proposal context is real, in scope and bounded", async (t) => {
  await t.test("it returns an excerpt of a file that actually exists in the repository", () => {
    const context = initialProposalContextFromGithubRunner(execution("ci:1:aaa"));
    assert.ok(context, "an excerpt must be produced inside a repository checkout");
    assert.equal(context.startLine, 1);
    // The producer splits on /\r?\n/ and rejoins with \n, which is what `git apply` compares. A
    // Windows runner checks the repository out with CRLF, so the raw bytes on disk must be
    // normalised the same way before comparing, or the test fails on the checkout, not the code.
    const onDisk = require("node:fs").readFileSync(context.path, "utf8").replace(/\r\n/g, "\n");
    assert.ok(
      onDisk.startsWith(context.content.split("\n")[0]),
      "the excerpt must come from the working tree, not be synthesised",
    );
    assert.ok(onDisk.includes(context.content.split("\n").slice(0, 5).join("\n")));
  });

  await t.test("every eligible target obeys the rules the patch assertion enforces", () => {
    // Asserting one sampled target is vacuous: a rule only bites when some real file violates it,
    // and whether the sample lands on that file is luck. apps/autopilot/src does contain index.ts
    // and worker.ts, so the whole candidate set is checked instead.
    const targets = initialProposalContextTargets();
    assert.ok(targets.length > 0, "the repository must offer at least one eligible target");
    const offending = targets.filter((path) => (
      !path.startsWith("apps/autopilot/src/")
      || !path.endsWith(".ts")
      || path.endsWith(".test.ts")
      || path.endsWith(".d.ts")
      || path === "apps/autopilot/src/index.ts"
      || path === "apps/autopilot/src/worker.ts"
      || /(?:^|\/)(?:live|live-trading|broker|order|credential|secret|secrets|withdraw|transfer|production-authority)(?:\/|$)/i.test(path)
    ));
    assert.deepEqual(offending, [], "an out-of-scope target would be proposed against a forbidden file");
    for (const excluded of ["apps/autopilot/src/index.ts", "apps/autopilot/src/worker.ts"]) {
      assert.ok(!targets.includes(excluded), `${excluded} exists in the repository and must stay excluded`);
    }
  });

  await t.test("the excerpt stays inside the transport bound", () => {
    const context = initialProposalContextFromGithubRunner(execution("ci:3:ccc"));
    assert.ok(Buffer.byteLength(context.content, "utf8") <= 20_000);
    assert.ok(context.content.trim().length > 0);
  });

  await t.test("selection is deterministic for one execution and spreads across executions", () => {
    const repeated = new Set(
      Array.from({ length: 5 }, () => initialProposalContextFromGithubRunner(execution("ci:same")).path),
    );
    assert.equal(repeated.size, 1, "a repeated failure must keep the same signature to stay suppressible");

    const spread = new Set(
      Array.from({ length: 40 }, (_unused, index) => initialProposalContextFromGithubRunner(execution(`ci:${index}`)).path),
    );
    assert.ok(spread.size > 1, "different executions must not all be pinned to one file");
  });

  await t.test("a missing dedupe key still produces a usable target rather than throwing", () => {
    assert.ok(initialProposalContextFromGithubRunner({}));
    assert.ok(initialProposalContextFromGithubRunner(undefined));
  });
});
