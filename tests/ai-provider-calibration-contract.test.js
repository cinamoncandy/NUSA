const test = require("node:test");
const assert = require("node:assert/strict");
const { openAiStructuredOutputSchema } = require("../dist/apps/cloud/src/ai/openAiResponsesModelProvider.js");

test("STRATEGY_PROPOSER provider schema requires a bounded numeric raw probability", () => {
  const schema = openAiStructuredOutputSchema("STRATEGY_PROPOSER");
  const payload = schema.properties.payload;
  assert.ok(payload.required.includes("rawProbability"));
  assert.deepEqual(payload.properties.rawProbability, { type: "number", minimum: 0, maximum: 1 });
});

test("non-proposer schemas do not invent a raw probability field", () => {
  for (const role of ["EVIDENCE_PRODUCER", "ADVERSARIAL_CRITIC", "RISK_VERIFIER"]) {
    const schema = openAiStructuredOutputSchema(role);
    assert.equal(Object.hasOwn(schema.properties.payload.properties, "rawProbability"), false);
  }
});
