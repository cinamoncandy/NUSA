"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  packageRoot,
  resolvePackageRoots,
  patchExact,
  patchImageSizeIcns,
  patchImageSizeJxlPartialStreams,
  patchNanoidSync,
  patchNanoidAsyncBrowser,
  patchNanoidAsyncNode
} = require("../scripts/security-backports.js");
const { evaluateAudit } = require("../scripts/security-gate-backports.js");

test("image-size ICNS patch guards exactly two offset increments and is idempotent", () => {
  const vulnerable = [
    "imageOffset += imageHeader[1];",
    "middle",
    "imageOffset += imageHeader[1];"
  ].join("\n");
  const first = patchImageSizeIcns(vulnerable);
  assert.equal(first.changed, true);
  assert.equal((first.text.match(/Invalid ICNS entry size/g) || []).length, 2);
  const second = patchImageSizeIcns(first.text);
  assert.equal(second.changed, false);
});

test("image-size JXL partial-stream patch guards forward progress on a zero-size box and is idempotent", () => {
  // findBox returns as soon as it finds a box with the requested name, size included -- so a
  // zero-size 'jxlp' box makes the caller's offset stay put and re-find the same box forever.
  // This is confirmed with a crafted JXL container in a companion end-to-end check; this test
  // pins the source-level fix that closes it.
  const vulnerable = "        offset = jxlpBox.offset + jxlpBox.size;\n";
  const first = patchImageSizeJxlPartialStreams(vulnerable);
  assert.equal(first.changed, true);
  assert.match(first.text, /jxlpBox\.offset \+ \(jxlpBox\.size > 0 \? jxlpBox\.size : 8\)/);
  const second = patchImageSizeJxlPartialStreams(first.text);
  assert.equal(second.changed, false);
});

test("backport patchers fail closed when upstream source shape drifts", () => {
  assert.throws(() => patchExact("unexpected", "before", "after", 1, "fixture"), /SECURITY_BACKPORT_SOURCE_SHAPE/);
});

test("nanoid sync and async patches terminate zero-size generators", () => {
  const sync = patchNanoidSync("return (size = defaultSize) => {\n    let id = ''", "sync");
  assert.match(sync.text, /if \(size <= 0\) return ''/);
  const asyncBrowser = patchNanoidAsyncBrowser("return async (size = defaultSize) => {\n    let id = ''", "async-browser");
  assert.match(asyncBrowser.text, /if \(size <= 0\) return ''/);
  const asyncNode = patchNanoidAsyncNode("return size => tick('', size)", "async-node");
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

function packageFixture(root, packagePath, name, version) {
  const target = path.join(root, packagePath, "node_modules", name);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, "package.json"), JSON.stringify({ name, version }));
  return target;
}

test("security backport resolver accepts pnpm peer-suffixed store entries", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-backport-"));
  const store = path.join(root, ".pnpm");
  const packagePath = packageFixture(store, "image-size@1.2.1_peer@1.0.0", "image-size", "1.2.1");
  assert.deepEqual(resolvePackageRoots("image-size", "1.2.1", store, path.join(root, "node_modules")), [packagePath]);
});

test("security backport resolver accepts a hoisted root package", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-backport-"));
  const packagePath = packageFixture(root, "", "image-size", "1.2.1");
  assert.deepEqual(resolvePackageRoots("image-size", "1.2.1", path.join(root, ".pnpm"), path.join(root, "node_modules")), [packagePath]);
});

test("security backport resolver fails closed for missing and duplicate packages", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-backport-"));
  const store = path.join(root, ".pnpm");
  const missing = resolvePackageRoots("image-size", "1.2.1", store, path.join(root, "node_modules"));
  assert.equal(missing.length, 0);
  packageFixture(store, "image-size@1.2.1_a", "image-size", "1.2.1");
  packageFixture(store, "image-size@1.2.1_b", "image-size", "1.2.1");
  const duplicate = resolvePackageRoots("image-size", "1.2.1", store, path.join(root, "node_modules"));
  assert.equal(duplicate.length, 2);
});
