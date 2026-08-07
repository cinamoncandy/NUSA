const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function validateReadiness(profile) {
  const failures = [];
  const counters = profile.mutationCounters || {};
  const zeroCounters = ['brokerCalls', 'orders', 'fills', 'cash', 'positions'];
  if (profile.mode !== 'RESTRICTED_LIVE_READINESS') failures.push('MODE_INVALID');
  if (profile.liveTradingMutation !== 'prohibited') failures.push('LIVE_MUTATION_NOT_PROHIBITED');
  if (profile.executionTransportConnected !== false) failures.push('EXECUTION_TRANSPORT_CONNECTED');
  if (profile.credentialStoragePresent !== false) failures.push('CREDENTIAL_STORAGE_PRESENT');
  if (profile.automaticActivationAllowed !== false) failures.push('AUTOMATIC_ACTIVATION_ALLOWED');
  if (profile.realMoneyExecutionAllowed !== false) failures.push('REAL_MONEY_EXECUTION_ALLOWED');
  if (profile.requiredHumanApprovers !== 2 || profile.requireDistinctApprovers !== true) failures.push('TWO_DISTINCT_HUMANS_NOT_REQUIRED');
  if (profile.requiredOperationalState !== 'SAFE') failures.push('SAFE_NOT_REQUIRED');
  if (profile.safetyCriticalUnknownAllowed !== false) failures.push('UNKNOWN_NOT_FAIL_CLOSED');
  if (profile.requiredHardRiskResult !== 'PASS') failures.push('HARD_RISK_PASS_NOT_REQUIRED');
  if (profile.requiredDeploymentIntegrityResult !== 'PASS') failures.push('DEPLOYMENT_INTEGRITY_PASS_NOT_REQUIRED');
  if (profile.killSwitchMustBeInactive !== true) failures.push('KILL_SWITCH_INACTIVE_NOT_REQUIRED');
  if (profile.openP0Allowed !== false) failures.push('OPEN_P0_ALLOWED');
  if (profile.requireRollbackTarget !== true) failures.push('ROLLBACK_NOT_REQUIRED');
  if (profile.requireExpiry !== true) failures.push('EXPIRY_NOT_REQUIRED');
  if (profile.requireCooldown !== true) failures.push('COOLDOWN_NOT_REQUIRED');
  if (profile.requireExactScope !== true) failures.push('EXACT_SCOPE_NOT_REQUIRED');
  for (const key of zeroCounters) if (counters[key] !== 0) failures.push(`MUTATION_COUNTER_NONZERO:${key}`);
  return { pass: failures.length === 0, failures };
}

function buildEvidence(profile, codeRevision = process.env.GITHUB_SHA || 'local') {
  const validation = validateReadiness(profile);
  return {
    version: 1,
    kind: 'restricted-live-operational-readiness',
    result: validation.pass ? 'PASS' : 'FAIL',
    codeRevision,
    configurationHash: sha256(JSON.stringify(profile)),
    observedAt: new Date().toISOString(),
    liveExecutionTransportConnected: profile.executionTransportConnected,
    credentialStoragePresent: profile.credentialStoragePresent,
    realMoneyExecutionAllowed: profile.realMoneyExecutionAllowed,
    mutationCounters: profile.mutationCounters,
    checks: validation.failures.length ? validation.failures : ['ALL_REQUIRED_READINESS_CHECKS_PASS'],
    authority: {
      humanApproversRequired: profile.requiredHumanApprovers,
      distinctApproversRequired: profile.requireDistinctApprovers,
      automaticActivationAllowed: profile.automaticActivationAllowed
    }
  };
}

function main() {
  const profilePath = path.resolve(process.argv[2] || 'config/live/restricted-live-readiness.json');
  const outputArg = process.argv.indexOf('--output');
  const outputPath = outputArg >= 0 ? path.resolve(process.argv[outputArg + 1]) : null;
  const profile = loadJson(profilePath);
  const evidence = buildEvidence(profile);
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  }
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.result !== 'PASS') process.exitCode = 1;
}

if (require.main === module) main();
module.exports = { validateReadiness, buildEvidence };
