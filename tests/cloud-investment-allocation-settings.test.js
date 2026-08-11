const test = require("node:test");
const assert = require("node:assert/strict");

const {
  InMemoryInvestmentAllocationSettingsRepository,
  normalizeInvestmentPercent
} = require("../dist/apps/cloud/src/cloudInvestmentAllocationSettings.js");
const { handleInvestmentAllocationHttp } = require("../dist/apps/cloud/src/investmentAllocationHttp.js");

const principal = (userId, scopes = ["settings:read", "settings:write"]) => ({ userId, scopes });
const verifier = { verify: (token) => token === "alice" ? principal("alice") : token === "bob" ? principal("bob") : undefined };
const request = (method, token, body) => ({ method, headers: { authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const call = (repo, method, token, body) => JSON.parse(handleInvestmentAllocationHttp(request(method, token, body), { tokenVerifier: verifier, repository: repo }).body);

test("investment allocation is authenticated, isolated, validated, idempotent, and revision protected", () => {
  const repo = new InMemoryInvestmentAllocationSettingsRepository();
  assert.equal(handleInvestmentAllocationHttp(request("GET", "missing"), { tokenVerifier: verifier, repository: repo }).status, 401);
  assert.deepEqual(call(repo, "GET", "alice"), { investmentPercent: 100, reservePercent: 0, revision: 0, source: "DEFAULT" });
  assert.equal(call(repo, "PUT", "alice", { investmentPercent: 60 }).investmentPercent, 60);
  const saved = call(repo, "GET", "alice");
  assert.deepEqual(saved, { investmentPercent: 60, reservePercent: 40, revision: 1, source: "USER_SETTING" });
  assert.deepEqual(call(repo, "GET", "bob"), { investmentPercent: 100, reservePercent: 0, revision: 0, source: "DEFAULT" });
  assert.equal(call(repo, "PUT", "alice", { investmentPercent: 60, revision: 1 }).revision, 1);
  assert.equal(handleInvestmentAllocationHttp(request("PUT", "alice", { investmentPercent: 61, revision: 0 }), { tokenVerifier: verifier, repository: repo }).status, 409);
  for (const value of [-1, 100.01, Number.NaN, Number.POSITIVE_INFINITY, "60", null]) {
    assert.throws(() => normalizeInvestmentPercent(value));
  }
  for (const value of [0, 100]) assert.equal(normalizeInvestmentPercent(value), value);
});

test("settings write requires the write scope", () => {
  const repo = new InMemoryInvestmentAllocationSettingsRepository();
  const readOnly = { verify: () => principal("alice", ["settings:read"]) };
  assert.equal(handleInvestmentAllocationHttp(request("PUT", "alice", { investmentPercent: 50 }), { tokenVerifier: readOnly, repository: repo }).status, 403);
});
