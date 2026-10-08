import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PersistedPaperPeriodEnvelope } from "../../../packages/contracts/src/persistedPaperPeriod";
import type { PaperAccountState } from "./paperTradingExecutionLoop";
import type { PaperRealizedPeriodOpenInput, PersistedPaperRealizedPeriodPlan } from "./paperRealizedPeriodProducer";
import type { ClosedLearningCycleResult, ClosedLearningEvidenceIdentity } from "./closedLearningLoopCoordinator";
import { ClosedLearningRolloverScheduler, MAX_CYCLE_RESUME_ATTEMPTS, type ClosedLearningRolloverPort } from "./closedLearningRolloverScheduler";
import { OWNER_BASELINE_CANDIDATE_ID } from "./ownerBaselinePaperStrategy";
import { ClosedLearningLoopStatusTracker } from "./closedLearningLoopStatus";

const START = Date.parse("2026-09-04T14:59:00.000Z"); // 23:59 KST
const SAME_KST_DAY = Date.parse("2026-09-04T14:59:30.000Z");
const NEXT_KST_DAY = Date.parse("2026-09-04T15:01:00.000Z"); // 00:01 KST
const HASH = "a".repeat(64);

function advisory() {
  return Object.freeze({
    schemaVersion: 1 as const,
    generatedAt: new Date(START - 60_000).toISOString(),
    policy: Object.freeze({ maximumCandidateWeight: 1, minimumEvidenceBreadth: 1, maximumCandidateCount: 1, maximumFamilyWeight: 1 }),
    entries: Object.freeze([{ id: "candidate-a", familyId: "family-a", rank: 1, leagueScore: 1, evidenceBreadth: 1, researchWeight: 1, reasons: Object.freeze([]), sourceDatasetIds: Object.freeze(["dataset-a"]) }]),
    excludedCandidateIds: Object.freeze([]),
    reasons: Object.freeze([]),
    provenance: Object.freeze({ sourceDatasetIds: Object.freeze(["dataset-a"]) }),
  });
}

function plan(status: "FILLED" | "WAIT" = "FILLED", id = "period-0"): PersistedPaperRealizedPeriodPlan {
  return Object.freeze({
    schemaVersion: 1,
    periodId: id,
    periodIndex: 0,
    advisory: advisory(),
    candidateProvenance: Object.freeze([{ candidateId: "candidate-a", datasetId: "dataset-a", datasetContentSha256: HASH }]),
    market: "KRW-BTC",
    periodStartAt: START,
    observationIds: Object.freeze([`obs-${status}`]),
    observations: Object.freeze([{ observationId: `obs-${status}`, observedAt: START + 1, status }]),
    lastObservedAt: START + 1,
    accountBoundary: Object.freeze({ initialCapital: 1_000_000, equity: 1_000_000, capturedAt: START }),
  });
}

function account(updatedAt: number): PaperAccountState {
  return Object.freeze({
    version: 1,
    initialCapital: 1_000_000,
    cash: 1_000_000,
    equity: 1_000_000,
    realizedPnL: 0,
    unrealizedPnL: 0,
    positions: Object.freeze([]),
    orders: Object.freeze([]),
    fills: Object.freeze([]),
    processedIdempotencyKeys: Object.freeze([]),
    updatedAt,
  });
}

function envelope(recordId = "record-0", periodIndex = 0): PersistedPaperPeriodEnvelope {
  return Object.freeze({
    record: Object.freeze({
      recordId,
      periodIndex,
      market: "KRW-BTC",
      advisory: advisory(),
      periodStartAt: START,
      periodEndAt: NEXT_KST_DAY,
      realizedReturns: Object.freeze({ "candidate-a": 0.01 }),
      benchmarkReturn: 0.005,
      turnoverCostRate: 0.001,
      costEvidence: Object.freeze({ evidenceId: `cost-${periodIndex}`, source: "PAPER_EXECUTION_RECEIPT" as const, evidenceKind: "OBSERVED" as const, evidenceFingerprintSha256: HASH, observedAt: NEXT_KST_DAY, feeRate: 0.0005, spreadRate: 0.0002, slippageRate: 0.0003 }),
      status: "COMPLETED" as const,
    }),
    candidateProvenance: Object.freeze([{ candidateId: "candidate-a", datasetId: "dataset-a", datasetContentSha256: HASH }]),
  });
}

