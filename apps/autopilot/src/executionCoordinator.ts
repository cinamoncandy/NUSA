import { validatePersistedEvolutionLearningMemory, type EvolutionLearningMemoryStorage } from "./evolveDurableLearningMemory";
import { validatePersistedCodingExecutionEvidence, type CodingExecutionEvidence } from "./codingExecutionEvidence";
import { validateAutopilotExecutionTelemetry, type AutopilotExecutionTelemetry } from "./executionTelemetry";

interface DurableObjectStorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

interface DurableObjectStateLike {
  storage: DurableObjectStorageLike;
}

export interface DurableObjectIdLike {}

export interface DurableObjectStubLike {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface ExecutionRecord {
  dedupeKey: string;
  executionId: string;
  state: "LEASED" | "DISPATCHED" | "RELEASED";
  leaseExpiresAt: number;
  updatedAt: number;
}

interface AcquireRequest {
  dedupeKey: string;
  executionId: string;
  now: number;
  leaseExpiresAt: number;
}

export interface ScheduledRuntimeReceipt {
  scheduledTime: number;
  observedAt: number;
  status: string;
  reason: string;
  headSha: string | null;
  workflowRunId: number | null;
  liveAuthority: "NONE";
  productionMutationAllowed: false;
  aiAuthority: "ZERO_AUTHORITY";
}

export interface ScheduledRuntimeEvidenceSummary {
  readonly receiptCount: number;
  readonly windowStart: number | null;
  readonly windowEnd: number | null;
  readonly windowSpanMs: number;
  readonly statusCounts: Readonly<Record<string, number>>;
}

export interface ScheduledRuntimeEvidenceSnapshot {
  readonly receipt: ScheduledRuntimeReceipt | null;
  readonly history: readonly ScheduledRuntimeReceipt[];
  readonly summary: ScheduledRuntimeEvidenceSummary;
}

interface ScheduledRuntimeReceiptHistory {
  schemaVersion: 1;
  receipts: readonly ScheduledRuntimeReceipt[];
}

interface CodingExecutionEvidenceHistory {
  schemaVersion: 1;
  evidence: readonly CodingExecutionEvidence[];
}

interface AutopilotExecutionTelemetryHistory {
  schemaVersion: 1;
  telemetry: readonly AutopilotExecutionTelemetry[];
}

const SCHEDULED_RECEIPT_COORDINATOR_KEY = "scheduled-runtime-observability";
const SCHEDULED_RECEIPT_HISTORY_KEY = "scheduled-runtime-receipts-v1";
const MAX_SCHEDULED_RECEIPTS = 120;
const EVOLVE_LEARNING_COORDINATOR_KEY = "evolve-learning-memory";
const CODING_EVIDENCE_COORDINATOR_KEY = "coding-execution-observability";
const CODING_EVIDENCE_HISTORY_KEY = "coding-execution-evidence-v1";
const MAX_CODING_EVIDENCE = 32;
const AUTOPILOT_TELEMETRY_COORDINATOR_KEY = "autopilot-execution-telemetry";
const AUTOPILOT_TELEMETRY_HISTORY_KEY = "autopilot-execution-telemetry-v1";
const MAX_AUTOPILOT_TELEMETRY = 120;
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8" },
});

function validText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 512;
}

function validSafeTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function validAcquire(value: unknown): value is AcquireRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AcquireRequest>;
  return validText(candidate.dedupeKey)
    && validText(candidate.executionId)
    && validSafeTimestamp(candidate.now)
    && validSafeTimestamp(candidate.leaseExpiresAt)
    && Number(candidate.leaseExpiresAt) > Number(candidate.now);
}

function validScheduledReceipt(value: unknown): value is ScheduledRuntimeReceipt {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ScheduledRuntimeReceipt>;
  return validSafeTimestamp(candidate.scheduledTime)
    && validSafeTimestamp(candidate.observedAt)
    && candidate.observedAt >= candidate.scheduledTime
    && validText(candidate.status)
    && validText(candidate.reason)
    && (candidate.headSha === null || (typeof candidate.headSha === "string" && /^[0-9a-f]{40}$/i.test(candidate.headSha)))
    && (candidate.workflowRunId === null || (Number.isSafeInteger(candidate.workflowRunId) && Number(candidate.workflowRunId) > 0))
    && candidate.liveAuthority === "NONE"
    && candidate.productionMutationAllowed === false
    && candidate.aiAuthority === "ZERO_AUTHORITY";
}

