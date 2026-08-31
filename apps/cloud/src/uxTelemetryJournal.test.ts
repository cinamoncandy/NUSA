import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appendUxTelemetryEvent, readUxTelemetrySession, type UxTelemetryStorage } from "./uxTelemetryJournal";
import type { UxTelemetryEvent } from "../../../packages/contracts/src/uxTelemetryEvent";

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

function event(overrides: Partial<UxTelemetryEvent> = {}): UxTelemetryEvent {
  return {
    schemaVersion: 1,
    eventId: "evt-1",
    kind: "SCREEN_VIEW",
    sessionId: "session-1",
    ownerPrincipalId: "owner-1",
    screenId: "HOME",
    occurredAtMs: 1_000,
    ...overrides,
  };
}

describe("ux telemetry journal", () => {
  it("appends a valid event and reads it back", async () => {
    const storage = memoryStorage();
    const result = await appendUxTelemetryEvent(storage, event());
    assert.deepEqual(result, { appended: true });
    const read = await readUxTelemetrySession(storage, "owner-1", "session-1");
    assert.equal(read.ok, true);
    assert.equal(read.events.length, 1);
    assert.equal(read.events[0]?.eventId, "evt-1");
  });

  it("rejects an invalid event without touching storage", async () => {
    const storage = memoryStorage();
    const result = await appendUxTelemetryEvent(storage, { ...event(), kind: "NOT_A_KIND" });
    assert.equal(result.appended, false);
    if (!result.appended) assert.equal(result.reason, "EVENT_INVALID");
    const read = await readUxTelemetrySession(storage, "owner-1", "session-1");
    assert.equal(read.events.length, 0);
  });

  it("deduplicates a retried event id within the same session", async () => {
    const storage = memoryStorage();
    await appendUxTelemetryEvent(storage, event());
    const retry = await appendUxTelemetryEvent(storage, event());
    assert.equal(retry.appended, false);
    if (!retry.appended) assert.equal(retry.reason, "DUPLICATE_EVENT_ID");
    const read = await readUxTelemetrySession(storage, "owner-1", "session-1");
    assert.equal(read.events.length, 1);
  });

  it("keeps events ordered by occurredAtMs regardless of append order", async () => {
    const storage = memoryStorage();
    await appendUxTelemetryEvent(storage, event({ eventId: "evt-2", occurredAtMs: 2_000 }));
    await appendUxTelemetryEvent(storage, event({ eventId: "evt-1", occurredAtMs: 1_000 }));
    const read = await readUxTelemetrySession(storage, "owner-1", "session-1");
    assert.deepEqual(read.events.map((entry) => entry.eventId), ["evt-1", "evt-2"]);
  });

  it("scopes events to the exact owner/session pair", async () => {
    const storage = memoryStorage();
    await appendUxTelemetryEvent(storage, event());
    const otherOwner = await readUxTelemetrySession(storage, "owner-2", "session-1");
    const otherSession = await readUxTelemetrySession(storage, "owner-1", "session-2");
    assert.equal(otherOwner.events.length, 0);
    assert.equal(otherSession.events.length, 0);
  });

  it("fails closed when the storage read throws", async () => {
    const storage: UxTelemetryStorage = {
      async get() { throw new Error("storage unavailable"); },
      async put() {},
    };
    const read = await readUxTelemetrySession(storage, "owner-1", "session-1");
    assert.equal(read.ok, false);
    assert.deepEqual(read.events, []);
  });

  it("fails closed when the storage write throws", async () => {
    const storage: UxTelemetryStorage = {
      async get() { return undefined; },
      async put() { throw new Error("storage unavailable"); },
    };
    const result = await appendUxTelemetryEvent(storage, event());
    assert.equal(result.appended, false);
    if (!result.appended) assert.equal(result.reason, "STORAGE_UNCERTAIN");
  });
});