function identity(): ClosedLearningEvidenceIdentity {
  return Object.freeze({
    evidenceId: "evidence-0",
    evidenceFingerprintSha256: HASH,
    championId: "candidate-a",
    championVersion: "v1",
    sourceCommitSha: "b".repeat(40),
    costModelVersion: "paper-cost-v1",
    riskConfigHash: "c".repeat(64),
    evidenceReferences: Object.freeze(["paper-period:record-0"]),
  });
}

function cycle(outcome: "INSUFFICIENT" | "REJECTED" | "QUALIFIED_FOR_LEAGUE", awaitingGovernance = false): ClosedLearningCycleResult {
  const qualified = outcome === "QUALIFIED_FOR_LEAGUE";
  const deployed = qualified && !awaitingGovernance;
  return Object.freeze({
    status: awaitingGovernance ? "WAITING_GOVERNANCE_APPROVAL" : "EXECUTED",
    record: Object.freeze({
      cycleId: "closed-learning:cycle",
      evidenceId: "evidence-0",
      evidenceFingerprintSha256: HASH,
      decision: Object.freeze({
        decisionId: "decision-0",
        outcome,
        ...(qualified ? { candidateId: "candidate-b", candidateVersion: "v2" } : {}),
        decisionReference: "research:decision-0",
        reasons: Object.freeze([]),
      }),
      ...(deployed ? { paperDeployment: Object.freeze({ deploymentId: "deployment-0", candidateId: "candidate-b", candidateVersion: "v2", authority: "PAPER_RESEARCH_ONLY" as const, liveAuthority: "NONE" as const, productionMutationAllowed: false as const, aiAuthority: "ZERO_AUTHORITY" as const }) } : {}),
      recordedAt: NEXT_KST_DAY,
    }),
  });
}

function harness(options: {
  now: number;
  clock?: number;
  observation?: "FILLED" | "WAIT";
  outcome?: "INSUFFICIENT" | "REJECTED" | "QUALIFIED_FOR_LEAGUE";
  awaitingGovernance?: boolean;
  closeError?: Error;
  retireMixed?: boolean;
  inspectMixed?: boolean;
  openPeriods?: readonly PersistedPaperRealizedPeriodPlan[];
  priorRealized?: readonly PersistedPaperPeriodEnvelope[];
}) {
  const events: string[] = [];
  const openInputs: PaperRealizedPeriodOpenInput[] = [];
  const closed = envelope();
  const openPeriods = options.openPeriods ?? [plan(options.observation ?? "FILLED")];
  const realized = Object.freeze([...(options.priorRealized ?? []), closed]);
  const port: ClosedLearningRolloverPort = {
    listOpenPeriods: () => openPeriods,
    listRealizedPeriods: () => realized,
    readCanonicalPaperAccount: () => account(options.now),
    ...(options.clock === undefined ? {} : { now: () => options.clock! }),
    closePeriodFromCanonicalAccount: ({ periodId, periodEndAt }) => {
      events.push(`close:${periodId}:${periodEndAt}`);
      if (options.closeError) throw options.closeError;
      return closed;
    },
    openPeriodFromCanonicalAccount: (input) => { openInputs.push(input); events.push(`open:${input.periodId}:${input.periodStartAt}:${input.periodIndex}`); return { ...plan("FILLED", input.periodId), ...input } as PersistedPaperRealizedPeriodPlan; },
    buildEvidenceIdentity: (window) => { events.push(`identity:${window.realizedPeriods.map((item) => item.record.recordId).join(",")}`); return identity(); },
    runClosedLearningCycle: () => { events.push("cycle"); return cycle(options.outcome ?? "INSUFFICIENT", options.awaitingGovernance === true); },
    ...(options.inspectMixed === true ? { inspectOpenPeriodForMixedBinding: (periodId: string) => { events.push(`inspect-mixed:${periodId}`); return { evidenceFingerprintSha256: "f".repeat(64) }; } } : {}),
    ...(options.retireMixed === false ? {} : { retireOpenPeriodForMixedBinding: (periodId: string) => { events.push(`retire-mixed:${periodId}`); return plan("FILLED", periodId); } }),
  };
  return { scheduler: new ClosedLearningRolloverScheduler(port), events, openInputs };
}

