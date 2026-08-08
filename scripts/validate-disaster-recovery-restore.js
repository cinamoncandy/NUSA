"use strict";

const fs = require("node:fs");
const path = require("node:path");
const TARGET = path.join(process.cwd(), "apps", "execution", "src", "disaster-recovery-restore-verification.ts");

function validateDisasterRecoveryRestore(source = fs.readFileSync(TARGET, "utf8")) {
  const failures = [];
  const required = [
    'mode: "VERIFY_ONLY"',
    "exactArtifactSetRequired: true",
    "auditReplayAnchorRequired: true",
    "automaticRestartAllowed: false",
    "executionAuthority: false",
    "authorizesLive: false",
    "credentialExecutionUse: false",
    "realMoneyExecutionAllowed: false",
    "RECOVERY_RESTORE_SECRET_PATH_PROHIBITED",
    "RESTORE_AUDIT_ANCHOR_MISMATCH",
    "RECOVERY_NOT_CONSISTENT"
  ];
  for (const marker of required) if (!source.includes(marker)) failures.push(`RECOVERY_RESTORE_REQUIRED_MARKER_MISSING:${marker}`);
  const forbiddenMethods = /\b(submitOrder|amendOrder|cancelOrder|executeOrder|withdraw|transferFunds|mutateCash|mutatePosition|resolveExecutionCredential|connectExecutionTransport)\s*\(/g;
  for (const match of source.matchAll(forbiddenMethods)) failures.push(`RECOVERY_RESTORE_FORBIDDEN_METHOD:${match[1]}`);
  return Object.freeze({ ok: failures.length === 0, failures: Object.freeze(failures) });
}

if (require.main === module) {
  const result = validateDisasterRecoveryRestore();
  if (!result.ok) {
    console.error("Disaster recovery restore source validation FAILED");
    for (const failure of result.failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log("Disaster recovery restore source validation PASS");
}
module.exports = { validateDisasterRecoveryRestore };