function sameScheduledReceipt(left: ScheduledRuntimeReceipt, right: ScheduledRuntimeReceipt): boolean {
  return left.scheduledTime === right.scheduledTime
    && left.observedAt === right.observedAt
    && left.status === right.status
    && left.reason === right.reason
    && left.headSha === right.headSha
    && left.workflowRunId === right.workflowRunId;
}

function validScheduledReceiptHistory(value: unknown): value is ScheduledRuntimeReceiptHistory {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ScheduledRuntimeReceiptHistory>;
  if (candidate.schemaVersion !== 1 || !Array.isArray(candidate.receipts) || candidate.receipts.length > MAX_SCHEDULED_RECEIPTS) return false;
  const scheduledTimes = new Set<number>();
  for (const receipt of candidate.receipts) {
    if (!validScheduledReceipt(receipt) || scheduledTimes.has(receipt.scheduledTime)) return false;
    scheduledTimes.add(receipt.scheduledTime);
  }
  return true;
}

function sortScheduledReceipts(receipts: readonly ScheduledRuntimeReceipt[]): readonly ScheduledRuntimeReceipt[] {
  return Object.freeze([...receipts].sort((left, right) => left.scheduledTime - right.scheduledTime || left.observedAt - right.observedAt));
}

function summarizeScheduledReceipts(receipts: readonly ScheduledRuntimeReceipt[]): ScheduledRuntimeEvidenceSummary {
  const sorted = sortScheduledReceipts(receipts);
  const statusCounts: Record<string, number> = {};
  for (const receipt of sorted) statusCounts[receipt.status] = (statusCounts[receipt.status] ?? 0) + 1;
  const windowStart = sorted[0]?.scheduledTime ?? null;
  const windowEnd = sorted.at(-1)?.scheduledTime ?? null;
  return Object.freeze({
    receiptCount: sorted.length,
    windowStart,
    windowEnd,
    windowSpanMs: windowStart === null || windowEnd === null ? 0 : windowEnd - windowStart,
    statusCounts: Object.freeze(statusCounts),
  });
}

function validScheduledRuntimeSummary(value: unknown): value is ScheduledRuntimeEvidenceSummary {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ScheduledRuntimeEvidenceSummary>;
  if (!Number.isSafeInteger(candidate.receiptCount) || Number(candidate.receiptCount) < 0) return false;
  if (candidate.windowStart !== null && !validSafeTimestamp(candidate.windowStart)) return false;
  if (candidate.windowEnd !== null && !validSafeTimestamp(candidate.windowEnd)) return false;
  if (!Number.isSafeInteger(candidate.windowSpanMs) || Number(candidate.windowSpanMs) < 0) return false;
  if (!candidate.statusCounts || typeof candidate.statusCounts !== "object" || Array.isArray(candidate.statusCounts)) return false;
  return Object.values(candidate.statusCounts).every((count) => Number.isSafeInteger(count) && Number(count) >= 0);
}