describe("ClosedLearningRolloverScheduler", () => {
  it("does not close before the canonical PAPER account crosses the KST trading-day boundary", () => {
    const { scheduler, events } = harness({ now: SAME_KST_DAY });
    assert.equal(scheduler.runOnce().status, "WAITING_FOR_KST_DAY_ROLLOVER");
    assert.deepEqual(events, []);
  });

  it("closes at the canonical account boundary, not the clock, once the wall clock passes the KST day while the account is idle", () => {
    const { scheduler, events } = harness({ now: SAME_KST_DAY, clock: NEXT_KST_DAY + 1000 });
    assert.equal(scheduler.runOnce().status, "CLOSED_AND_EVALUATED");
    assert.equal(events[0], `close:${plan("FILLED").periodId}:${SAME_KST_DAY}`);
    assert.ok(events.some((event) => event.startsWith("open:") && event.includes(`:${SAME_KST_DAY}:`)), "successor starts at the canonical boundary");
  });

  it("still waits when the wall clock is on the same KST day, absent, or behind the account", () => {
    assert.equal(harness({ now: SAME_KST_DAY, clock: SAME_KST_DAY + 1000 }).scheduler.runOnce().status, "WAITING_FOR_KST_DAY_ROLLOVER");
    assert.equal(harness({ now: SAME_KST_DAY }).scheduler.runOnce().status, "WAITING_FOR_KST_DAY_ROLLOVER");
    assert.equal(harness({ now: SAME_KST_DAY, clock: SAME_KST_DAY - 1 }).scheduler.runOnce().status, "WAITING_FOR_KST_DAY_ROLLOVER");
  });

  it("a clock-crossed period without a FILLED observation still waits and writes nothing", () => {
    const { scheduler, events } = harness({ now: SAME_KST_DAY, clock: NEXT_KST_DAY, observation: "WAIT" });
    assert.equal(scheduler.runOnce().status, "WAITING_FOR_REALIZED_FILL");
    assert.deepEqual(events, []);
  });

  describe("a window that mixes candidate bindings", () => {
    const mixed = () => Object.assign(new Error("realized PAPER period mixes fills from more than one candidate binding"), { code: "CANDIDATE_BINDING_MIXED" });

    it("is retired unscored with no cycle or identity, and replaced in the same step from the retired plan's own candidate", () => {
      const { scheduler, events, openInputs } = harness({ now: NEXT_KST_DAY, closeError: mixed() });
      const result = scheduler.runOnce();
      assert.equal(result.status, "MIXED_BINDING_PERIOD_RETIRED");
      assert.equal(result.reason, "CANDIDATE_BINDING_MIXED");
      assert.equal(result.replacementCandidateId, plan("FILLED").candidateProvenance[0]!.candidateId);
      assert.match(result.replacementPeriodId ?? "", /^closed-learning-mixed-binding-replaced:/);
      assert.deepEqual(events.filter((event) => !event.startsWith("close:") && !event.startsWith("open:")), [`retire-mixed:${plan("FILLED").periodId}`]);
      assert.equal(openInputs.length, 1);
      assert.deepEqual(openInputs[0]!.candidateProvenance, plan("FILLED").candidateProvenance, "the replacement keeps the retired plan's candidate, not realized history");
      assert.equal(openInputs[0]!.periodStartAt, NEXT_KST_DAY, "it starts at the canonical account boundary");
    });

    it("is retired as soon as the ledger proves the mix, even before the trading day closes, with its receipt fingerprint", () => {
      const { scheduler, events } = harness({ now: NEXT_KST_DAY, inspectMixed: true });
      const result = scheduler.runOnce();
      assert.equal(result.status, "MIXED_BINDING_PERIOD_RETIRED");
      assert.equal(result.retirementEvidenceFingerprintSha256, "f".repeat(64));
      assert.deepEqual(events.filter((event) => !event.startsWith("open:")), [`inspect-mixed:${plan("FILLED").periodId}`, `retire-mixed:${plan("FILLED").periodId}`], "nothing is closed, identified or evaluated");
      assert.equal(events.filter((event) => event.startsWith("open:")).length, 1, "exactly one replacement is opened");
      assert.ok(result.replacementPeriodId);
    });

    it("any other close failure stays BLOCKED and retires nothing", () => {
      const other = Object.assign(new Error("x"), { code: "MISSING_BENCHMARK_EVIDENCE" });
      const { scheduler, events } = harness({ now: NEXT_KST_DAY, closeError: other });
      assert.equal(scheduler.runOnce().status, "BLOCKED");
      assert.ok(!events.some((event) => event.startsWith("retire-mixed")));
    });

    it("stays BLOCKED when the retirement port is unavailable", () => {
      const { scheduler } = harness({ now: NEXT_KST_DAY, closeError: mixed(), retireMixed: false });
      const result = scheduler.runOnce();
      assert.equal(result.status, "BLOCKED");
      assert.match(result.reason ?? "", /CANDIDATE_BINDING_MIXED|mixes fills/);
    });
  });

  it("keeps a crossed period open until a real FILLED observation exists", () => {
    const { scheduler, events } = harness({ now: NEXT_KST_DAY, observation: "WAIT" });
    assert.equal(scheduler.runOnce().status, "WAITING_FOR_REALIZED_FILL");
    assert.deepEqual(events, []);
  });

  it("passes the durable multi-period denominator to identity construction and continues the same candidate after insufficient evidence", () => {
    const prior = envelope("record-prior", 0);
    const { scheduler, events } = harness({ now: NEXT_KST_DAY, outcome: "INSUFFICIENT", priorRealized: [prior] });
    const result = scheduler.runOnce();
    assert.equal(result.status, "CLOSED_AND_EVALUATED");
    assert.deepEqual(events.slice(0, 3), [`close:period-0:${NEXT_KST_DAY}`, "identity:record-prior,record-0", "cycle"]);
    assert.equal(events[3], `open:closed-learning-rollover:1:${NEXT_KST_DAY}:${NEXT_KST_DAY}:1`);
  });

  it("routes a realized owner-baseline period through the canonical learning cycle before continuing the baseline", () => {
    const baseline = Object.freeze({
      ...plan("FILLED", "owner-baseline:KRW-BTC:" + START),
      candidateProvenance: Object.freeze([{ candidateId: OWNER_BASELINE_CANDIDATE_ID, datasetId: "owner-baseline:upbit-public-ticker:KRW-BTC", datasetContentSha256: HASH }]),
    });
    const { scheduler, events } = harness({ now: NEXT_KST_DAY, outcome: "INSUFFICIENT", openPeriods: [baseline] });
    const result = scheduler.runOnce();
    assert.equal(result.status, "CLOSED_AND_EVALUATED");
    assert.deepEqual(events.slice(0, 3), [`close:${baseline.periodId}:${NEXT_KST_DAY}`, "identity:record-0", "cycle"]);
    assert.equal(events[3], `open:closed-learning-rollover:1:${NEXT_KST_DAY}:${NEXT_KST_DAY}:1`);
    assert.equal(result.cycle?.record.evidenceFingerprintSha256, HASH);
  });

  it("does not open a duplicate period when a qualified cycle deploys its replacement challenger", () => {
    const { scheduler, events } = harness({ now: NEXT_KST_DAY, outcome: "QUALIFIED_FOR_LEAGUE" });
    assert.equal(scheduler.runOnce().status, "CLOSED_AND_EVALUATED");
    assert.deepEqual(events, [`close:period-0:${NEXT_KST_DAY}`, "identity:record-0", "cycle"]);
  });

  it("keeps PAPER running on the current candidate while a qualified challenger waits for Governance approval", () => {
    const { scheduler, events } = harness({ now: NEXT_KST_DAY, outcome: "QUALIFIED_FOR_LEAGUE", awaitingGovernance: true });
    assert.equal(scheduler.runOnce().status, "CLOSED_AND_EVALUATED");
    assert.deepEqual(events.slice(0, 3), [`close:period-0:${NEXT_KST_DAY}`, "identity:record-0", "cycle"]);
    assert.equal(events[3], `open:closed-learning-rollover:1:${NEXT_KST_DAY}:${NEXT_KST_DAY}:1`, "a next period opens so PAPER never stalls with no open period");
  });

  it("fails closed on multiple open canonical periods", () => {
    const { scheduler, events } = harness({ now: NEXT_KST_DAY, openPeriods: [plan("FILLED", "period-0"), { ...plan("FILLED", "period-1"), periodIndex: 1 }] });
    const result = scheduler.runOnce();
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.reason, "MULTIPLE_OPEN_PAPER_PERIODS");
    assert.deepEqual(events, []);
  });

  it("does not manufacture Research input or reopen a period when canonical close evidence is incomplete", () => {
    const { scheduler, events } = harness({ now: NEXT_KST_DAY, closeError: new Error("MISSING_BENCHMARK_EVIDENCE") });
    const result = scheduler.runOnce();
    assert.equal(result.status, "BLOCKED");
    assert.match(result.reason ?? "", /MISSING_BENCHMARK_EVIDENCE/);
    assert.deepEqual(events, [`close:period-0:${NEXT_KST_DAY}`]);
  });
});

