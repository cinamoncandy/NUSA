"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { canonicalHash } = require("../scripts/lib/canonical-hash.js");
const { bindLegacySmaReferences } = require("../scripts/lib/research-reference-binding.js");

const candidateIdFor = (familyId, parameters) => `sma-${parameters.shortPeriod}-${parameters.longPeriod}`;
const raw = [
  { source: "PRODUCTION_DEFAULT", shortWindow: 5, longWindow: 20, referenceReturn: 0.01, assessment: "NARROW_PLATEAU" },
  { source: "MANUAL_RESEARCH_REFERENCE", shortWindow: 2, longWindow: 8, referenceReturn: 0.02, assessment: "NARROW_PLATEAU" },
];
const bind = (overrides = {}) => bindLegacySmaReferences({
  references: raw,
  verifiedReferencesSha256: canonicalHash(raw),
  familyId: "sma-crossover",
  smaFamilyId: "sma-crossover",
  candidateIdFor,
  ...overrides,
});

test("binds legacy SMA references deterministically from the verified windows", () => {
  const bound = bind();
  assert.deepEqual(bound.map((reference) => reference.candidateKey), ["sma-5-20", "sma-2-8"]);
  assert.deepEqual(bound[0].parameters, { shortPeriod: 5, longPeriod: 20 });
  assert.equal(bound[0].referenceReturn, 0.01);
});

test("refuses references that are not the independently verified ones", () => {
  assert.throws(() => bind({ verifiedReferencesSha256: canonicalHash([raw[0]]) }), /independently verified digest/);
});

test("refuses a binding regression instead of sealing it as verified", () => {
  assert.throws(() => bind({ candidateIdFor: () => "sma-9-99" }), /does not derive from the verified references/);
});

test("leaves non-SMA families and already bound references untouched", () => {
  const rsi = [{ source: "PRODUCTION_DEFAULT", familyId: "rsi", candidateKey: "rsi-14-30-70", parameters: { period: 14 }, assessment: "BROAD_PLATEAU" }];
  assert.deepEqual(bindLegacySmaReferences({ references: rsi, verifiedReferencesSha256: canonicalHash(rsi), familyId: "rsi", smaFamilyId: "sma-crossover", candidateIdFor }), rsi);
});
