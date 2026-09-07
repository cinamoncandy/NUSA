const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const safePayload = {
  accepted: true,
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  aiAuthority: "ZERO_AUTHORITY",
  executor: {
    status: "DISPATCHED",
    reason: "github-repository-dispatch-accepted",
    httpStatus: 204,
  },
};

describe("Autopilot GitHub Event Bridge OIDC dispatch", () => {
  it("requests a bounded GitHub Actions OIDC audience without exposing the request token", async () => {
    const { requestGithubActionsOidcToken } = await import("../scripts/dispatch-github-event-to-autopilot.mjs");
    let observedUrl = "";
    let observedAuthorization = "";
    const token = await requestGithubActionsOidcToken({
      requestUrl: "https://actions.example.test/oidc?base=1",
      requestToken: "request-secret",
      fetchImpl: async (input, init) => {
        observedUrl = String(input);
        observedAuthorization = init.headers.authorization;
        return new Response(JSON.stringify({ value: "short-lived-oidc" }), { status: 200 });
      },
    });
    assert.equal(token, "short-lived-oidc");
    assert.match(observedUrl, /audience=nusa-autopilot/);
    assert.equal(observedAuthorization, "Bearer request-secret");
  });

  it("prefers OIDC delivery when no static webhook secret exists", async () => {
    const { dispatchGithubEvent } = await import("../scripts/dispatch-github-event-to-autopilot.mjs");
    let headers;
    const result = await dispatchGithubEvent({
      oidcToken: "short-lived-oidc",
      body: Buffer.from("{}"),
      event: "workflow_run",
      repository: "cinamoncandy/NUSA",
      runId: "42",
      runAttempt: "1",
      retryDelayMs: 0,
      fetchImpl: async (_input, init) => {
        headers = init.headers;
        return new Response(JSON.stringify(safePayload), { status: 202 });
      },
    });
    assert.equal(result.status, "DELIVERED");
    assert.equal(result.authentication, "OIDC");
    assert.equal(result.executorStatus, "DISPATCHED");
    assert.equal(headers.authorization, "Bearer short-lived-oidc");
    assert.equal("x-hub-signature-256" in headers, false);
  });

  it("fails closed when neither OIDC nor HMAC authentication is available", async () => {
    const { dispatchGithubEvent } = await import("../scripts/dispatch-github-event-to-autopilot.mjs");
    await assert.rejects(() => dispatchGithubEvent({
      body: Buffer.from("{}"),
      event: "push",
      repository: "cinamoncandy/NUSA",
      runId: "43",
      runAttempt: "1",
    }), /WEBHOOK_AUTH_REQUIRED/);
  });
});