describe("closed-learning rollover after a period closed without a successor", () => {
  const LATER = NEXT_KST_DAY + 60_000;

  it("continues the latest realized candidate from the real canonical account boundary", () => {
    const { scheduler, events } = harness({ now: LATER, openPeriods: [] });
    const result = scheduler.runOnce();
    assert.equal(result.status, "STALLED_PERIOD_REOPENED");
    assert.equal(result.reason, "continued:record-0");
    assert.deepEqual(events, [`open:closed-learning-rollover:1:${LATER}:${LATER}:1`]);
  });

  it("waits instead of reopening at or before the last realized period end", () => {
    const { scheduler, events } = harness({ now: NEXT_KST_DAY, openPeriods: [] });
    const result = scheduler.runOnce();
    assert.equal(result.status, "NO_OPEN_PERIOD");
    assert.equal(result.reason, "WAITING_FOR_CANONICAL_BOUNDARY");
    assert.deepEqual(events, []);
  });

  it("leaves a fresh install with no realized history to the bootstrap", () => {
    const port: ClosedLearningRolloverPort = {
      listOpenPeriods: () => [],
      listRealizedPeriods: () => [],
      readCanonicalPaperAccount: () => account(LATER),
      closePeriodFromCanonicalAccount: () => { throw new Error("unexpected close"); },
      openPeriodFromCanonicalAccount: () => { throw new Error("unexpected open"); },
      buildEvidenceIdentity: () => { throw new Error("unexpected identity"); },
      runClosedLearningCycle: () => { throw new Error("unexpected cycle"); },
    };
    const result = new ClosedLearningRolloverScheduler(port).runOnce();
    assert.equal(result.status, "NO_OPEN_PERIOD");
    assert.equal(result.reason, undefined);
  });
});

