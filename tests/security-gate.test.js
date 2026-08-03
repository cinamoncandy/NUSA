const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { scanText } = require("../scripts/security-gate.js");
const { dependencyIntegrity, licenseAudit, parseLockfile, verifyArtifacts } = require("../scripts/security-gate.js");

test("secret scanner reports credential material without returning its value", () => {
  const findings = scanText(`const key = "${["ghp_", "12345678901234567890"].join("")}";`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, "TOKEN_PREFIX");
  assert.equal(Object.hasOwn(findings[0], "value"), false);
});

test("secret scanner ignores explicit non-secret placeholders", () => {
  assert.deepEqual(scanText('password: "not-configured"'), []);
});

test("lockfile contains integrity metadata for every resolved package", () => {
  const result = dependencyIntegrity();
  assert.equal(result.findings.length, 0);
  assert.ok(result.packageCount > 0);
});

test("license audit ignores platform-selected optional packages without skipping ordinary dependencies", () => {
  const lock = parseLockfile();
  const platformPackages = lock.packages.filter((item) => item.platformSpecific);
  assert.ok(platformPackages.length > 0);
  assert.ok(platformPackages.some((item) => /^(?:@esbuild\/|@rollup\/rollup-|fsevents$)/.test(item.name)));
  const licenses = licenseAudit(lock);
  assert.equal(licenses.missing.some((item) => item.startsWith("@esbuild/")), false);
  assert.equal(licenses.missing.some((item) => item.startsWith("@rollup/rollup-")), false);
  assert.equal(licenses.missing.some((item) => item.startsWith("fsevents@")), false);
});

test("optional packages are detected wherever the flag sits inside the snapshot block", () => {
  const lock = parseLockfile();
  const optional = new Set(lock.packages.filter((item) => item.optional).map((item) => `${item.name}@${item.version}`));

  // The reader used to require `optional: true` on the line IMMEDIATELY after the selector.
  // pnpm puts it after `dependencies:` / `transitivePeerDependencies:` whenever those exist,
  // so every package shaped like that was silently classified as required -- and then failed
  // the licence audit for having no installed metadata, which is exactly what an optional
  // package that was never installed is supposed to have.
  assert.ok(optional.has("postject@1.0.0-alpha.6"), "postject declares optional: true after its dependencies block");

  // Cross-check the whole set against an independent block scan of the lockfile, so this
  // cannot pass again by matching only the easy shape.
  const lines = fs.readFileSync(path.join(__dirname, "..", "pnpm-lock.yaml"), "utf8").split(/\r?\n/);
  const expected = new Set();
  let inSnapshots = false;
  let selector = null;
  for (const line of lines) {
    if (!inSnapshots) { if (line === "snapshots:") inSnapshots = true; continue; }
    if (line && !line.startsWith("  ")) break;
    const match = line.match(/^ {2}(?! )(?:'([^']+)'|([^:]+)):\s*$/);
    if (match) { selector = (match[1] ?? match[2]).replace(/(?:\([^)]*\))+$/, ""); continue; }
    if (selector !== null && /^ {4}optional: true\s*$/.test(line)) expected.add(selector);
  }
  assert.ok(expected.size > 0, "the lockfile must contain optional snapshots for this test to mean anything");
  const missed = [...expected].filter((item) => !optional.has(item));
  assert.deepEqual(missed, [], `optional packages missed by parseLockfile: ${missed.join(", ")}`);
});

test("each package's integrity comes from its own block, never the next one's", () => {
  const lock = parseLockfile();
  // A fixed-size line window after the selector both truncates a long block and runs into the
  // following package, so a package with no integrity of its own could inherit its neighbour's.
  // Two blocks in this lockfile already exceed the old 24-line window.
  const lines = fs.readFileSync(path.join(__dirname, "..", "pnpm-lock.yaml"), "utf8").split(/\r?\n/);
  const start = lines.indexOf("packages:");
  assert.ok(start >= 0);
  let selector = null;
  let body = [];
  const own = new Map();
  // `selector` is cleared here too: the loop flushes once on break and once after, and
  // without the reset the second call overwrites the last package with an empty block.
  const flush = () => { if (selector !== null) own.set(selector, body.join("\n")); selector = null; body = []; };
  for (const line of lines.slice(start + 1)) {
    if (line && !line.startsWith("  ")) { flush(); break; }
    const match = line.match(/^ {2}(?! )(?:'([^']+)'|([^:]+)):\s*$/);
    if (match) { flush(); selector = (match[1] ?? match[2]).replace(/(?:\([^)]*\))+$/, ""); continue; }
    if (selector !== null) body.push(line);
  }
  flush();

  for (const item of lock.packages) {
    const block = own.get(`${item.name}@${item.version}`);
    if (block === undefined) continue;
    const expected = block.match(/integrity:\s*([^\s}]+)/)?.[1] ?? null;
    assert.equal(item.integrity, expected, `${item.name}@${item.version} integrity must come from its own block`);
  }
});

test("artifact verification checks recorded hashes and signing state", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-security-"));
  try {
    const artifact = path.join(directory, "NUSA.exe");
    fs.writeFileSync(artifact, "paper-only-test-artifact");
    const crypto = require("node:crypto");
    const hash = crypto.createHash("sha256").update(fs.readFileSync(artifact)).digest("hex");
    fs.writeFileSync(path.join(directory, "build-manifest.json"), JSON.stringify({ capabilityDescriptor: { productionMutationAllowed: false, liveTradingEnabled: false, credentialsConfigured: false }, signing: { status: "CONFIGURED_BY_BUILD_ENV" } }));
    fs.writeFileSync(path.join(directory, "nusa-checksums.txt"), `${hash}  NUSA.exe\n`);
    const result = verifyArtifacts(directory);
    assert.equal(result.checksumStatus, "PASS");
    assert.equal(result.signingStatus, "PASS");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