export class ExecutionCoordinator {
  constructor(private readonly ctx: DurableObjectStateLike) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/scheduled-receipt") return this.readScheduledReceiptLegacy();
    if (request.method === "GET" && url.pathname === "/scheduled-receipt-history") return this.readScheduledReceipt();
    if (request.method === "GET" && url.pathname === "/evolve-learning-memory") return this.readEvolutionLearningMemory();
    if (request.method === "GET" && url.pathname === "/coding-evidence-history") return this.readCodingExecutionEvidence();
    if (request.method === "GET" && url.pathname === "/execution-telemetry") return this.readExecutionTelemetry();
    if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    if (url.pathname === "/acquire") return this.acquire(await request.json());
    if (url.pathname === "/dispatched") return this.markDispatched(await request.json());
    if (url.pathname === "/release") return this.release(await request.json());
    if (url.pathname === "/scheduled-receipt") return this.writeScheduledReceipt(await request.json());
    if (url.pathname === "/evolve-learning-memory") return this.writeEvolutionLearningMemory(await request.json());
    if (url.pathname === "/coding-evidence") return this.writeCodingExecutionEvidence(await request.json());
    if (url.pathname === "/execution-telemetry") return this.writeExecutionTelemetry(await request.json());
    return json({ error: "NOT_FOUND" }, 404);
  }

  private async acquire(value: unknown): Promise<Response> {
    if (!validAcquire(value)) return json({ error: "EXECUTION_COORDINATION_REQUEST_INVALID" }, 400);
    const request = value;
    const current = await this.ctx.storage.get<ExecutionRecord>("execution");

    if (current?.dedupeKey === request.dedupeKey) {
      if (current.state === "DISPATCHED") return json({ acquired: false, reason: "ALREADY_DISPATCHED", record: current }, 409);
      if (current.state === "LEASED" && current.leaseExpiresAt > request.now) return json({ acquired: false, reason: "LEASE_ACTIVE", record: current }, 409);
    }

    const record: ExecutionRecord = Object.freeze({
      dedupeKey: request.dedupeKey,
      executionId: request.executionId,
      state: "LEASED",
      leaseExpiresAt: request.leaseExpiresAt,
      updatedAt: request.now,
    });
    await this.ctx.storage.put("execution", record);
    return json({ acquired: true, record }, 201);
  }

  private async markDispatched(value: unknown): Promise<Response> {
    if (!value || typeof value !== "object") return json({ error: "EXECUTION_COORDINATION_REQUEST_INVALID" }, 400);
    const request = value as { dedupeKey?: unknown; executionId?: unknown; now?: unknown };
    if (!validText(request.dedupeKey) || !validText(request.executionId) || !validSafeTimestamp(request.now)) return json({ error: "EXECUTION_COORDINATION_REQUEST_INVALID" }, 400);
    const current = await this.ctx.storage.get<ExecutionRecord>("execution");
    if (!current || current.dedupeKey !== request.dedupeKey || current.executionId !== request.executionId) return json({ error: "EXECUTION_LEASE_MISMATCH" }, 409);
    const record: ExecutionRecord = Object.freeze({ ...current, state: "DISPATCHED", updatedAt: Number(request.now) });
    await this.ctx.storage.put("execution", record);
    return json({ updated: true, record });
  }

  private async release(value: unknown): Promise<Response> {
    if (!value || typeof value !== "object") return json({ error: "EXECUTION_COORDINATION_REQUEST_INVALID" }, 400);
    const request = value as { dedupeKey?: unknown; executionId?: unknown; now?: unknown };
    if (!validText(request.dedupeKey) || !validText(request.executionId) || !validSafeTimestamp(request.now)) return json({ error: "EXECUTION_COORDINATION_REQUEST_INVALID" }, 400);
    const current = await this.ctx.storage.get<ExecutionRecord>("execution");
    if (!current || current.dedupeKey !== request.dedupeKey || current.executionId !== request.executionId) return json({ error: "EXECUTION_LEASE_MISMATCH" }, 409);
    if (current.state !== "LEASED") return json({ error: "EXECUTION_LEASE_NOT_ACTIVE" }, 409);
    const record: ExecutionRecord = Object.freeze({ ...current, state: "RELEASED", leaseExpiresAt: Number(request.now), updatedAt: Number(request.now) });
    await this.ctx.storage.put("execution", record);
    return json({ released: true, record });
  }

  private async writeScheduledReceipt(value: unknown): Promise<Response> {
    if (!validScheduledReceipt(value)) return json({ error: "SCHEDULED_RUNTIME_RECEIPT_INVALID" }, 400);
    const receipt = Object.freeze({ ...value });
    let current: ScheduledRuntimeReceiptHistory = { schemaVersion: 1, receipts: Object.freeze([]) };
    try {
      current = await this.readScheduledReceiptHistory();
    } catch {
      return json({ error: "SCHEDULED_RUNTIME_RECEIPT_CORRUPT" }, 500);
    }
    const existing = current.receipts.find((candidate) => candidate.scheduledTime === receipt.scheduledTime);
    if (existing) {
      if (!sameScheduledReceipt(existing, receipt)) return json({ error: "SCHEDULED_RUNTIME_RECEIPT_IDENTITY_CONFLICT" }, 409);
      return json({ updated: false, receipt: existing });
    }
    const receipts = sortScheduledReceipts([...current.receipts, receipt]).slice(-MAX_SCHEDULED_RECEIPTS);
    const history: ScheduledRuntimeReceiptHistory = Object.freeze({ schemaVersion: 1, receipts: Object.freeze(receipts) });
    await this.ctx.storage.put(SCHEDULED_RECEIPT_HISTORY_KEY, history);
    return json({ updated: true, receipt });
  }

  private async readScheduledReceipt(): Promise<Response> {
    try {
      const history = await this.readScheduledReceiptHistory();
      const receipts = sortScheduledReceipts(history.receipts);
      return json({
        receipt: receipts.at(-1) ?? null,
        history: receipts,
        summary: summarizeScheduledReceipts(receipts),
      });
    } catch {
      return json({ error: "SCHEDULED_RUNTIME_RECEIPT_CORRUPT" }, 500);
    }
  }

  private async readScheduledReceiptLegacy(): Promise<Response> {
    try {
      const history = await this.readScheduledReceiptHistory();
      return json({ receipt: sortScheduledReceipts(history.receipts).at(-1) ?? null });
    } catch {
      return json({ error: "SCHEDULED_RUNTIME_RECEIPT_CORRUPT" }, 500);
    }
  }

  private async readScheduledReceiptHistory(): Promise<ScheduledRuntimeReceiptHistory> {
    const stored = await this.ctx.storage.get<unknown>(SCHEDULED_RECEIPT_HISTORY_KEY);
    if (stored != null) {
      if (!validScheduledReceiptHistory(stored)) throw new Error("SCHEDULED_RUNTIME_RECEIPT_CORRUPT");
      return Object.freeze({ schemaVersion: 1, receipts: sortScheduledReceipts(stored.receipts) });
    }
    const legacy = await this.ctx.storage.get<unknown>("scheduled-receipt");
    if (legacy == null) return Object.freeze({ schemaVersion: 1, receipts: Object.freeze([]) });
    if (!validScheduledReceipt(legacy)) throw new Error("SCHEDULED_RUNTIME_RECEIPT_CORRUPT");
    return Object.freeze({ schemaVersion: 1, receipts: Object.freeze([legacy]) });
  }

  private async writeEvolutionLearningMemory(value: unknown): Promise<Response> {
    if (!value || typeof value !== "object" || !("value" in value)) return json({ error: "EVOLVE_LEARNING_MEMORY_REQUEST_INVALID" }, 400);
    try {
      validatePersistedEvolutionLearningMemory((value as { value: unknown }).value);
    } catch {
      return json({ error: "EVOLVE_LEARNING_MEMORY_VALUE_INVALID" }, 400);
    }
    await this.ctx.storage.put("value", (value as { value: unknown }).value);
    return json({ updated: true });
  }

  private async readEvolutionLearningMemory(): Promise<Response> {
    const value = await this.ctx.storage.get<unknown>("value");
    if (value == null) return json({ value: null });
    try {
      validatePersistedEvolutionLearningMemory(value);
    } catch {
      return json({ error: "EVOLVE_LEARNING_MEMORY_CORRUPT" }, 500);
    }
    return json({ value });
  }

  private async writeCodingExecutionEvidence(value: unknown): Promise<Response> {
    if (!value || typeof value !== "object" || !("evidence" in value)) return json({ error: "CODING_EVIDENCE_REQUEST_INVALID" }, 400);
    const evidence = (value as { evidence: unknown }).evidence;
    try {
      validatePersistedCodingExecutionEvidence(evidence);
    } catch {
      return json({ error: "CODING_EVIDENCE_INVALID" }, 400);
    }
    let current: CodingExecutionEvidenceHistory;
    try {
      current = await this.readCodingExecutionEvidenceHistory();
    } catch {
      return json({ error: "CODING_EVIDENCE_CORRUPT" }, 500);
    }
    const existing = current.evidence.find((candidate) => candidate.evidenceId === evidence.evidenceId);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(evidence)) return json({ error: "CODING_EVIDENCE_IDENTITY_CONFLICT" }, 409);
      return json({ updated: false, evidence: existing });
    }
    const next = [...current.evidence, evidence]
      .sort((left, right) => left.recordedAtMs - right.recordedAtMs || left.evidenceId.localeCompare(right.evidenceId))
      .slice(-MAX_CODING_EVIDENCE);
    const history: CodingExecutionEvidenceHistory = Object.freeze({ schemaVersion: 1, evidence: Object.freeze(next) });
    await this.ctx.storage.put(CODING_EVIDENCE_HISTORY_KEY, history);
    return json({ updated: true, evidence });
  }

  private async readCodingExecutionEvidence(): Promise<Response> {
    try {
      const history = await this.readCodingExecutionEvidenceHistory();
      return json({
        evidence: history.evidence.at(-1) ?? null,
        history: history.evidence,
        liveAuthority: "NONE",
        productionMutationAllowed: false,
        aiAuthority: "ZERO_AUTHORITY",
      });
    } catch {
      return json({ error: "CODING_EVIDENCE_CORRUPT" }, 500);
    }
  }

  private async readCodingExecutionEvidenceHistory(): Promise<CodingExecutionEvidenceHistory> {
    const stored = await this.ctx.storage.get<unknown>(CODING_EVIDENCE_HISTORY_KEY);
    if (stored == null) return Object.freeze({ schemaVersion: 1, evidence: Object.freeze([]) });
    if (!stored || typeof stored !== "object" || (stored as { schemaVersion?: unknown }).schemaVersion !== 1 || !Array.isArray((stored as { evidence?: unknown }).evidence) || (stored as { evidence: unknown[] }).evidence.length > MAX_CODING_EVIDENCE) {
      throw new Error("CODING_EVIDENCE_CORRUPT");
    }
    const evidence = (stored as { evidence: unknown[] }).evidence;
    evidence.forEach(validatePersistedCodingExecutionEvidence);
    const validEvidence = evidence as CodingExecutionEvidence[];
    return Object.freeze({
      schemaVersion: 1,
      evidence: Object.freeze([...validEvidence].sort((left, right) => left.recordedAtMs - right.recordedAtMs || left.evidenceId.localeCompare(right.evidenceId))),
    });
  }

  private async writeExecutionTelemetry(value: unknown): Promise<Response> {
    if (!value || typeof value !== "object" || !("telemetry" in value)) return json({ error: "AUTOPILOT_TELEMETRY_REQUEST_INVALID" }, 400);
    const telemetry = (value as { telemetry: unknown }).telemetry;
    try {
      validateAutopilotExecutionTelemetry(telemetry);
    } catch {
      return json({ error: "AUTOPILOT_TELEMETRY_INVALID" }, 400);
    }
    let current: AutopilotExecutionTelemetryHistory;
    try {
      current = await this.readExecutionTelemetryHistory();
    } catch {
      return json({ error: "AUTOPILOT_TELEMETRY_CORRUPT" }, 500);
    }
    const existing = current.telemetry.find((candidate) => candidate.telemetryId === telemetry.telemetryId);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(telemetry)) return json({ error: "AUTOPILOT_TELEMETRY_IDENTITY_CONFLICT" }, 409);
      return json({ updated: false, telemetry: existing });
    }
    const next = [...current.telemetry, telemetry]
      .sort((left, right) => left.timestampMs - right.timestampMs || left.telemetryId.localeCompare(right.telemetryId))
      .slice(-MAX_AUTOPILOT_TELEMETRY);
    const history: AutopilotExecutionTelemetryHistory = Object.freeze({ schemaVersion: 1, telemetry: Object.freeze(next) });
    await this.ctx.storage.put(AUTOPILOT_TELEMETRY_HISTORY_KEY, history);
    return json({ updated: true, telemetry });
  }

  private async readExecutionTelemetry(): Promise<Response> {
    try {
      const history = await this.readExecutionTelemetryHistory();
      const telemetry = history.telemetry;
      return json({
        telemetry: telemetry.at(-1) ?? null,
        history: telemetry,
        summary: summarizeExecutionTelemetry(telemetry),
      });
    } catch {
      return json({ error: "AUTOPILOT_TELEMETRY_CORRUPT" }, 500);
    }
  }

  private async readExecutionTelemetryHistory(): Promise<AutopilotExecutionTelemetryHistory> {
    const stored = await this.ctx.storage.get<unknown>(AUTOPILOT_TELEMETRY_HISTORY_KEY);
    if (stored == null) return Object.freeze({ schemaVersion: 1, telemetry: Object.freeze([]) });
    if (!stored || typeof stored !== "object" || (stored as { schemaVersion?: unknown }).schemaVersion !== 1 || !Array.isArray((stored as { telemetry?: unknown }).telemetry) || (stored as { telemetry: unknown[] }).telemetry.length > MAX_AUTOPILOT_TELEMETRY) {
      throw new Error("AUTOPILOT_TELEMETRY_CORRUPT");
    }
    const telemetry = (stored as { telemetry: unknown[] }).telemetry;
    telemetry.forEach(validateAutopilotExecutionTelemetry);
    return Object.freeze({
      schemaVersion: 1,
      telemetry: Object.freeze([...(telemetry as AutopilotExecutionTelemetry[])].sort((left, right) => left.timestampMs - right.timestampMs || left.telemetryId.localeCompare(right.telemetryId))),
    });
  }
}