describe("closed-learning rollover blocked reasons", () => {
  it("leads with the failing step's error code so the loop status can name it", () => {
    const failure = Object.assign(new Error("canonical PAPER period benchmark evidence is unavailable"), { code: "MISSING_BENCHMARK_EVIDENCE" });
    const { scheduler } = harness({ now: NEXT_KST_DAY, closeError: failure });
    const result = scheduler.runOnce();
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.reason, "MISSING_BENCHMARK_EVIDENCE:canonical PAPER period benchmark evidence is unavailable");
    const tracker = new ClosedLearningLoopStatusTracker();
    tracker.observeRollover(result, NEXT_KST_DAY);
    assert.equal(tracker.snapshot()?.rolloverReason, "MISSING_BENCHMARK_EVIDENCE");
  });

  it("keeps the plain message when the error has no stable code", () => {
    const { scheduler } = harness({ now: NEXT_KST_DAY, closeError: Object.assign(new Error("boom"), { code: "lower-case" }) });
    assert.equal(scheduler.runOnce().reason, "boom");
  });
});

describe("closed-learning rollover when a period is bound to a market the runtime no longer streams", () => {
  const LATER = NEXT_KST_DAY + 60_000;
  function port(over: Partial<ClosedLearningRolloverPort> & { open?: readonly PersistedPaperRealizedPeriodPlan[]; realized?: readonly PersistedPaperPeriodEnvelope[] }) {
    const events: string[] = [];
    const base: ClosedLearningRolloverPort = {
      listOpenPeriods: () => over.open ?? [],
      listRealizedPeriods: () => over.realized ?? [],
      readCanonicalPaperAccount: () => account(LATER),
      closePeriodFromCanonicalAccount: ({ periodId }) => { events.push(`close:${periodId}`); throw new Error("canonical PAPER period benchmark evidence is unavailable"); },
      openPeriodFromCanonicalAccount: (input) => { events.push(`open:${input.periodId}:${input.market}:${input.candidateProvenance[0]?.candidateId}`); return { ...plan("WAIT", input.periodId), ...input } as PersistedPaperRealizedPeriodPlan; },
      buildEvidenceIdentity: () => identity(),
      runClosedLearningCycle: () => cycle("INSUFFICIENT"),
      streamedMarkets: () => ["KRW-XRP"],
      retireOpenPeriodForUnstreamedMarket: (periodId, markets) => { events.push(`retire:${periodId}:${markets.join(",")}`); return plan("FILLED", periodId); },
      buildOwnerBaselinePeriod: ({ periodIndex, periodStartAt }) => ({ periodId: `owner-baseline:KRW-XRP:${periodStartAt}`, periodIndex, advisory: advisory(), candidateProvenance: Object.freeze([{ candidateId: OWNER_BASELINE_CANDIDATE_ID, datasetId: "owner-baseline:upbit-public-ticker:KRW-XRP", datasetContentSha256: HASH }]), market: "KRW-XRP", periodStartAt }),
    };
    return { scheduler: new ClosedLearningRolloverScheduler({ ...base, ...over }), events };
  }
  const baselineEnvelope = (market: string) => Object.freeze({ ...envelope(), record: Object.freeze({ ...envelope().record, market }), candidateProvenance: Object.freeze([{ candidateId: OWNER_BASELINE_CANDIDATE_ID, datasetId: `owner-baseline:upbit-public-ticker:${market}`, datasetContentSha256: HASH }]) });

  it("retires an open period on an unstreamed market instead of failing its close forever", () => {
    const { scheduler, events } = port({ open: [plan("FILLED")] }); // plan() is bound to KRW-BTC
    const result = scheduler.runOnce();
    assert.equal(result.status, "UNSTREAMED_MARKET_PERIOD_RETIRED");
    assert.equal(result.reason, "MARKET_NOT_STREAMED");
    assert.deepEqual(events, ["retire:period-0:KRW-XRP"], "no close is attempted and no benchmark is invented");
  });

  it("stays blocked when retirement is unavailable", () => {
    const { scheduler, events } = port({ open: [plan("FILLED")], retireOpenPeriodForUnstreamedMarket: undefined });
    assert.equal(scheduler.runOnce().reason, "UNSTREAMED_MARKET_RETIREMENT_UNAVAILABLE");
    assert.deepEqual(events, []);
  });

  it("restarts the owner baseline on the streamed market through its canonical builder, not by copying the old market", () => {
    const { scheduler, events } = port({ realized: [baselineEnvelope("KRW-BTC")] });
    const result = scheduler.runOnce();
    assert.equal(result.status, "STALLED_PERIOD_REOPENED");
    assert.deepEqual(events, [`open:owner-baseline:KRW-XRP:${LATER}:KRW-XRP:${OWNER_BASELINE_CANDIDATE_ID}`]);
  });

  it("never moves a non-baseline candidate to another market", () => {
    const { scheduler, events } = port({ realized: [envelope()] }); // candidate-a on KRW-BTC
    const result = scheduler.runOnce();
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.reason, "STALLED_PERIOD_MARKET_NOT_STREAMED");
    assert.deepEqual(events, []);
  });

  it("keeps continuing on the same market when it is still streamed", () => {
    const { scheduler, events } = port({ realized: [baselineEnvelope("KRW-XRP")] });
    assert.equal(scheduler.runOnce().status, "STALLED_PERIOD_REOPENED");
    assert.deepEqual(events, [`open:closed-learning-rollover:1:${LATER}:KRW-XRP:${OWNER_BASELINE_CANDIDATE_ID}`]);
  });

  it("still tries to close a streamed-market period normally", () => {
    const xrpPlan = Object.freeze({ ...plan("FILLED"), market: "KRW-XRP" });
    const { scheduler, events } = port({ open: [xrpPlan] });
    assert.equal(scheduler.runOnce().status, "BLOCKED", "a genuinely missing benchmark still fails closed");
    assert.deepEqual(events, ["close:period-0"]);
  });
});

