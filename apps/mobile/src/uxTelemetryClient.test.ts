import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emitUxTelemetryEvent, type UxTelemetryClientOptions } from "./uxTelemetryClient";

function baseOptions(overrides: Partial<UxTelemetryClientOptions> = {}): UxTelemetryClientOptions {
  return {
    baseUrl: "https://cloud.example.com",
    credentialProvider: async () => "token-123",
    sessionId: "session-1",
    enabled: true,
    ...overrides,
  };
}

function fakeFetch(status: number): typeof fetch {
  const calls: unknown[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status } as Response;
  }) as typeof fetch;
  (impl as unknown as { calls: unknown[] }).calls = calls;
  return impl;
}

describe("emitUxTelemetryEvent", () => {
  it("skips when telemetry is disabled, without calling fetch", async () => {
    const request = fakeFetch(202);
    const result = await emitUxTelemetryEvent(
      { kind: "SCREEN_VIEW", screenId: "HOME" },
      baseOptions({ enabled: false, request }),
    );
    assert.equal(result, "SKIPPED_DISABLED");
    assert.equal((request as unknown as { calls: unknown[] }).calls.length, 0);
  });

  it("skips on an insecure (non-https, non-localhost) endpoint", async () => {
    const request = fakeFetch(202);
    const result = await emitUxTelemetryEvent(
      { kind: "SCREEN_VIEW", screenId: "HOME" },
      baseOptions({ baseUrl: "http://example.com", request }),
    );
    assert.equal(result, "SKIPPED_INSECURE_ENDPOINT");
    assert.equal((request as unknown as { calls: unknown[] }).calls.length, 0);
  });

  it("allows an http localhost endpoint", async () => {
    const request = fakeFetch(202);
    const result = await emitUxTelemetryEvent(
      { kind: "SCREEN_VIEW", screenId: "HOME" },
      baseOptions({ baseUrl: "http://localhost:8787", request }),
    );
    assert.equal(result, "SENT");
  });

  it("skips when the credential provider returns null", async () => {
    const request = fakeFetch(202);
    const result = await emitUxTelemetryEvent(
      { kind: "SCREEN_VIEW", screenId: "HOME" },
      baseOptions({ credentialProvider: async () => null, request }),
    );
    assert.equal(result, "SKIPPED_NO_CREDENTIAL");
    assert.equal((request as unknown as { calls: unknown[] }).calls.length, 0);
  });

  it("skips (never throws) when the credential provider throws", async () => {
    const request = fakeFetch(202);
    const result = await emitUxTelemetryEvent(
      { kind: "SCREEN_VIEW", screenId: "HOME" },
      baseOptions({
        credentialProvider: async () => { throw new Error("keychain unavailable"); },
        request,
      }),
    );
    assert.equal(result, "SKIPPED_NO_CREDENTIAL");
  });

  it("sends a well-formed event with a Bearer token and never the caller's raw ownerPrincipalId", async () => {
    const request = fakeFetch(202);
    const result = await emitUxTelemetryEvent(
      { kind: "TAP", screenId: "PORTFOLIO", actionId: "REFRESH" },
      baseOptions({ request }),
    );
    assert.equal(result, "SENT");
    const call = (request as unknown as { calls: { url: string; init: RequestInit }[] }).calls[0];
    assert.equal(call.url, "https://cloud.example.com/api/ux-telemetry");
    assert.equal((call.init.headers as Record<string, string>).authorization, "Bearer token-123");
    const body = JSON.parse(call.init.body as string);
    assert.equal(body.kind, "TAP");
    assert.equal(body.screenId, "PORTFOLIO");
    assert.equal(body.actionId, "REFRESH");
    assert.equal(body.ownerPrincipalId, "self");
    assert.equal(body.sessionId, "session-1");
  });

  it("returns SKIPPED_FAILED (never throws) on a network error", async () => {
    const request = (async () => { throw new Error("network down"); }) as unknown as typeof fetch;
    const result = await emitUxTelemetryEvent({ kind: "SCREEN_VIEW", screenId: "HOME" }, baseOptions({ request }));
    assert.equal(result, "SKIPPED_FAILED");
  });

  it("returns SKIPPED_FAILED when the server responds with a non-2xx, non-202 status", async () => {
    const request = fakeFetch(500);
    const result = await emitUxTelemetryEvent({ kind: "SCREEN_VIEW", screenId: "HOME" }, baseOptions({ request }));
    assert.equal(result, "SKIPPED_FAILED");
  });

  it("strips trailing slashes from the base URL before building the endpoint", async () => {
    const request = fakeFetch(202);
    await emitUxTelemetryEvent({ kind: "SCREEN_VIEW", screenId: "HOME" }, baseOptions({ baseUrl: "https://cloud.example.com///", request }));
    const call = (request as unknown as { calls: { url: string }[] }).calls[0];
    assert.equal(call.url, "https://cloud.example.com/api/ux-telemetry");
  });
});
