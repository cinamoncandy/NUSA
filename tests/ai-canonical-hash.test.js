const test = require("node:test");
const assert = require("node:assert/strict");
const { aiSha256, canonicalAiJson } = require("../dist/packages/contracts/src/aiInference.js");

test("canonical AI object hashing treats undefined optional fields as absent", () => {
  assert.equal(canonicalAiJson({ b: undefined, a: 1 }), '{"a":1}');
  assert.equal(aiSha256({ a: 1, optional: undefined }), aiSha256({ a: 1 }));
});

test("canonical AI arrays still reject undefined values instead of silently changing position semantics", () => {
  assert.throws(() => canonicalAiJson([1, undefined, 2]), /unsupported AI value/);
});