describe("closed-learning rollover across a replaced PAPER account (owner capital change)", () => {
  function replacedAccountPort(retire?: (periodId: string) => PersistedPaperRealizedPeriodPlan) {
    const calls: string[] = [];
    const opened: unknown[] = [];
    const newAccount = Object.freeze({ ...account(NEXT_KST_DAY), initialCapital: 5_000, cash: 5_000, equity: 5_000 });
    const port: ClosedLearningRolloverPort = {
      listOpenPeriods: () => [plan("WAIT")],
      listRealizedPeriods: () => [envelope("record-0", 0)],
      readCanonicalPaperAccount: () => newAccount,
      closePeriodFromCanonicalAccount: () => { calls.push("close"); throw new Error("must not close across accounts"); },
      openPeriodFromCanonicalAccount: (input) => { calls.push("open"); opened.push(input); return Object.freeze({ ...plan("WAIT", input.periodId), periodIndex: input.periodIndex, periodStartAt: input.periodStartAt }); },
      ...(retire == null ? {} : { retireOpenPeriodForAccountChange: (periodId: string) => { calls.push(`retire:${periodId}`); return retire(periodId); } }),
      buildEvidenceIdentity: () => { throw new Error("no evidence identity for a replaced account"); },
      runClosedLearningCycle: () => { throw new Error("no cycle for a replaced account"); },
    };
    return { port, calls, opened };
  }

  it("retires the old account's open period and reopens the same candidate on the new account", () => {
    const { port, calls, opened } = replacedAccountPort((id) => plan("WAIT", id));
    const result = new ClosedLearningRolloverScheduler(port).runOnce();
    assert.equal(result.status, "ACCOUNT_REPLACED_PERIOD_REOPENED");
    assert.deepEqual(calls, ["retire:period-0", "open"]);
    const input = opened[0] as { periodIndex: number; periodStartAt: number; candidateProvenance: readonly { candidateId: string }[]; market: string };
    assert.equal(input.periodIndex, 1);
    assert.equal(input.periodStartAt, NEXT_KST_DAY);
    assert.equal(input.candidateProvenance[0]!.candidateId, "candidate-a");
    assert.equal(input.market, "KRW-BTC");
  });

  it("stays blocked rather than guessing when the runtime cannot retire the period", () => {
    const { port, calls } = replacedAccountPort();
    const result = new ClosedLearningRolloverScheduler(port).runOnce();
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.reason, "PAPER_ACCOUNT_REPLACED_RETIREMENT_UNAVAILABLE");
    assert.deepEqual(calls, []);
  });
});

