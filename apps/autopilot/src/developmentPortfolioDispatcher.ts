import {
  claimNusaDevelopmentWorkPortfolio,
  createNusaDevelopmentQueue,
  transitionNusaDevelopmentWork,
  type NusaDevelopmentQueue,
  type NusaDevelopmentWorkItem,
} from "../../../packages/development-control-plane/src";
import { prepareDiscoveredCodingRequest } from "./evolveCodingBridge";
import { executeGithubDispatch } from "./githubExecutor";
import {
  acquirePersistentExecution,
  markPersistentExecutionDispatched,
  readPersistentDevelopmentQueue,
  writePersistentDevelopmentQueue,
  type ExecutionCoordinatorNamespace,
} from "./executionCoordinator";
import type { EvolutionDiscoverySignal } from "./evolveOpportunityDiscovery";

const AUTHORITY = Object.freeze({
  liveAuthority: "NONE" as const,
  productionMutationAllowed: false as const,
  aiAuthority: "ZERO_AUTHORITY" as const,
});

const SHA40 = /^[0-9a-f]{40}$/i;
// Runtime remains single-dispatch until discovery supplies truthful touched-file/owner
// metadata. The canonical queue supports portfolios, but unknown scope is not proof of independence.
const MAX_PORTFOLIO_ITEMS = 1;

