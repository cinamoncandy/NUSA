"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const {
  CONTEXT,
  configured,
  createAppJwt,
  parseArgs,
  publish,
} = require("../scripts/publish-release-authority-status.js");

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

test("release authority is bootstrap-optional but partial configuration fails closed", () => {
  assert.equal(configured({}), false);
  assert.throws(
    () => configured({ NUSA_RELEASE_AUTHORITY_APP_ID: "123" }),
    /configuration is partial/,
  );
});

test("release authority JWT is short-lived and bound to the configured app id", () => {
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  const jwt = createAppJwt("12345", pem, 2_000_000_000);
  const [header, payload, signature] = jwt.split(".");
  assert.equal(JSON.parse(Buffer.from(header, "base64url").toString("utf8")).alg, "RS256");
  assert.deepEqual(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")), {
    iat: 1_999_999_940,
    exp: 2_000_000_540,
    iss: "12345",
  });
  assert.ok(signature.length > 100);
});

test("publisher requests a repo-scoped status token and publishes the exact-head gate", async () => {
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const env = {
    NUSA_RELEASE_AUTHORITY_APP_ID: "12345",
    NUSA_RELEASE_AUTHORITY_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }),
  };
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/repos/cinamoncandy/NUSA/installation")) return response(200, { id: 777 });
    if (url.endsWith("/app/installations/777/access_tokens")) return response(201, { token: "installation-token" });
    if (url.endsWith(`/repos/cinamoncandy/NUSA/statuses/${HEAD}`)) {
      const body = JSON.parse(options.body);
      return response(201, { ...body, sha: HEAD });
    }
    return response(404, {});
  };

  const input = parseArgs([
    "--repo", "cinamoncandy/NUSA",
    "--sha", HEAD,
    "--state", "success",
    "--audited-base", BASE,
    "--pr", "1803",
    "--target-url", "https://github.com/cinamoncandy/NUSA/actions/runs/1",
  ]);
  const result = await publish(input, env, fetchImpl);

  assert.deepEqual(result, { configured: true, published: true, context: CONTEXT, state: "success" });
  assert.equal(calls.length, 3);
  const tokenRequest = JSON.parse(calls[1].options.body);
  assert.deepEqual(tokenRequest, { repositories: ["NUSA"], permissions: { statuses: "write" } });
  const statusRequest = JSON.parse(calls[2].options.body);
  assert.equal(statusRequest.context, CONTEXT);
  assert.equal(statusRequest.state, "success");
  assert.match(statusRequest.description, /Audit PASS PR #1803/);
  assert.equal(calls[2].options.headers.Authorization, "Bearer installation-token");
});
