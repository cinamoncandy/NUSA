import assert from "node:assert/strict";
import { describe, it } from "node:test";
import worker, {
  classifyGithubEvent,
  computeGithubWebhookSignature,
  verifyGithubWebhookSignature,
} from "./index";

describe("NUSA autopilot GitHub webhook", () => {
  it("classifies only the bounded event surface", () => {
    assert.equal(classifyGithubEvent("ping"), "ping");
    assert.equal(classifyGithubEvent("push"), "push");
    assert.equal(classifyGithubEvent("pull_request"), "pull_request");
    assert.equal(classifyGithubEvent("workflow_run"), "workflow_run");
    assert.equal(classifyGithubEvent("issues"), null);
    assert.equal(classifyGithubEvent(null), null);
  });

  it("verifies the exact request body with HMAC SHA-256", async () => {
    const signature = await computeGithubWebhookSignature("secret", "{\"ok\":true}");
    assert.equal(await verifyGithubWebhookSignature("secret", "{\"ok\":true}", signature), true);
    assert.equal(await verifyGithubWebhookSignature("secret", "{\"ok\":false}", signature), false);
    assert.equal(await verifyGithubWebhookSignature("secret", "{\"ok\":true}", null), false);
  });

  it("fails closed when the secret is absent", async () => {
    const response = await worker.fetch(new Request("https://example.test/github/webhook", {
      method: "POST",
      headers: { "x-github-delivery": "delivery-1", "x-github-event": "push" },
      body: "{}",
    }), {});
    assert.equal(response.status, 503);
  });

  it("rejects missing delivery identity and unsupported events", async () => {
    const noDelivery = await worker.fetch(new Request("https://example.test/github/webhook", {
      method: "POST",
      headers: { "x-github-event": "push" },
      body: "{}",
    }), { NUSA_WEBHOOK_SECRET: "secret" });
    assert.equal(noDelivery.status, 400);

    const unsupported = await worker.fetch(new Request("https://example.test/github/webhook", {
      method: "POST",
      headers: { "x-github-delivery": "delivery-2", "x-github-event": "issues" },
      body: "{}",
    }), { NUSA_WEBHOOK_SECRET: "secret" });
    assert.equal(unsupported.status, 422);
  });

  it("rejects invalid signatures and plans a valid bounded event without executing mutation", async () => {
    const body = JSON.stringify({
      ref: "refs/heads/main",
      after: "a".repeat(40),
      repository: { full_name: "cinamoncandy/NUSA" },
    });
    const invalid = await worker.fetch(new Request("https://example.test/github/webhook", {
      method: "POST",
      headers: {
        "x-github-delivery": "delivery-3",
        "x-github-event": "push",
        "x-hub-signature-256": "sha256=deadbeef",
      },
      body,
    }), { NUSA_WEBHOOK_SECRET: "secret" });
    assert.equal(invalid.status, 401);

    const signature = await computeGithubWebhookSignature("secret", body);
    const valid = await worker.fetch(new Request("https://example.test/github/webhook", {
      method: "POST",
      headers: {
        "x-github-delivery": "delivery-4",
        "x-github-event": "push",
        "x-hub-signature-256": signature,
      },
      body,
    }), { NUSA_WEBHOOK_SECRET: "secret" });
    assert.equal(valid.status, 202);
    const payload = await valid.json() as {
      accepted: boolean;
      status: string;
      dispatch: { kind: string; headSha: string; mutationAllowed: boolean };
      execution: string;
    };
    assert.equal(payload.accepted, true);
    assert.equal(payload.status, "DISPATCH_PLANNED");
    assert.equal(payload.dispatch.kind, "MAIN_PUSH");
    assert.equal(payload.dispatch.headSha, "a".repeat(40));
    assert.equal(payload.dispatch.mutationAllowed, false);
    assert.equal(payload.execution, "NOT_YET_ENABLED");
  });

  it("rejects malformed signed JSON instead of planning from partial data", async () => {
    const body = "{";
    const signature = await computeGithubWebhookSignature("secret", body);
    const response = await worker.fetch(new Request("https://example.test/github/webhook", {
      method: "POST",
      headers: {
        "x-github-delivery": "delivery-json",
        "x-github-event": "push",
        "x-hub-signature-256": signature,
      },
      body,
    }), { NUSA_WEBHOOK_SECRET: "secret" });
    assert.equal(response.status, 400);
  });
});
