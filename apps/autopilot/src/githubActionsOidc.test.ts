import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { verifyGithubActionsOidcToken } from "./githubActionsOidc";

const repository = "cinamoncandy/NUSA";
const now = 1_788_061_200;

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
  it("accepts only the trusted main repository_dispatch workflow", async () => {
    const valid = await fixture();
    await verifyGithubActionsOidcToken(valid.token, repository, valid.fetch, now);
  });

  it("rejects a token from another workflow or branch", async () => {
    const wrongWorkflow = await fixture({ workflow_ref: `${repository}/.github/workflows/ci.yml@refs/heads/main` });
    await assert.rejects(() => verifyGithubActionsOidcToken(wrongWorkflow.token, repository, wrongWorkflow.fetch, now), /CODING_RUNNER_OIDC_WORKFLOW_INVALID/);

    const wrongRef = await fixture({ ref: "refs/heads/feature" });
    await assert.rejects(() => verifyGithubActionsOidcToken(wrongRef.token, repository, wrongRef.fetch, now), /CODING_RUNNER_OIDC_REF_INVALID/);
  });

  it("rejects wrong audience and expired tokens", async () => {
    const wrongAudience = await fixture({ aud: "other-service" });
    await assert.rejects(() => verifyGithubActionsOidcToken(wrongAudience.token, repository, wrongAudience.fetch, now), /CODING_RUNNER_OIDC_AUDIENCE_INVALID/);

    const expired = await fixture({ exp: now - 120 });
    await assert.rejects(() => verifyGithubActionsOidcToken(expired.token, repository, expired.fetch, now), /CODING_RUNNER_OIDC_EXPIRED/);
  });
});