export interface AutopilotExecutionTelemetrySummary {
  readonly telemetryCount: number;
  readonly actionCount: number;
  readonly noActionCount: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly duplicateSuppressedCount: number;
  readonly hourly: readonly Readonly<{
    hourStartMs: number;
    executions: number;
    actions: number;
    noActions: number;
    successes: number;
    failures: number;
    duplicates: number;
  }>[];
}

function summarizeExecutionTelemetry(telemetry: readonly AutopilotExecutionTelemetry[]): AutopilotExecutionTelemetrySummary {
  const hourly = new Map<number, { executions: number; actions: number; noActions: number; successes: number; failures: number; duplicates: number }>();
  let actionCount = 0;
  let successCount = 0;
  let failureCount = 0;
  let duplicateSuppressedCount = 0;
  for (const entry of telemetry) {
    const hourStartMs = Math.floor(entry.timestampMs / 3_600_000) * 3_600_000;
    const bucket = hourly.get(hourStartMs) ?? { executions: 0, actions: 0, noActions: 0, successes: 0, failures: 0, duplicates: 0 };
    bucket.executions += 1;
    if (entry.action === "ACTION") { bucket.actions += 1; actionCount += 1; } else bucket.noActions += 1;
    if (/duplicate/i.test(entry.result)) { bucket.duplicates += 1; duplicateSuppressedCount += 1; }
    if (/accepted|success|dispatched/i.test(entry.result)) { bucket.successes += 1; successCount += 1; }
    if (/failed|error|blocked|rejected/i.test(entry.result)) { bucket.failures += 1; failureCount += 1; }
    hourly.set(hourStartMs, bucket);
  }
  return Object.freeze({
    telemetryCount: telemetry.length,
    actionCount,
    noActionCount: telemetry.length - actionCount,
    successCount,
    failureCount,
    duplicateSuppressedCount,
    hourly: Object.freeze([...hourly.entries()].sort(([left], [right]) => left - right).map(([hourStartMs, value]) => Object.freeze({ hourStartMs, ...value }))),
  });
}

