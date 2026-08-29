import { validatePersistedEvolutionLearningMemory, type EvolutionLearningMemoryStorage } from "./evolveDurableLearningMemory";

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
  state: "LEASED" | "DISPATCHED";
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

const SCHEDULED_RECEIPT_COORDINATOR_KEY = "scheduled-runtime-observability";
const EVOLVE_LEARNING_COORDINATOR_KEY = "evolve-learning-memory";
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

export class ExecutionCoordinator {
  constructor(private readonly ctx: DurableObjectStateLike) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/scheduled-receipt") return this.readScheduledReceipt();
    if (request.method === "GET" && url.pathname === "/evolve-learning-memory") return this.readEvolutionLearningMemory();
    if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    if (url.pathname === "/acquire") return this.acquire(await request.json());
    if (url.pathname === "/dispatched") return this.markDispatched(await request.json());
    if (url.pathname === "/scheduled-receipt") return this.writeScheduledReceipt(await request.json());
    if (url.pathname === "/evolve-learning-memory") return this.writeEvolutionLearningMemory(await request.json());
    return json({ error: "NOT_FOUND" }, 404);
  }

  private async acquire(value: unknown): Promise<Response> {
    if (!validAcquire(value)) return json({ error: "EXECUTION_COORDINATION_REQUEST_INVALID" }, 400);
    const request = value;
    const current = await this.ctx.storage.get<ExecutionRecord>("execution");

    if (current?.dedupeKey === request.dedupeKey) {
      if (current.state === "DISPATCHED") return json({ acquired: false, reason: "ALREADY_DISPATCHED", record: current }, 409);
      if (current.leaseExpiresAt > request.now) return json({ acquired: false, reason: "LEASE_ACTIVE", record: current }, 409);
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

  private async writeScheduledReceipt(value: unknown): Promise<Response> {
    if (!validScheduledReceipt(value)) return json({ error: "SCHEDULED_RUNTIME_RECEIPT_INVALID" }, 400);
    const receipt = Object.freeze({ ...value });
    await this.ctx.storage.put("scheduled-receipt", receipt);
    return json({ updated: true, receipt });
  }

  private async readScheduledReceipt(): Promise<Response> {
    const receipt = await this.ctx.storage.get<ScheduledRuntimeReceipt>("scheduled-receipt");
    return json({ receipt: receipt ?? null });
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
    return json({ value: value ?? null });
  }
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

export async function recordScheduledRuntimeReceipt(namespace: ExecutionCoordinatorNamespace, receipt: ScheduledRuntimeReceipt): Promise<void> {
  const stub = namespace.get(namespace.idFromName(SCHEDULED_RECEIPT_COORDINATOR_KEY));
  const response = await stub.fetch("https://execution-coordinator/scheduled-receipt", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(receipt) });
  if (!response.ok) throw new Error("SCHEDULED_RUNTIME_RECEIPT_PERSIST_FAILED");
}

export async function readScheduledRuntimeReceipt(namespace: ExecutionCoordinatorNamespace): Promise<ScheduledRuntimeReceipt | null> {
  const stub = namespace.get(namespace.idFromName(SCHEDULED_RECEIPT_COORDINATOR_KEY));
  const response = await stub.fetch("https://execution-coordinator/scheduled-receipt", { method: "GET" });
  if (!response.ok) throw new Error("SCHEDULED_RUNTIME_RECEIPT_READ_FAILED");
  const body = await response.json() as { receipt?: ScheduledRuntimeReceipt | null };
  return body.receipt ?? null;
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
