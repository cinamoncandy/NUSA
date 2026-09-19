import assert from "node:assert/strict";
import test from "node:test";
import { prepareDiscoveredCodingRequest } from "./evolveCodingBridge";
import type { EvolutionDiscoverySignal } from "./evolveOpportunityDiscovery";

const now = new Date("2026-08-29T07:20:00.000Z");
const signal = (id: string, overrides: Partial<EvolutionDiscoverySignal> = {}): EvolutionDiscoverySignal => ({
  id,
  source: "ci",
  reference: `ci:${id}`,
  problem: `Improve ${id}`,
  observedAt: "2026-08-29T07:19:00.000Z",
  evidenceQuality: 0.9,
  impact: 0.8,
  confidence: 0.9,
  risk: 0.2,
  reversibility: 0.9,
  ...overrides,
});

const baseInput = () => ({
  signals: [signal("candidate")],
  now,
  repository: "cinamoncandy/NUSA",
  headSha: "d3171864d989cf9897bd5f514f8cb45489b15056",
  workflowRunId: 33239968298,
  successWorkflowRunId: 33239968298,
  executionId: "evolve:discovery:candidate",
  dedupeKey: "evolve:discovery:candidate:d3171864",
  circuit: { state: "CLOSED" as const, consecutiveFailures: 0 },
  schedulePolicy: { mode: "AUTONOMOUS" as const, minIntervalSeconds: 60, maxConcurrent: 1 },
  activeExecutions: 0,
  elapsedSecondsSinceLastRun: 120,
});

test("connects fresh bounded discovery evidence to the existing CodingRunner request contract", () => {
  const result = prepareDiscoveredCodingRequest(baseInput());
  assert.equal(result.status, "READY");
  assert.equal(result.request?.kind, "REPOSITORY_AUTOPILOT");
  assert.equal(result.request?.headSha, "d3171864d989cf9897bd5f514f8cb45489b15056");
  assert.equal(result.request?.workflowRunId, 33239968298);
  assert.equal(result.request?.mutationAllowed, false);
  assert.deepEqual(result.authority, {
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
});

test("abstains when no discovery evidence exists", () => {
  const result = prepareDiscoveredCodingRequest({ ...baseInput(), signals: [] });
  assert.equal(result.status, "ABSTAINED");
  assert.equal(result.request, null);
  assert.equal(result.reason, "no-eligible-opportunity");
});

test("rejects stale discovery evidence and does not prepare coding work", () => {
  const result = prepareDiscoveredCodingRequest({
    ...baseInput(),
    signals: [signal("stale", { observedAt: "2026-08-29T05:00:00.000Z" })],
  });
  assert.equal(result.status, "ABSTAINED");
  assert.deepEqual(result.rejectedSignalIds, ["stale"]);
  assert.equal(result.request, null);
});

test("fails closed when the circuit is open", () => {
  const result = prepareDiscoveredCodingRequest({
    ...baseInput(),
    circuit: { state: "OPEN" as const, consecutiveFailures: 2, openedAt: "2026-08-29T07:00:00.000Z" },
  });
  assert.equal(result.status, "ABSTAINED");
  assert.equal(result.reason, "circuit-open");
  assert.equal(result.request, null);
});

test("fails closed when the scheduler denies another execution", () => {
  const result = prepareDiscoveredCodingRequest({ ...baseInput(), elapsedSecondsSinceLastRun: 10 });
  assert.equal(result.status, "ABSTAINED");
  assert.equal(result.reason, "minimum-interval-not-reached");
  assert.equal(result.request, null);
});

// Regression: issue-driven (non-repair) work must cite a SUCCESSFUL run. Binding the run id before
// the opportunity was selected made backlog-issue work inherit the failed run id that only repair
// work is allowed to cite, so the runner rejected it as CODING_RUNNER_WORKFLOW_NOT_SUCCESSFUL and
// the whole issue lane starved whenever main carried any recent workflow failure.
const FAILED_RUN = 35331005382;
const SUCCESS_RUN = 35330992093;

const issueSignal = () => signal("github-issue-1955", {
  source: "issue",
  reference: "https://github.com/cinamoncandy/NUSA/issues/1955",
  problem: "GitHub issue #1955: Replay exact-head CI Audit eligibility when a validated PR leaves Draft",
});

const ghaSignal = () => signal("gha:autopilot-cloudflare-credential-preflight", {
  problem: "Canonical workflow Autopilot Cloudflare Credential Preflight concluded failure",
});

test("issue-driven work cites the successful canonical CI run, not the failed run", () => {
  const result = prepareDiscoveredCodingRequest({
    ...baseInput(),
    signals: [issueSignal()],
    workflowRunId: FAILED_RUN,
    successWorkflowRunId: SUCCESS_RUN,
  });
  assert.equal(result.status, "READY");
  assert.equal(result.request?.workflowRunId, SUCCESS_RUN);
  assert.ok(!result.request!.reason.includes("gha:"));
});

test("failure-repair work still cites the failed run it repairs", () => {
  const result = prepareDiscoveredCodingRequest({
    ...baseInput(),
    signals: [ghaSignal()],
    workflowRunId: FAILED_RUN,
    successWorkflowRunId: SUCCESS_RUN,
  });
  assert.equal(result.status, "READY");
  assert.equal(result.request?.workflowRunId, FAILED_RUN);
  assert.ok(result.request!.reason.includes("gha:"));
});

test("non-repair work abstains instead of citing a failed run when no successful CI exists", () => {
  const result = prepareDiscoveredCodingRequest({
    ...baseInput(),
    signals: [issueSignal()],
    workflowRunId: FAILED_RUN,
    successWorkflowRunId: null,
  });
  assert.equal(result.status, "ABSTAINED");
  assert.equal(result.reason, "exact-head-successful-ci-required-for-non-repair-work");
  assert.equal(result.request, null);
});
