const test = require("node:test");
const assert = require("node:assert/strict");
const { isAuthorized } = require("../dist/apps/server/src/apiAuth.js");

test("no configured key means every request is authorized (auth disabled, today's default)", () => {
  assert.equal(isAuthorized(undefined, undefined), true);
  assert.equal(isAuthorized("Bearer anything", undefined), true);
  assert.equal(isAuthorized("garbage", undefined), true);
});

test("a configured key requires a matching Authorization: Bearer <key> header", () => {
  assert.equal(isAuthorized("Bearer secret123", "secret123"), true);
  assert.equal(isAuthorized("Bearer wrong", "secret123"), false);
  assert.equal(isAuthorized(undefined, "secret123"), false, "missing header entirely");
  assert.equal(isAuthorized("secret123", "secret123"), false, "missing the Bearer prefix");
  assert.equal(isAuthorized("Basic secret123", "secret123"), false, "wrong auth scheme");
});

test("differing lengths never reach timingSafeEqual (which throws on length mismatch)", () => {
  assert.equal(isAuthorized("Bearer short", "a-much-longer-configured-key"), false);
  assert.equal(isAuthorized("Bearer a-much-longer-provided-key", "short"), false);
});

test("an empty configured key is treated the same as unconfigured (falsy) -- auth stays disabled", () => {
  assert.equal(isAuthorized(undefined, ""), true);
  assert.equal(isAuthorized("Bearer anything", ""), true);
});
