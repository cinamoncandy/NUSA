import test from "node:test";
import assert from "node:assert/strict";
import { assessCodingRunnerReadiness } from "./codingRunnerReadiness";

const base = { hasWorkersAiBinding: false, hasConfiguredEngine: false, hasGithubToken: false, zeroCreditMode: false };

test("a runner with an engine and a GitHub token is ready", () => {
  assert.deepEqual({ ...assessCodingRunnerReadiness({ ...base, hasWorkersAiBinding: true, hasGithubToken: true }) }, { ready: true, blockers: [] });
  assert.equal(assessCodingRunnerReadiness({ ...base, hasConfiguredEngine: true, hasGithubToken: true }).ready, true);
});

test("missing configuration is named, not just reported as not ready", () => {
  assert.deepEqual([...assessCodingRunnerReadiness(base).blockers], ["CODING_ENGINE_NOT_CONFIGURED", "GITHUB_TOKEN_MISSING"]);
  assert.deepEqual([...assessCodingRunnerReadiness({ ...base, zeroCreditMode: true, hasGithubToken: true }).blockers], ["ZERO_CREDIT_PAID_ENGINE_DISABLED"]);
});

test("a Workers AI binding makes the engine available even in zero-credit mode", () => {
  assert.deepEqual([...assessCodingRunnerReadiness({ ...base, hasWorkersAiBinding: true, hasGithubToken: true, zeroCreditMode: true }).blockers], []);
});
