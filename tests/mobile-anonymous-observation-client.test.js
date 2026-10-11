const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { loadAnonymousPaperObservation, resolveObservationEndpoint } = require("../dist/apps/mobile/src/observation/anonymousObservationClient.js");
const source = fs.readFileSync(path.join(__dirname, "../apps/mobile/src/observation/anonymousObservationClient.ts"), "utf8");

function respond(status, body) {
  return async () => ({ ok: status >= 200 && status < 300, status, redirected: false, url: "", json: async () => body });
}

test("anonymous client is GET-only and never attaches Authorization", () => {
  assert.match(source, /const OBSERVATION_PATH = "\/api\/paper-operations"/);
  assert.match(source, /method: "GET"/);
  assert.doesNotMatch(source, /authorization\s*:/i);
  assert.doesNotMatch(source, /credentialProvider/);
  assert.doesNotMatch(source, /method: "POST"|method: "PUT"|method: "DELETE"/);
});

test("remote plaintext and URL credentials are refused while loopback HTTP remains available", () => {
  assert.equal(resolveObservationEndpoint({ baseUrl: "http://paper.example.test" }), null);
  assert.equal(resolveObservationEndpoint({ baseUrl: "https://user:pw@paper.example.test" }), null);
  assert.equal(resolveObservationEndpoint({ baseUrl: "https://paper.example.test/" }), "https://paper.example.test");
  assert.equal(resolveObservationEndpoint({ baseUrl: "http://127.0.0.1:8080" }), "http://127.0.0.1:8080");
});

test("401 and 403 remain unavailable and are never retried with credentials", async () => {
  for (const status of [401, 403]) {
    let calls = 0;
    const result = await loadAnonymousPaperObservation({ baseUrl: "https://paper.example.test", request: async (...args) => { calls += 1; return respond(status, {})(...args); } });
    assert.equal(result.status, "UNAVAILABLE");
    assert.equal(calls, 1);
  }
});
