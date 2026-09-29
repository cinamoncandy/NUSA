import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  verifyGithubActionsOidcToken,
  verifyGithubEventBridgeOidcToken,
  verifyGithubReleaseControlOidcToken,
} from "./githubActionsOidc";

const repository = "cinamoncandy/NUSA";
const now = 1_788_061_200;
const releaseWorkflowRef = `${repository}/.github/workflows/autopilot-deterministic-audit-release.yml@refs/heads/main`;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function encodedJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function fixture(overrides: Record<string, unknown> = {}) {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const kid = "test-key";
  const header = encodedJson({ alg: "RS256", kid, typ: "JWT" });
  const claims = encodedJson({
    iss: "https://token.actions.githubusercontent.com",
    aud: "nusa-autopilot",
    exp: now + 300,
    nbf: now - 10,
    iat: now - 10,
    repository,
    repository_id: "1296492411",
    ref: "refs/heads/main",
    event_name: "repository_dispatch",
    workflow_ref: `${repository}/.github/workflows/autopilot-execution-consumer.yml@refs/heads/main`,
    ...overrides,
  });
  const signed = new TextEncoder().encode(`${header}.${claims}`);
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, signed));
  const token = `${header}.${claims}.${base64Url(signature)}`;
  return {
    token,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ keys: [{ ...publicJwk, kid, alg: "RS256", use: "sig" }] }) }),
  };
}

describe("GitHub Actions OIDC", () => {
  it("accepts the trusted execution consumer workflow", async () => {
    const valid = await fixture();
    await verifyGithubActionsOidcToken(valid.token, repository, valid.fetch, now);
  });

  it("rejects a token from another coding workflow or branch", async () => {
    const wrongWorkflow = await fixture({ workflow_ref: `${repository}/.github/workflows/ci.yml@refs/heads/main` });
    await assert.rejects(() => verifyGithubActionsOidcToken(wrongWorkflow.token, repository, wrongWorkflow.fetch, now), /CODING_RUNNER_OIDC_WORKFLOW_INVALID/);

    const obsoleteBridge = await fixture({ workflow_ref: `${repository}/.github/workflows/autopilot-worker-dispatch-bridge.yml@refs/heads/main` });
    await assert.rejects(() => verifyGithubActionsOidcToken(obsoleteBridge.token, repository, obsoleteBridge.fetch, now), /CODING_RUNNER_OIDC_WORKFLOW_INVALID/);

    const wrongRef = await fixture({ ref: "refs/heads/feature" });
    await assert.rejects(() => verifyGithubActionsOidcToken(wrongRef.token, repository, wrongRef.fetch, now), /CODING_RUNNER_OIDC_REF_INVALID/);
  });

  it("accepts only the trusted event bridge workflow and bounded event surface", async () => {
    const valid = await fixture({
      workflow_ref: `${repository}/.github/workflows/autopilot-github-event-bridge.yml@refs/heads/main`,
      event_name: "workflow_run",
      ref: "refs/heads/feature-pr-head",
    });
    await verifyGithubEventBridgeOidcToken(valid.token, repository, valid.fetch, now);

    const wrongWorkflow = await fixture({
      workflow_ref: `${repository}/.github/workflows/ci.yml@refs/heads/main`,
      event_name: "workflow_run",
    });
    await assert.rejects(() => verifyGithubEventBridgeOidcToken(wrongWorkflow.token, repository, wrongWorkflow.fetch, now), /EVENT_BRIDGE_OIDC_WORKFLOW_INVALID/);

    const wrongEvent = await fixture({
      workflow_ref: `${repository}/.github/workflows/autopilot-github-event-bridge.yml@refs/heads/main`,
      event_name: "issues",
    });
    await assert.rejects(() => verifyGithubEventBridgeOidcToken(wrongEvent.token, repository, wrongEvent.fetch, now), /EVENT_BRIDGE_OIDC_EVENT_INVALID/);
  });

  it("accepts only the canonical Release control workflow identity", async () => {
    const valid = await fixture({ workflow_ref: releaseWorkflowRef });
    await verifyGithubReleaseControlOidcToken(valid.token, repository, valid.fetch, now);

    const wrongWorkflow = await fixture({ workflow_ref: `${repository}/.github/workflows/autopilot-execution-consumer.yml@refs/heads/main` });
    await assert.rejects(() => verifyGithubReleaseControlOidcToken(wrongWorkflow.token, repository, wrongWorkflow.fetch, now), /RELEASE_CONTROL_OIDC_WORKFLOW_INVALID/);

    const wrongRepository = await fixture({ repository: "other/NUSA", workflow_ref: releaseWorkflowRef });
    await assert.rejects(() => verifyGithubReleaseControlOidcToken(wrongRepository.token, repository, wrongRepository.fetch, now), /RELEASE_CONTROL_OIDC_REPOSITORY_INVALID/);

    const wrongAudience = await fixture({ aud: "other-service", workflow_ref: releaseWorkflowRef });
    await assert.rejects(() => verifyGithubReleaseControlOidcToken(wrongAudience.token, repository, wrongAudience.fetch, now), /RELEASE_CONTROL_OIDC_AUDIENCE_INVALID/);

    const wrongRef = await fixture({ ref: "refs/heads/feature", workflow_ref: releaseWorkflowRef });
    await assert.rejects(() => verifyGithubReleaseControlOidcToken(wrongRef.token, repository, wrongRef.fetch, now), /RELEASE_CONTROL_OIDC_REF_INVALID/);

    const wrongEvent = await fixture({ event_name: "workflow_run", workflow_ref: releaseWorkflowRef });
    await assert.rejects(() => verifyGithubReleaseControlOidcToken(wrongEvent.token, repository, wrongEvent.fetch, now), /RELEASE_CONTROL_OIDC_EVENT_INVALID/);

    const expired = await fixture({ exp: now - 120, workflow_ref: releaseWorkflowRef });
    await assert.rejects(() => verifyGithubReleaseControlOidcToken(expired.token, repository, expired.fetch, now), /RELEASE_CONTROL_OIDC_EXPIRED/);

    const badSignature = await fixture({ workflow_ref: releaseWorkflowRef });
    const [header, claims] = badSignature.token.split(".");
    const forged = `${header}.${claims}.${base64Url(new Uint8Array(256))}`;
    await assert.rejects(() => verifyGithubReleaseControlOidcToken(forged, repository, badSignature.fetch, now), /RELEASE_CONTROL_OIDC_SIGNATURE_INVALID/);
  });

  it("rejects wrong audience and expired coding tokens", async () => {
    const wrongAudience = await fixture({ aud: "other-service" });
    await assert.rejects(() => verifyGithubActionsOidcToken(wrongAudience.token, repository, wrongAudience.fetch, now), /CODING_RUNNER_OIDC_AUDIENCE_INVALID/);

    const expired = await fixture({ exp: now - 120 });
    await assert.rejects(() => verifyGithubActionsOidcToken(expired.token, repository, expired.fetch, now), /CODING_RUNNER_OIDC_EXPIRED/);
  });
});