export interface DevelopmentPortfolioDispatchResult {
  readonly status: "ABSTAINED" | "NO_READY_WORK" | "PARTIAL" | "EXECUTION_ACCEPTED" | "EXECUTION_FAILED" | "DUPLICATE_SUPPRESSED";
  readonly reason: string;
  readonly claimedCount: number;
  readonly dispatchedCount: number;
  readonly selectedSignalIds: readonly string[];
  readonly queueRevision: number | null;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

function priorityForSignal(signal: EvolutionDiscoverySignal): "P0" | "P1" | "P2" | "P3" {
  if (signal.source.includes("workflow") && signal.risk <= 0.4 && signal.impact >= 0.9) return "P0";
  if (signal.impact >= 0.7) return "P1";
  if (signal.impact >= 0.4) return "P2";
  return "P3";
}

function workId(signal: EvolutionDiscoverySignal): string {
  return `evolve-signal:${signal.id}`;
}

function workItem(signal: EvolutionDiscoverySignal, now: number): NusaDevelopmentWorkItem {
  return Object.freeze({
    id: workId(signal),
    state: "READY",
    priority: priorityForSignal(signal),
    dependencies: Object.freeze([]),
    canonicalOwner: null,
    // Capability ownership is deliberately left empty until the executor can
    // truthfully identify the exact target file. An unknown target must not be
    // guessed; the CodingRunner remains the final one-file scope gate.
    touchedFiles: Object.freeze([]),
    evidenceRequirements: Object.freeze(["discovery-evidence", "exact-head-ci", "independent-audit"]),
    nextAction: "claim",
    createdAt: now,
    claim: null,
  });
}

function extendQueue(queue: NusaDevelopmentQueue | null, signals: readonly EvolutionDiscoverySignal[], now: number): NusaDevelopmentQueue {
  const existing = queue ?? createNusaDevelopmentQueue([], 0);
  const known = new Set(existing.items.map((item) => item.id));
  const additions = signals
    .filter((signal) => !known.has(workId(signal)))
    .map((signal) => workItem(signal, now));
  return additions.length === 0
    ? existing
    : createNusaDevelopmentQueue([...existing.items, ...additions], existing.revision + 1);
}

function signalForItem(item: NusaDevelopmentWorkItem, signals: readonly EvolutionDiscoverySignal[]): EvolutionDiscoverySignal | null {
  return signals.find((signal) => workId(signal) === item.id) ?? null;
}

function result(
  status: DevelopmentPortfolioDispatchResult["status"],
  reason: string,
  claimedCount: number,
  dispatchedCount: number,
  selectedSignalIds: readonly string[],
  queueRevision: number | null,
): DevelopmentPortfolioDispatchResult {
  return Object.freeze({
    status,
    reason,
    claimedCount,
    dispatchedCount,
    selectedSignalIds: Object.freeze([...selectedSignalIds]),
    queueRevision,
    ...AUTHORITY,
  });
}

/**
 * Uses the canonical #903 queue as the only allocation authority. This adapter
 * does not create a scheduler or executor; it only translates existing
 * discovery signals into canonical work, claims a bounded portfolio, and sends
 * each claimed item through the existing CodingRunner/GitHub dispatch spine.
 */
export async function dispatchDevelopmentPortfolio(
  input: {
    readonly repository: string;
    readonly mainSha: string;
    readonly workflowRunId: number;
    readonly now: number;
    readonly signals: readonly EvolutionDiscoverySignal[];
    readonly token: string;
    readonly coordinator: ExecutionCoordinatorNamespace;
    readonly fetchImpl?: typeof fetch;
  },
): Promise<DevelopmentPortfolioDispatchResult> {
  if (!SHA40.test(input.mainSha) || !Number.isSafeInteger(input.now) || input.now < 0 || !Number.isSafeInteger(input.workflowRunId) || input.workflowRunId <= 0) {
    return result("ABSTAINED", "development-portfolio-input-invalid", 0, 0, [], null);
  }
  if (!input.signals.length) return result("NO_READY_WORK", "no-discovery-signals", 0, 0, [], null);

  const existing = await readPersistentDevelopmentQueue(input.coordinator, input.repository);
  const extended = extendQueue(existing, input.signals, input.now);
  if (extended !== existing) await writePersistentDevelopmentQueue(input.coordinator, input.repository, extended);

  const portfolioIdentity = input.signals
    .map((signal) => signal.id)
    .sort()
    .join("|")
    .replace(/[^A-Za-z0-9_.:|+-]+/g, "-")
    .slice(0, 320);
  const allocation = claimNusaDevelopmentWorkPortfolio(extended, {
    owner: "autopilot-evolve",
    requestId: `portfolio:${input.mainSha}:${input.workflowRunId}:${portfolioIdentity}`,
    expectedRevision: extended.revision,
    now: input.now,
    leaseMs: 5 * 60 * 1000,
    maximumItems: MAX_PORTFOLIO_ITEMS,
    allocationPolicy: {
      maximumActiveWorkPerOwner: MAX_PORTFOLIO_ITEMS,
      preventTouchedFileConflicts: true,
    },
  });

  if (allocation.items.length === 0) {
    return result(allocation.status === "WIP_LIMIT_REACHED" ? "ABSTAINED" : "NO_READY_WORK", allocation.stopReason ?? allocation.status, 0, 0, [], allocation.queue.revision);
  }

  let queue = allocation.queue;
  let dispatchedCount = 0;
  let duplicateCount = 0;
  let duplicateReason: string | null = null;
  const selectedSignalIds: string[] = [];

  for (const item of allocation.items) {
    const signal = signalForItem(item, input.signals);
    if (!signal) {
      queue = transitionNusaDevelopmentWork(queue, item.id, "BLOCKED_HUMAN", input.now);
      continue;
    }

    // Queue identity may evolve independently, but execution/dedupe identity must remain
    // byte-compatible with the pre-portfolio logical-work contract.
    const logicalWorkIdentity = signal.id.replace(/[^A-Za-z0-9_.:-]+/g, "-").slice(0, 180) || "no-signal";
    const executionId = `evolve-coding:${input.mainSha.slice(0, 16)}:${logicalWorkIdentity.slice(0, 100)}`;
    const dedupeKey = `evolve-coding:${input.mainSha}:${logicalWorkIdentity}`;
    let currentExecution;
    try {
      currentExecution = await readPersistentExecution(input.coordinator, dedupeKey);
    } catch {
      queue = transitionNusaDevelopmentWork(queue, item.id, "READY", input.now);
      await writePersistentDevelopmentQueue(input.coordinator, input.repository, queue);
      return result("ABSTAINED", "persistent-execution-state-unavailable", allocation.claimedCount, dispatchedCount, selectedSignalIds, queue.revision);
    }
    const activeExecutions = currentExecution
      && (currentExecution.state === "LEASED" || currentExecution.state === "HANDED_OFF")
      && currentExecution.leaseExpiresAt > input.now
      ? 1
      : 0;
    const elapsedSecondsSinceLastRun = currentExecution
      ? Math.max(0, Math.floor((input.now - currentExecution.updatedAt) / 1000))
      : Number.MAX_SAFE_INTEGER;
    const failureSignalCount = input.failureSignalCount ?? input.signals.filter((candidate) => candidate.source.includes("workflow")).length;
    const bridge = prepareDiscoveredCodingRequest({
      signals: [signal],
      now: new Date(input.now),
      repository: input.repository,
      headSha: input.mainSha,
      workflowRunId: input.workflowRunId,
      executionId,
      dedupeKey,
      circuit: { state: "CLOSED", consecutiveFailures: 0 },
      schedulePolicy: { mode: "AUTONOMOUS", minIntervalSeconds: 0, maxConcurrent: MAX_PORTFOLIO_ITEMS },
      activeExecutions: 0,
      elapsedSecondsSinceLastRun: 60,
    });

    if (bridge.status !== "READY" || !bridge.request) {
      queue = transitionNusaDevelopmentWork(queue, item.id, "READY", input.now);
      await writePersistentDevelopmentQueue(input.coordinator, input.repository, queue);
      return result("ABSTAINED", bridge.reason, allocation.claimedCount, dispatchedCount, [signal.id], queue.revision);
    }

    const persistent = await acquirePersistentExecution(input.coordinator, {
      dedupeKey: bridge.request.dedupeKey,
      executionId: bridge.request.executionId,
      now: input.now,
      leaseExpiresAt: input.now + 5 * 60 * 1000,
    });
    if (!persistent.acquired) {
      if (item.state !== "IMPLEMENTING") {
        queue = transitionNusaDevelopmentWork(queue, item.id, "IMPLEMENTING", input.now);
      }
      duplicateCount += 1;
      duplicateReason ??= persistent.reason ?? "DUPLICATE_EXECUTION";
      selectedSignalIds.push(signal.id);
      continue;
    }

    const dispatched = await executeGithubDispatch(bridge.request, { token: input.token, allowedRepository: input.repository }, input.fetchImpl);
    if (dispatched.status === "DISPATCHED") {
      await markPersistentExecutionDispatched(input.coordinator, {
        dedupeKey: bridge.request.dedupeKey,
        executionId: bridge.request.executionId,
        now: input.now,
      });
      queue = transitionNusaDevelopmentWork(queue, item.id, "IMPLEMENTING", input.now);
      dispatchedCount += 1;
      selectedSignalIds.push(signal.id);
    } else {
      queue = transitionNusaDevelopmentWork(queue, item.id, "READY", input.now);
    }
  }

  await writePersistentDevelopmentQueue(input.coordinator, input.repository, queue);
  if (dispatchedCount > 0) return result("EXECUTION_ACCEPTED", "github-coding-dispatch-accepted", allocation.claimedCount, dispatchedCount, selectedSignalIds, queue.revision);
  if (duplicateCount > 0) return result("DUPLICATE_SUPPRESSED", duplicateReason ?? "DUPLICATE_EXECUTION", allocation.claimedCount, 0, selectedSignalIds, queue.revision);
  if (allocation.claimedCount > 0) return result("EXECUTION_FAILED", "canonical-development-portfolio-not-dispatched", allocation.claimedCount, 0, selectedSignalIds, queue.revision);
  return result("NO_READY_WORK", "canonical-development-queue-exhausted", 0, 0, [], queue.revision);
}