function validExecutionTelemetrySummary(value: unknown): value is AutopilotExecutionTelemetrySummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<AutopilotExecutionTelemetrySummary>;
  if (![candidate.telemetryCount, candidate.actionCount, candidate.noActionCount, candidate.successCount, candidate.failureCount, candidate.duplicateSuppressedCount].every((count) => Number.isSafeInteger(count) && Number(count) >= 0)) return false;
  if (!Array.isArray(candidate.hourly)) return false;
  return candidate.hourly.every((bucket) => {
    if (!bucket || typeof bucket !== "object") return false;
    const item = bucket as Record<string, unknown>;
    return ["hourStartMs", "executions", "actions", "noActions", "successes", "failures", "duplicates"].every((key) => Number.isSafeInteger(item[key]) && Number(item[key]) >= 0);
  });
}

export interface ExecutionCoordinatorNamespace {
  idFromName(name: string): DurableObjectIdLike;
  get(id: DurableObjectIdLike): DurableObjectStubLike;
}

export async function acquirePersistentExecution(namespace: ExecutionCoordinatorNamespace, input: AcquireRequest): Promise<{ acquired: boolean; reason?: string }> {
  const stub = namespace.get(namespace.idFromName(input.dedupeKey));
  const response = await stub.fetch("https://execution-coordinator/acquire", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  const body = await response.json() as { acquired?: boolean; reason?: string };
  if (response.status === 201 && body.acquired === true) return { acquired: true };
  if (response.status === 409 && body.acquired === false) return { acquired: false, reason: body.reason ?? "DUPLICATE_EXECUTION" };
  throw new Error("PERSISTENT_EXECUTION_COORDINATION_FAILED");
}

export async function markPersistentExecutionDispatched(namespace: ExecutionCoordinatorNamespace, input: { dedupeKey: string; executionId: string; now: number }): Promise<void> {
  const stub = namespace.get(namespace.idFromName(input.dedupeKey));
  const response = await stub.fetch("https://execution-coordinator/dispatched", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  if (!response.ok) throw new Error("PERSISTENT_EXECUTION_DISPATCH_RECONCILIATION_FAILED");
}

export async function releasePersistentExecution(namespace: ExecutionCoordinatorNamespace, input: { dedupeKey: string; executionId: string; now: number }): Promise<void> {
  const stub = namespace.get(namespace.idFromName(input.dedupeKey));
  const response = await stub.fetch("https://execution-coordinator/release", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  if (!response.ok) throw new Error("PERSISTENT_EXECUTION_RELEASE_FAILED");
}

export async function recordScheduledRuntimeReceipt(namespace: ExecutionCoordinatorNamespace, receipt: ScheduledRuntimeReceipt): Promise<void> {
  const stub = namespace.get(namespace.idFromName(SCHEDULED_RECEIPT_COORDINATOR_KEY));
  const response = await stub.fetch("https://execution-coordinator/scheduled-receipt", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(receipt) });
  if (!response.ok) throw new Error("SCHEDULED_RUNTIME_RECEIPT_PERSIST_FAILED");
}

export async function readScheduledRuntimeReceipt(namespace: ExecutionCoordinatorNamespace): Promise<ScheduledRuntimeReceipt | null> {
  return (await readScheduledRuntimeEvidence(namespace)).receipt;
}

export async function readScheduledRuntimeEvidence(namespace: ExecutionCoordinatorNamespace): Promise<ScheduledRuntimeEvidenceSnapshot> {
  const stub = namespace.get(namespace.idFromName(SCHEDULED_RECEIPT_COORDINATOR_KEY));
  const response = await stub.fetch("https://execution-coordinator/scheduled-receipt", { method: "GET" });
  if (!response.ok) throw new Error("SCHEDULED_RUNTIME_RECEIPT_READ_FAILED");
  const legacy = await response.json() as Partial<ScheduledRuntimeEvidenceSnapshot>;
  let body = legacy;
  try {
    const historyResponse = await stub.fetch("https://execution-coordinator/scheduled-receipt-history", { method: "GET" });
    if (historyResponse.ok) body = await historyResponse.json() as Partial<ScheduledRuntimeEvidenceSnapshot>;
  } catch {
    // Older coordinator deployments expose only the legacy latest-receipt response.
  }
  if (body.receipt !== null && body.receipt !== undefined && !validScheduledReceipt(body.receipt)) throw new Error("SCHEDULED_RUNTIME_RECEIPT_READ_INVALID");
  const history = body.history == null
    ? (body.receipt == null ? [] : [body.receipt])
    : body.history;
  if (!Array.isArray(history) || !history.every(validScheduledReceipt)) throw new Error("SCHEDULED_RUNTIME_RECEIPT_READ_INVALID");
  const summary = body.summary == null ? summarizeScheduledReceipts(history) : body.summary;
  if (!validScheduledRuntimeSummary(summary)) throw new Error("SCHEDULED_RUNTIME_RECEIPT_READ_INVALID");
  const expectedSummary = summarizeScheduledReceipts(history);
  if (summary.receiptCount !== expectedSummary.receiptCount
    || summary.windowStart !== expectedSummary.windowStart
    || summary.windowEnd !== expectedSummary.windowEnd
    || summary.windowSpanMs !== expectedSummary.windowSpanMs
    || JSON.stringify(summary.statusCounts) !== JSON.stringify(expectedSummary.statusCounts)) {
    throw new Error("SCHEDULED_RUNTIME_RECEIPT_READ_INVALID");
  }
  const latest = history.at(-1) ?? null;
  if (latest !== null && (body.receipt == null || !sameScheduledReceipt(latest, body.receipt))) throw new Error("SCHEDULED_RUNTIME_RECEIPT_READ_INVALID");
  if (latest === null && body.receipt != null) throw new Error("SCHEDULED_RUNTIME_RECEIPT_READ_INVALID");
  return Object.freeze({
    receipt: body.receipt ?? null,
    history: sortScheduledReceipts(history),
    summary,
  });
}

export function createEvolutionLearningMemoryStorage(namespace: ExecutionCoordinatorNamespace): EvolutionLearningMemoryStorage {
  const stub = namespace.get(namespace.idFromName(EVOLVE_LEARNING_COORDINATOR_KEY));
  return Object.freeze({
    async get<T>(_key: string): Promise<T | undefined> {
      const response = await stub.fetch("https://execution-coordinator/evolve-learning-memory", { method: "GET" });
      if (!response.ok) throw new Error("EVOLVE_DURABLE_MEMORY_READ_FAILED");
      const body = await response.json() as { value?: T | null };
      return body.value == null ? undefined : body.value;
    },
    async put<T>(_key: string, value: T): Promise<void> {
      const response = await stub.fetch("https://execution-coordinator/evolve-learning-memory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (!response.ok) throw new Error("EVOLVE_DURABLE_MEMORY_WRITE_FAILED");
    },
  });
}

export async function recordCodingExecutionEvidence(namespace: ExecutionCoordinatorNamespace, evidence: CodingExecutionEvidence): Promise<void> {
  const stub = namespace.get(namespace.idFromName(CODING_EVIDENCE_COORDINATOR_KEY));
  const response = await stub.fetch("https://execution-coordinator/coding-evidence", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ evidence }),
  });
  if (!response.ok) throw new Error("CODING_EVIDENCE_PERSIST_FAILED");
}

