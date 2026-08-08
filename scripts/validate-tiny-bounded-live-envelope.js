"use strict";

const fs = require("node:fs");
const path = require("node:path");
const TARGET = path.join(process.cwd(), "apps", "execution", "src", "tiny-bounded-live-envelope.ts");

function validateTinyBoundedLiveEnvelope(source = fs.readFileSync(TARGET, "utf8")) {
  const failures = [];
  const required = [
    'mode: "POLICY_VALIDATION_ONLY"',
    "nonExpandable: true",
    "singleSessionRequired: true",
    "automaticRenewalAllowed: false",
    "automaticScaleUpAllowed: false",
    "symbolAdditionAllowed: false",
    "orderAuthorization: false",
    "activationAuthority: false",
    "executionAuthority: false",
    "authorizesLive: false",
    "mutationPerformed: false",
    "networkDialAllowed: false",
    "credentialExecutionUse: false",
    "realMoneyExecutionAllowed: false",
    'maxOrderNotionalBps: 10',
    'maxGrossExposureBps: 50',
    'maxDailyLossBps: 10',
    'maxOpenOrders: 1',
    'maxPositionCount: 1',
    'maxSessionOrders: 5',
    'sessionDurationSeconds: 3600',
    '"BOUNDED_ENVELOPE_VALID"',
    '"SAFE_BLOCK"',
    '"UNKNOWN"'
  ];
  for (const marker of required) if (!source.includes(marker)) failures.push(`TINY_ENVELOPE_REQUIRED_MARKER_MISSING:${marker}`);
  const forbiddenMethods = /\b(deploy|activateLive|submitOrder|amendOrder|cancelOrder|executeOrder|withdraw|transferFunds|mutateCash|mutatePosition|resolveExecutionCredential|connectExecutionTransport|dialBroker|issueActivationToken|authorizeOrder)\s*\(/g;
  for (const match of source.matchAll(forbiddenMethods)) failures.push(`TINY_ENVELOPE_FORBIDDEN_METHOD:${match[1]}`);
  return Object.freeze({ ok: failures.length === 0, failures: Object.freeze(failures) });
}

if (require.main === module) {
  const result = validateTinyBoundedLiveEnvelope();
  if (!result.ok) {
    console.error("Tiny bounded Restricted LIVE envelope source validation FAILED");
    for (const failure of result.failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log("Tiny bounded Restricted LIVE envelope source validation PASS");
}
module.exports = { validateTinyBoundedLiveEnvelope };
