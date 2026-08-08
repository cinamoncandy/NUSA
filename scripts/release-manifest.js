"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const packageJson = readJson("package.json");
const commit = (() => {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); }
  catch { return "UNKNOWN"; }
})();
const manifest = {
  schemaVersion: 1,
  version: packageJson.version,
  commit,
  sourceCommit: commit,
  buildDate: new Date().toISOString(),
  electronVersion: packageJson.devDependencies?.electron ?? "unknown",
  nodeVersion: process.version,
  migrationVersion: "managed-by-existing-storage-migrations",
  capabilityDescriptor: {
    mode: "PAPER",
    productionMutationAllowed: false,
    liveTradingEnabled: false,
    privateApiMutationCapabilityPresent: false,
    credentialsConfigured: false
  },
  signing: {
    status: process.env.WIN_CSC_LINK || process.env.WIN_CSC_KEY_PASSWORD ? "CONFIGURED_BY_BUILD_ENV" : "UNSIGNED_BUILD",
    policy: "Never invent or embed signing credentials. Configure the CI certificate store for a signed release."
  }
};
const output = path.join(root, "release", "build-manifest.json");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: "PASS", output: path.relative(root, output), manifest }, null, 2));