export async function readCodingExecutionEvidence(namespace: ExecutionCoordinatorNamespace): Promise<{
  readonly evidence: CodingExecutionEvidence | null;
  readonly history: readonly CodingExecutionEvidence[];
}> {
  const stub = namespace.get(namespace.idFromName(CODING_EVIDENCE_COORDINATOR_KEY));
  const response = await stub.fetch("https://execution-coordinator/coding-evidence-history", { method: "GET" });
  if (!response.ok) throw new Error("CODING_EVIDENCE_READ_FAILED");
  const body = await response.json() as { evidence?: unknown; history?: unknown };
  if (body.evidence !== null && body.evidence !== undefined) validatePersistedCodingExecutionEvidence(body.evidence);
  if (!Array.isArray(body.history) || !body.history.every((entry) => {
    try {
      validatePersistedCodingExecutionEvidence(entry);
      return true;
    } catch {
      return false;
    }
  })) throw new Error("CODING_EVIDENCE_READ_INVALID");
  const history = body.history as readonly CodingExecutionEvidence[];
  const latest = history.at(-1) ?? null;
  if (latest !== null && JSON.stringify(body.evidence) !== JSON.stringify(latest)) throw new Error("CODING_EVIDENCE_READ_INVALID");
  if (latest === null && body.evidence != null) throw new Error("CODING_EVIDENCE_READ_INVALID");
  return Object.freeze({ evidence: latest, history: Object.freeze([...history]) });
}

