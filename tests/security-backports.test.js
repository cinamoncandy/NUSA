"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  patchExact,
  patchImageSizeIcns,
  patchNanoidSync,
  patchNanoidAsyncNode
} = require("../scripts/security-backports.js");
const { evaluateAudit } = require("../scripts/security-gate-backports.js");

test("image-size ICNS patch adds exactly two progress guards and is idempotent", () => {
  const vulnerable = [
    "const imageHeader = readImageHeader(input, imageOffset);\n        const imageSize = getImageSize(imageHeader[0]);",
    "middle",
    "const imageHeader = readImageHeader(input, imageOffset);\n        const imageSize = getImageSize(imageHeader[0]);"
  ].join("\n");
  const first = patchImageSizeIcns(vulnerable);
  assert.equal(first.changed, true);
  assert.equal((first.text.match(/Invalid ICNS entry size/g) || []).length, 2);
  const second = patchImageSizeIcns(first.text);
  assert.equal(second.changed, false);
});

test("backport patchers fail closed when upstream source shape drifts", () => {
  assert.throws(() => patchExact("unexpected", "before", "after", 1, "fixture"), /SECURITY_BACKPORT_SOURCE_SHAPE/);
});

test("nanoid sync and async patches terminate zero-size generators", () => {
  const sync = patchNanoidSync("return (size = defaultSize) => {\n    let id = ''", "sync");
  assert.match(sync.text, /if \(size <= 0\) return ''/);
  const asyncNode = patchNanoidAsyncNode("return size => tick('', size)", "async");
  assert.match(asyncNode.text, /if \(size <= 0\) return Promise\.resolve\(''\)/);
});

test("audit compensation is exact and unknown high advisories remain blocking", () => {
  const backports = {
    controls: {
      "GHSA-w3rx-r6r6-pgpr": true,
      "GHSA-5p2g-fcmc-qvqq": true,
      "GHSA-2v37-7h3g-55p8": true
    }
  };
  const audit = {
    metadata: { vulnerabilities: { high: 4, critical: 0 } },
    advisories: {
      "1138808": { module_name: "image-size", severity: "high" },
      "1138809": { module_name: "image-size", severity: "high" },
      "1138813": { module_name: "nanoid", severity: "high" },
      "9999999": { module_name: "future-package", severity: "high" }
    }
  };
  const result = evaluateAudit(audit, backports);
  assert.equal(result.mitigated.length, 3);
  assert.equal(result.unmitigated.length, 1);
  assert.equal(result.unmitigated[0].package, "future-package");
  assert.equal(result.shapeMismatch, false);
});

test("audit metadata/advisory disagreement fails closed", () => {
  const result = evaluateAudit({ metadata: { vulnerabilities: { high: 1, critical: 0 } }, advisories: {} }, { controls: {} });
  assert.equal(result.shapeMismatch, true);
});
