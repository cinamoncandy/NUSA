import { DurableObject } from "cloudflare:workers";

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

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8" },
});

function validText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 512;
}

function validAcquire(value: unknown): value is AcquireRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AcquireRequest>;
  return validText(candidate.dedupeKey)
    && validText(candidate.executionId)
    && Number.isFinite(candidate.now)
    && Number.isFinite(candidate.leaseExpiresAt)
    && Number(candidate.leaseExpiresAt) > Number(candidate.now);
}

export class ExecutionCoordinator extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    const url = new URL(request.url);
    if (url.pathname === "/acquire") return this.acquire(await request.json());
    if (url.pathname === "/dispatched") return this.markDispatched(await request.json());
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
    if (!validText(request.dedupeKey) || !validText(request.executionId) || !Number.isFinite(request.now)) return json({ error: "EXECUTION_COORDINATION_REQUEST_INVALID" }, 400);
    const current = await this.ctx.storage.get<ExecutionRecord>("execution");
    if (!current || current.dedupeKey !== request.dedupeKey || current.executionId !== request.executionId) return json({ error: "EXECUTION_LEASE_MISMATCH" }, 409);
    const record: ExecutionRecord = Object.freeze({ ...current, state: "DISPATCHED", updatedAt: Number(request.now) });
    await this.ctx.storage.put("execution", record);
    return json({ updated: true, record });
  }
}

export interface ExecutionCoordinatorNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

export async function acquirePersistentExecution(
  namespace: ExecutionCoordinatorNamespace,
  input: AcquireRequest,
): Promise<{ acquired: boolean; reason?: string }> {
  const stub = namespace.get(namespace.idFromName(input.dedupeKey));
  const response = await stub.fetch("https://execution-coordinator/acquire", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await response.json() as { acquired?: boolean; reason?: string };
  if (response.status === 201 && body.acquired === true) return { acquired: true };
  if (response.status === 409 && body.acquired === false) return { acquired: false, reason: body.reason ?? "DUPLICATE_EXECUTION" };
  throw new Error("PERSISTENT_EXECUTION_COORDINATION_FAILED");
}

export async function markPersistentExecutionDispatched(
  namespace: ExecutionCoordinatorNamespace,
  input: { dedupeKey: string; executionId: string; now: number },
): Promise<void> {
  const stub = namespace.get(namespace.idFromName(input.dedupeKey));
  const response = await stub.fetch("https://execution-coordinator/dispatched", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error("PERSISTENT_EXECUTION_DISPATCH_RECONCILIATION_FAILED");
}
