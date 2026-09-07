import assert from "node:assert/strict";
import { describe, it } from "node:test";
import worker from "./index";

const repository = "cinamoncandy/NUSA";

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function encodedJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function bridgeToken(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const kid = "bridge-test-key";
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
    event_name: "push",
    workflow_ref: `${repository}/.github/workflows/autopilot-github-event-bridge.yml@refs/heads/main`,
    ...overrides,
  });
  const signed = new TextEncoder().encode(`${header}.${claims}`);
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, signed));
  return {
    token: `${header}.${claims}.${base64Url(signature)}`,
    jwks: { keys: [{ ...publicJwk, kid, alg: "RS256", use: "sig" }] },
  };
}

describe("Autopilot event bridge OIDC ingress", () => {
  it("accepts the trusted bridge without NUSA_WEBHOOK_SECRET", async () => {
    const fixture = await bridgeToken();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify(fixture.jwks), { status: 200 });
    try {
      const body = JSON.stringify({
        ref: "refs/heads/main",
        after: "a".repeat(40),
        repository: { full_name: repository },
      });
      const response = await worker.fetch(new Request("https://example.test/github/webhook", {
        method: "POST",
        headers: {
          authorization: `Bearer ${fixture.token}`,
          "x-github-delivery": "oidc-delivery-1",
          "x-github-event": "push",
        },
        body,
      }), {});
      assert.equal(response.status, 202);
      const payload = await response.json() as { accepted: boolean; liveAuthority: string; productionMutationAllowed: boolean; aiAuthority: string };
      assert.equal(payload.accepted, true);
      assert.equal(payload.liveAuthority, "NONE");
      assert.equal(payload.productionMutationAllowed, false);
      assert.equal(payload.aiAuthority, "ZERO_AUTHORITY");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects a bearer token from an untrusted workflow", async () => {
    const fixture = await bridgeToken({ workflow_ref: `${repository}/.github/workflows/ci.yml@refs/heads/main` });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify(fixture.jwks), { status: 200 });
    try {
      const response = await worker.fetch(new Request("https://example.test/github/webhook", {
        method: "POST",
        headers: {
          authorization: `Bearer ${fixture.token}`,
          "x-github-delivery": "oidc-delivery-2",
          "x-github-event": "push",
        },
        body: JSON.stringify({ ref: "refs/heads/main", after: "a".repeat(40), repository: { full_name: repository } }),
      }), {});
      assert.equal(response.status, 401);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