export async function recordAutopilotExecutionTelemetry(namespace: ExecutionCoordinatorNamespace, telemetry: AutopilotExecutionTelemetry): Promise<void> {
  validateAutopilotExecutionTelemetry(telemetry);
  const stub = namespace.get(namespace.idFromName(AUTOPILOT_TELEMETRY_COORDINATOR_KEY));
  const response = await stub.fetch("https://execution-coordinator/execution-telemetry", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ telemetry }),
  });
  if (!response.ok) throw new Error("AUTOPILOT_TELEMETRY_PERSIST_FAILED");
}

export async function readAutopilotExecutionTelemetry(namespace: ExecutionCoordinatorNamespace): Promise<{
  readonly telemetry: AutopilotExecutionTelemetry | null;
  readonly history: readonly AutopilotExecutionTelemetry[];
  readonly summary: AutopilotExecutionTelemetrySummary;
}> {
  const stub = namespace.get(namespace.idFromName(AUTOPILOT_TELEMETRY_COORDINATOR_KEY));
  const response = await stub.fetch("https://execution-coordinator/execution-telemetry", { method: "GET" });
  if (!response.ok) throw new Error("AUTOPILOT_TELEMETRY_READ_FAILED");
  const body = await response.json() as { telemetry?: unknown; history?: unknown; summary?: unknown };
  if (body.telemetry !== null && body.telemetry !== undefined) validateAutopilotExecutionTelemetry(body.telemetry);
  if (!Array.isArray(body.history)) throw new Error("AUTOPILOT_TELEMETRY_READ_INVALID");
  body.history.forEach(validateAutopilotExecutionTelemetry);
  const history = body.history as readonly AutopilotExecutionTelemetry[];
  const latest = history.at(-1) ?? null;
  if (latest !== null && JSON.stringify(body.telemetry) !== JSON.stringify(latest)) throw new Error("AUTOPILOT_TELEMETRY_READ_INVALID");
  if (latest === null && body.telemetry != null) throw new Error("AUTOPILOT_TELEMETRY_READ_INVALID");
  if (!validExecutionTelemetrySummary(body.summary)) throw new Error("AUTOPILOT_TELEMETRY_READ_INVALID");
  const expectedSummary = summarizeExecutionTelemetry(history);
  if (JSON.stringify(body.summary) !== JSON.stringify(expectedSummary)) throw new Error("AUTOPILOT_TELEMETRY_READ_INVALID");
  return Object.freeze({ telemetry: latest, history: Object.freeze([...history]), summary: body.summary });
}
