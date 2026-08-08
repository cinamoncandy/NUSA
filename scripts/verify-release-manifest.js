"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const directory = path.resolve(process.argv[2] ?? "release");
const expectedCommit = process.argv[3];
const manifestOnly = process.argv.includes("--manifest-only");
if (!expectedCommit) throw new Error("EXPECTED_COMMIT_REQUIRED");
const manifest = JSON.parse(fs.readFileSync(path.join(directory, "build-manifest.json"), "utf8"));
const sourceCommit = manifest.sourceCommit ?? manifest.commit;
if (sourceCommit !== expectedCommit) throw new Error("SOURCE_COMMIT_MISMATCH");
if (manifest.capabilityDescriptor?.productionMutationAllowed !== false) throw new Error("UNSAFE_RELEASE_DESCRIPTOR");
if (manifest.capabilityDescriptor?.liveTradingEnabled !== false) throw new Error("LIVE_TRADING_DESCRIPTOR_UNSAFE");
const checksums = fs.readdirSync(directory).find((file) => file.endsWith("-checksums.txt"));
if (!manifestOnly) {
  if (!checksums) throw new Error("MISSING_ARTIFACT_CHECKSUMS");
  for (const line of fs.readFileSync(path.join(directory, checksums), "utf8").trim().split(/\r?\n/)) {
    const match = line.match(/^([a-f0-9]{64})  (.+)$/);
    if (!match) throw new Error("INVALID_CHECKSUM_RECORD");
    const file = path.join(directory, match[2]);
    if (!fs.existsSync(file)) throw new Error(`MISSING_ARTIFACT:${match[2]}`);
    const digest = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    if (digest !== match[1]) throw new Error(`ARTIFACT_CHECKSUM_MISMATCH:${match[2]}`);
  }
}
console.log(JSON.stringify({ status: "PASS", sourceCommit, productionMutationAllowed: false, manifestOnly }, null, 2));
