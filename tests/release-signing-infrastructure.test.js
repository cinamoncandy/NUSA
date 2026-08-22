"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-release-"));
  fs.writeFileSync(path.join(root, "app.exe"), "paper-only");
  const digest = crypto.createHash("sha256").update("paper-only").digest("hex");
  fs.writeFileSync(path.join(root, "build-manifest.json"), JSON.stringify({
    sourceCommit: "abc",
    capabilityDescriptor: { productionMutationAllowed: false, liveTradingEnabled: false }
  }));
  fs.writeFileSync(path.join(root, "nusa-checksums.txt"), `${digest}  app.exe\n`);
  return root;
}

test("release manifest verifier passes a bound safe manifest and checksum", () => {
  const root = fixture();
  const result = spawnSync(process.execPath, ["scripts/verify-release-manifest.js", root, "abc"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"status": "PASS"/);
});

test("release manifest verifier fails closed on commit mismatch, unsafe descriptor, or checksum mismatch", () => {
  const root = fixture();
  let result = spawnSync(process.execPath, ["scripts/verify-release-manifest.js", root, "wrong"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  const manifestPath = path.join(root, "build-manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify({ sourceCommit: "abc", capabilityDescriptor: { productionMutationAllowed: true, liveTradingEnabled: false } }));
  result = spawnSync(process.execPath, ["scripts/verify-release-manifest.js", root, "abc"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  fs.writeFileSync(manifestPath, JSON.stringify({ sourceCommit: "abc", capabilityDescriptor: { productionMutationAllowed: false, liveTradingEnabled: false } }));
  fs.writeFileSync(path.join(root, "app.exe"), "tampered");
  result = spawnSync(process.execPath, ["scripts/verify-release-manifest.js", root, "abc"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
});

test("private Windows packaging remains explicitly unsigned and public signing infrastructure is absent", () => {
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.equal(packageJson.build?.win?.signAndEditExecutable, false);
  assert.equal(Object.prototype.hasOwnProperty.call(packageJson.scripts ?? {}, "package:win:production"), false);
  assert.equal(fs.existsSync(".github/workflows/windows-production-signing.yml"), false);
  assert.equal(fs.existsSync("electron-builder.production.yml"), false);
  assert.equal(fs.existsSync("scripts/verify-windows-authenticode.ps1"), false);
});