describe("closed-learning rollover resumes a closed period whose cycle threw", () => {
  const LATER = NEXT_KST_DAY + 60_000;

  /** A stateful port: one open FILLED period that crosses the KST day, a durable close, and a cycle that can be made to throw. */
  function sequence(options: { failuresBeforeSuccess: number; withRecordedCheck?: boolean; cycleAlreadyRecorded?: boolean; startClosed?: boolean; streamedMarkets?: readonly string[] }) {
    const events: string[] = [];
    let open: readonly PersistedPaperRealizedPeriodPlan[] = options.startClosed === true ? [] : [plan("FILLED")];
    let realized: readonly PersistedPaperPeriodEnvelope[] = options.startClosed === true ? Object.freeze([envelope()]) : Object.freeze([]);
    const recorded = new Set<string>(options.cycleAlreadyRecorded === true ? [HASH] : []);
    let failures = options.failuresBeforeSuccess;
    let nowAccount = NEXT_KST_DAY;
    const port: ClosedLearningRolloverPort = {
      listOpenPeriods: () => open,
      listRealizedPeriods: () => realized,
      readCanonicalPaperAccount: () => account(nowAccount),
      closePeriodFromCanonicalAccount: ({ periodId, periodEndAt }) => {
        events.push(`close:${periodId}:${periodEndAt}`);
        const closed = envelope();
        realized = Object.freeze([closed]);
        open = Object.freeze([]);
        return closed;
      },
      openPeriodFromCanonicalAccount: (input) => { events.push(`open:${input.periodId}`); const next = { ...plan("FILLED", input.periodId), ...input } as PersistedPaperRealizedPeriodPlan; open = Object.freeze([next]); return next; },
      buildEvidenceIdentity: () => identity(),
      runClosedLearningCycle: () => {
        events.push("cycle");
        if (failures > 0) { failures -= 1; throw new Error("RESEARCH_WORKER_UNAVAILABLE"); }
        recorded.add(HASH);
        return cycle("INSUFFICIENT");
      },
      ...(options.streamedMarkets === undefined ? {} : { streamedMarkets: () => options.streamedMarkets! }),
      ...(options.withRecordedCheck === false ? {} : { isCycleRecorded: (id: ClosedLearningEvidenceIdentity) => recorded.has(id.evidenceFingerprintSha256) }),
    };
    return { scheduler: new ClosedLearningRolloverScheduler(port), events, setAccount: (value: number) => { nowAccount = value; }, openIds: () => open.map((item) => item.periodId) };
  }

  it("retries the cycle on the next tick and opens the successor once, instead of losing the period's learning", () => {
    const { scheduler, events, setAccount, openIds } = sequence({ failuresBeforeSuccess: 1 });
    const first = scheduler.runOnce();
    assert.equal(first.status, "BLOCKED");
    assert.match(first.reason ?? "", /RESEARCH_WORKER_UNAVAILABLE/);
    assert.deepEqual(openIds(), [], "the close is durable and no successor exists yet");
    setAccount(LATER);
    const second = scheduler.runOnce();
    assert.equal(second.status, "CLOSED_AND_EVALUATED", "the cycle was resumed and recorded");
    assert.equal(second.cycle?.record.decision.outcome, "INSUFFICIENT");
    assert.deepEqual(events.filter((item) => item === "cycle").length, 2);
    assert.equal(openIds().length, 1, "exactly one successor, opened by finalize");
    const third = scheduler.runOnce();
    assert.notEqual(third.status, "CLOSED_AND_EVALUATED", "an already recorded cycle is never run again");
    assert.equal(events.filter((item) => item === "cycle").length, 2);
  });

  it("waits for the canonical boundary after the close before resuming, and writes nothing", () => {
    const { scheduler, events } = sequence({ failuresBeforeSuccess: 1 });
    scheduler.runOnce();
    const waiting = scheduler.runOnce(); // the account has not moved past the period end
    assert.equal(waiting.status, "NO_OPEN_PERIOD");
    assert.equal(waiting.reason, "WAITING_FOR_CANONICAL_BOUNDARY");
    assert.equal(events.filter((item) => item === "cycle").length, 1);
  });

  it("is bounded: a persistent failure stops retrying and PAPER continues with a reopened period", () => {
    const { scheduler, events, setAccount, openIds } = sequence({ failuresBeforeSuccess: 1_000 });
    scheduler.runOnce();
    setAccount(LATER);
    const results: string[] = [];
    for (let tick = 0; tick < MAX_CYCLE_RESUME_ATTEMPTS + 2; tick += 1) results.push(scheduler.runOnce().status);
    assert.equal(events.filter((item) => item === "cycle").length, 1 + MAX_CYCLE_RESUME_ATTEMPTS, "the original run plus the bounded retries");
    assert.ok(results.includes("STALLED_PERIOD_REOPENED"), "after the bound PAPER continues exactly as before");
    assert.equal(openIds().length, 1);
  });

  it("does not run a cycle that is already recorded (a successor-less period with a recorded cycle is just continued)", () => {
    const { scheduler, events, setAccount } = sequence({ failuresBeforeSuccess: 0, cycleAlreadyRecorded: true, startClosed: true });
    setAccount(LATER);
    const result = scheduler.runOnce();
    assert.equal(result.status, "STALLED_PERIOD_REOPENED");
    assert.equal(events.filter((item) => item === "cycle").length, 0);
  });

  it("keeps the previous behaviour when the port cannot say whether a cycle is recorded", () => {
    const baseline = sequence({ failuresBeforeSuccess: 1, withRecordedCheck: false });
    baseline.scheduler.runOnce();
    baseline.setAccount(LATER);
    const next = baseline.scheduler.runOnce();
    assert.equal(next.status, "STALLED_PERIOD_REOPENED", "without isCycleRecorded the failed cycle is not retried");
    assert.equal(baseline.events.filter((item) => item === "cycle").length, 1);
  });

  it("never resumes a gap this process did not create (history, or a successor retired later), even when no cycle is recorded", () => {
    const { scheduler, events, setAccount } = sequence({ failuresBeforeSuccess: 0, startClosed: true });
    setAccount(LATER);
    const result = scheduler.runOnce();
    assert.equal(result.status, "STALLED_PERIOD_REOPENED", "the old unrecorded period is only continued, never re-evaluated");
    assert.equal(events.filter((item) => item === "cycle").length, 0);
  });

  it("does not resume onto a market the runtime no longer streams", () => {
    // The market is streamed when the period closes and the cycle fails; the configuration changes before the retry.
    let streamed: readonly string[] = ["KRW-BTC"];
    const { scheduler, events, setAccount } = sequence({ failuresBeforeSuccess: 1, streamedMarkets: streamed });
    const port = (scheduler as unknown as { port: { streamedMarkets?: () => readonly string[] } }).port;
    port.streamedMarkets = () => streamed;
    scheduler.runOnce();
    streamed = ["KRW-ETH"];
    setAccount(LATER);
    const next = scheduler.runOnce();
    assert.equal(next.status, "BLOCKED", "the existing stalled-continuation guard decides, and a non-baseline candidate is never moved");
    assert.equal(next.reason, "STALLED_PERIOD_MARKET_NOT_STREAMED");
    assert.equal(events.filter((item) => item === "cycle").length, 1, "no second cycle and no deployment on the dead market");
  });
});
