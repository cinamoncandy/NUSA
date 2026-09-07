import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleUxTelemetryEventHttp } from "./uxTelemetryHttp";
import type { DashboardHttpRequest, DashboardPrincipal, DashboardTokenVerifier } from "./mobileDashboardHttp";
import type { UxTelemetryStorage } from "./uxTelemetryJournal";

function memoryStorage(): UxTelemetryStorage {
  const map = new Map<string, unknown>();
  return {
    async get<T>(key: string): Promise<T | undefined> {
      return map.get(key) as T | undefined;
    },
    async put<T>(key: string, value: T): Promise<void> {
      map.set(key, value);
    },
  };
}

function verifierFor(principal: DashboardPrincipal | undefined): DashboardTokenVerifier {
  return {
    verify: (token: string) => (token === "valid-token" ? principal : undefined),
  };
}

const principal: DashboardPrincipal = { userId: "owner-1", scopes: ["telemetry:write"] };

function request(overrides: Partial<DashboardHttpRequest> = {}): DashboardHttpRequest {
  return {
    method: "POST",
    headers: { authorization: "Bearer valid-token" },
    ...overrides,
  };
}

function validEventBody(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    eventId: "evt-1",
    kind: "SCREEN_VIEW",
    sessionId: "session-1",
    ownerPrincipalId: "someone-else",
    screenId: "HOME",
    occurredAtMs: 1_000,
    ...overrides,
  };
}

describe("ux telemetry http ingestion", () => {
  it("accepts a valid event from an authorized principal", async () => {
    const storage = memoryStorage();
    const response = await handleUxTelemetryEventHttp(request(), validEventBody(), {
      tokenVerifier: verifierFor(principal),
      storage,
    });
    assert.equal(response.status, 202);
    assert.deepEqual(JSON.parse(response.body), { status: "ACCEPTED" });
  });

  it("rebinds ownerPrincipalId to the authenticated principal, ignoring the client-claimed one", async () => {
    const storage = memoryStorage();
    await handleUxTelemetryEventHttp(request(), validEventBody({ ownerPrincipalId: "attacker-claimed-owner" }), {
      tokenVerifier: verifierFor(principal),
      storage,
    });
    const stored = (await storage.get<readonly { ownerPrincipalId: string }[]>("ux-telemetry:v1:owner-1:session-1")) ?? [];
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.ownerPrincipalId, "owner-1");
  });

  it("rejects an unauthorized request without touching storage", async () => {
    const storage = memoryStorage();
    const response = await handleUxTelemetryEventHttp(request({ headers: {} }), validEventBody(), {
      tokenVerifier: verifierFor(principal),
      storage,
    });
    assert.equal(response.status, 401);
  });

  it("rejects a principal missing the telemetry:write scope", async () => {
    const storage = memoryStorage();
    const noScope: DashboardPrincipal = { userId: "owner-1", scopes: [] };
    const response = await handleUxTelemetryEventHttp(request(), validEventBody(), {
      tokenVerifier: verifierFor(noScope),
      storage,
    });
    assert.equal(response.status, 403);
  });

  it("rejects a GET request", async () => {
    const storage = memoryStorage();
    const response = await handleUxTelemetryEventHttp(request({ method: "GET" }), validEventBody(), {
      tokenVerifier: verifierFor(principal),
      storage,
    });
    assert.equal(response.status, 405);
  });

  it("returns 400 for a structurally invalid event", async () => {
    const storage = memoryStorage();
    const response = await handleUxTelemetryEventHttp(request(), validEventBody({ kind: "NOT_A_KIND" }), {
      tokenVerifier: verifierFor(principal),
      storage,
    });
    assert.equal(response.status, 400);
    const parsed = JSON.parse(response.body);
    assert.equal(parsed.error, "INVALID_UX_TELEMETRY_EVENT");
  });

  it("returns 400 for a non-object body", async () => {
    const storage = memoryStorage();
    const response = await handleUxTelemetryEventHttp(request(), "not-an-object", {
      tokenVerifier: verifierFor(principal),
      storage,
    });
    assert.equal(response.status, 400);
  });

  it("returns 200 DUPLICATE_IGNORED for a retried event id, not an error", async () => {
    const storage = memoryStorage();
    const deps = { tokenVerifier: verifierFor(principal), storage };
    await handleUxTelemetryEventHttp(request(), validEventBody(), deps);
    const retry = await handleUxTelemetryEventHttp(request(), validEventBody(), deps);
    assert.equal(retry.status, 200);
    assert.deepEqual(JSON.parse(retry.body), { status: "DUPLICATE_IGNORED" });
  });

  it("fails closed with 503 when storage is unavailable", async () => {
    const brokenStorage: UxTelemetryStorage = {
      async get() { throw new Error("unavailable"); },
      async put() { throw new Error("unavailable"); },
    };
    const response = await handleUxTelemetryEventHttp(request(), validEventBody(), {
      tokenVerifier: verifierFor(principal),
      storage: brokenStorage,
    });
    assert.equal(response.status, 503);
  });
});
