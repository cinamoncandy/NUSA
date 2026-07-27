"use strict";
const { canonicalHash } = require("./canonical-hash.js");
// Deliberately independent from the runner's required-drill list and evaluation helpers.
const MANDATORY = Object.freeze(["NORMAL_MANUAL_BUY","NORMAL_MANUAL_SELL","NORMAL_AUTOMATIC","KILL_SWITCH","APPROVAL_MISSING","DEPLOYMENT_MISMATCH","SHADOW_MANUAL","CANARY_VALID","RESTART_AUTO_OFF","RECONCILIATION_PASS","DUPLICATE_FILL","ORPHAN_FILL","LIVE_CAPABILITY_ABSENT","PRIVATE_API_CAPABILITY_ABSENT","CREDENTIAL_CAPABILITY_ABSENT"]);
function verifyRiskSafetyDrills(result) {
  const errors = []; const drills = result?.drills || []; const ids = drills.map((drill) => drill.drillId);
  if (new Set(ids).size !== ids.length) errors.push("duplicate drill id");
  for (const id of MANDATORY) if (!ids.includes(id)) errors.push(`missing drill:${id}`);
  for (const drill of drills) {
    const { resultSha256, pass, ...raw } = drill;
    if (resultSha256 !== canonicalHash(raw)) errors.push(`hash mismatch:${drill.drillId}`);
    if (!["ALLOW", "REJECT", "HALT"].includes(drill.actualDecision) || JSON.stringify(drill.actualReasonCodes) !== JSON.stringify([...drill.actualReasonCodes].sort())) errors.push(`invalid decision ordering:${drill.drillId}`);
    if (drill.actualDecision !== "ALLOW" && (drill.brokerCallCount !== 0 || drill.orderCountBefore !== drill.orderCountAfter || drill.cashBefore !== drill.cashAfter || drill.positionBefore !== drill.positionAfter)) errors.push(`mutation after block:${drill.drillId}`);
    if (drill.restartResult !== "AUTOMATIC_OFF") errors.push(`unsafe restart:${drill.drillId}`);
  }
  if (result?.resultSha256 !== canonicalHash({ schemaVersion: result?.schemaVersion, drills: result?.drills, sourceCommitSha: result?.sourceCommitSha })) errors.push("runner hash mismatch");
  const raw = { verifierStatus: errors.length ? "FAIL" : "PASS", verifiedDrillCount: drills.length, failedDrillIds: drills.filter((drill) => !drill.pass).map((drill) => drill.drillId).sort(), reasonCodes: errors.sort(), sourceCommitSha: result?.sourceCommitSha || "", runnerResultSha256: result?.resultSha256 || "" };
  return Object.freeze({ ...raw, verifierResultSha256: canonicalHash(raw) });
}
module.exports = { verifyRiskSafetyDrills };
