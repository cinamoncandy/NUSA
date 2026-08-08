"use strict";

const fs = require("node:fs");
const path = require("node:path");

const TARGET = path.join(process.cwd(), "apps", "execution", "src", "audit-incident-replay.ts");

function validateAuditIncidentReplay(source = fs.readFileSync(TARGET, "utf8")) {
  const failures = [];
  const required = [
    'mode: "OBSERVATIONAL_REPLAY"',
    "appendOnly: true",
    "tamperEvident: true",
    "executionAuthority: false",
    "authorizesLive: false",
    "credentialExecutionUse: false",
    "realMoneyExecutionAllowed: false",
    "AUDIT_REPLAY_SECRET_MATERIAL_PROHIBITED",
    "AUDIT_REPLAY_EXPECTED_CHAIN_HASH_MISMATCH",
    "AUDIT_REPLAY_DUPLICATE_EVENT_ID"
  ];
  for (const marker of required) if (!source.includes(marker)) failures.push(`AUDIT_REPLAY_REQUIRED_MARKER_MISSING:${marker}`);

  const forbiddenMethods = /\b(submitOrder|amendOrder|cancelOrder|executeOrder|withdraw|transferFunds|mutateCash|mutatePosition|resolveExecutionCredential)\s*\(/g;
  for (const match of source.matchAll(forbiddenMethods)) failures.push(`AUDIT_REPLAY_FORBIDDEN_METHOD:${match[1]}`);
  if (/from\s+["'][^"']*(live[-_/]?broker|execution[-_/]?credential)[^"']*["']/i.test(source)) failures.push("AUDIT_REPLAY_FORBIDDEN_EXECUTION_IMPORT");

  return Object.freeze({ ok: failures.length === 0, failures: Object.freeze(failures) });
}

if (require.main === module) {
  const result = validateAuditIncidentReplay();
  if (!result.ok) {
    console.error("Audit/incident replay source validation FAILED");
    for (const failure of result.failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log("Audit/incident replay source validation PASS");
}

module.exports = { validateAuditIncidentReplay };
