"use strict";
const fs = require("node:fs"), path = require("node:path"); const { createPaperPilotOperationalEvidence } = require("./lib/paper-pilot-operational-evidence.js"); const { evaluatePaperPilotPromotion } = require("./lib/paper-pilot-promotion-gate.js");
/**
 * The promotion gate blocks on PROHIBITED_CAPABILITY_PRESENT, but that check can only ever fire
 * if it is told the truth about the tree. Hard-coding the three flags to "absent" made the check
 * structurally unreachable: the gate would clear a build that had grown a live-order or
 * credential path. build-deployment-descriptor.js already scans for exactly these three
 * capabilities, so read the measurement rather than assert the conclusion.
 */
const { scanCapabilities } = require("./build-deployment-descriptor.js");
function measuredCapabilities() {
  const { findings } = scanCapabilities();
  return {
    liveAbsent: findings.liveTradingCapabilityPresent.length === 0,
    privateApiAbsent: findings.privateApiCapabilityPresent.length === 0,
    credentialAbsent: findings.credentialStoragePresent.length === 0
  };
}
const args = process.argv.slice(2); const value = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined; const load = (name) => { const target = value(name); if (!target) return []; const stat = fs.statSync(target); const files = stat.isDirectory() ? fs.readdirSync(target).sort().map((file) => path.join(target, file)) : [target]; return files.map((file) => JSON.parse(fs.readFileSync(file, "utf8"))); };
const current = { sourceCommitSha: value("--source-commit") || process.env.GITHUB_SHA || "" }; const evidence = createPaperPilotOperationalEvidence({ shadowEvidence: load("--shadow"), canaryEvidence: load("--canary"), current, capabilities: measuredCapabilities() }); const promotion = evaluatePaperPilotPromotion({ evidence, current }); const result = { evidence, promotion }; const output = value("--output"); if (output) { const target = path.resolve(output); if (target.startsWith(process.cwd()) || fs.existsSync(target)) throw new Error("output must be a new non-repository path"); fs.writeFileSync(target, JSON.stringify(result, null, 2) + "\n", { flag: "wx" }); } console.log(JSON.stringify(args.includes("--json") ? result : { promotionStatus: promotion.status, blockers: promotion.blockers, resultSha256: promotion.resultSha256 }, null, 2));
// A promotion gate that reports BLOCKED and still exits 0 cannot gate anything it is wired into.
if (promotion.status === "BLOCKED") { console.error(`paper pilot promotion BLOCKED: ${promotion.blockers.join(", ")}`); process.exitCode = 1; }
