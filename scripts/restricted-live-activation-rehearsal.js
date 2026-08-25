const fs = require('fs');
const path = require('path');

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function evaluate(profile) {
  const failures = [];
  const counters = profile.mutationCounters || {};
  const ownerApproval = profile.ownerApproval || {};
  const scope = profile.scope || {};
  const safety = profile.safety || {};
  const auth = profile.authorization || {};

  if (profile.mode !== 'RESTRICTED_LIVE_ACTIVATION_REHEARSAL') failures.push('MODE_INVALID');
  if (profile.activationIntent !== 'SIMULATED_ONLY') failures.push('ACTIVATION_INTENT_NOT_SIMULATED');
  if (profile.liveTradingMutation !== 'prohibited') failures.push('LIVE_MUTATION_NOT_PROHIBITED');
  if (profile.executionSuppressed !== true) failures.push('EXECUTION_NOT_SUPPRESSED');
  if (profile.executionTransportConnected !== false) failures.push('EXECUTION_TRANSPORT_CONNECTED');
  if (profile.credentialStoragePresent !== false) failures.push('CREDENTIAL_STORAGE_PRESENT');
  if (profile.realMoneyExecutionAllowed !== false) failures.push('REAL_MONEY_EXECUTION_ALLOWED');
  if (profile.automaticActivationAllowed !== false) failures.push('AUTOMATIC_ACTIVATION_ALLOWED');

  if (!profile.requester || profile.requester.kind !== 'HUMAN' || !profile.requester.principalId) failures.push('REQUESTER_NOT_HUMAN');
  if (ownerApproval.kind !== 'HUMAN' || ownerApproval.role !== 'OWNER' || ownerApproval.explicit !== true || !ownerApproval.principalId) {
    failures.push('OWNER_APPROVAL_REQUIRED');
  }

  const requiredStrings = ['deploymentBundleId','capabilityContract','strategyIdentity','startsAt','expiresAt','rollbackBundleId'];
  for (const key of requiredStrings) if (!scope[key]) failures.push(`SCOPE_MISSING:${key}`);
  if (!Array.isArray(scope.symbols) || scope.symbols.length === 0) failures.push('SCOPE_SYMBOLS_MISSING');
  if (!(scope.maxOrderNotional > 0) || !(scope.maxPortfolioExposure > 0)) failures.push('SCOPE_LIMIT_INVALID');
  if (!(scope.cooldownSeconds > 0)) failures.push('COOLDOWN_INVALID');
  if (scope.startsAt && scope.expiresAt && new Date(scope.expiresAt) <= new Date(scope.startsAt)) failures.push('TIME_WINDOW_INVALID');

  if (safety.operationalState !== 'SAFE') failures.push('OPERATIONAL_STATE_NOT_SAFE');
  if (safety.safetyCriticalUnknown !== false) failures.push('SAFETY_UNKNOWN_NOT_FAIL_CLOSED');
  if (safety.hardRiskResult !== 'PASS') failures.push('HARD_RISK_NOT_PASS');
  if (safety.deploymentIntegrityResult !== 'PASS') failures.push('DEPLOYMENT_INTEGRITY_NOT_PASS');
  if (safety.killSwitchActive !== false) failures.push('KILL_SWITCH_ACTIVE');
  if (safety.openP0 !== false) failures.push('OPEN_P0');

  if (auth.singleUse !== true) failures.push('AUTH_NOT_SINGLE_USE');
  if (!auth.reason) failures.push('REASON_MISSING');
  if (!auth.auditReceiptId) failures.push('AUDIT_RECEIPT_MISSING');

  for (const key of ['brokerCalls','orders','fills','cash','positions']) {
    if (counters[key] !== 0) failures.push(`MUTATION_COUNTER_NONZERO:${key}`);
  }

  return {
    result: failures.length === 0 ? 'WOULD_ALLOW' : 'BLOCKED',
    executionSuppressed: true,
    actualActivation: false,
    failures
  };
}

function parseArgs(argv) {
  const args = argv.filter((arg) => arg !== '--');
  let profilePath = 'config/live/restricted-live-activation-rehearsal.json';
  let outputPath = null;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--output') {
      if (!args[i + 1]) throw new Error('--output requires a path');
      outputPath = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--profile') {
      if (!args[i + 1]) throw new Error('--profile requires a path');
      profilePath = args[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    profilePath = arg;
  }

  return { profilePath: path.resolve(profilePath), outputPath: outputPath ? path.resolve(outputPath) : null };
}

function main() {
  const { profilePath, outputPath } = parseArgs(process.argv.slice(2));
  const profile = loadJson(profilePath);
  const result = evaluate(profile);
  const evidence = {
    version: 1,
    kind: 'restricted-live-activation-gate-rehearsal',
    observedAt: new Date().toISOString(),
    codeRevision: process.env.GITHUB_SHA || 'local',
    ...result,
    liveTradingMutation: profile.liveTradingMutation,
    executionTransportConnected: profile.executionTransportConnected,
    credentialStoragePresent: profile.credentialStoragePresent,
    realMoneyExecutionAllowed: profile.realMoneyExecutionAllowed,
    mutationCounters: profile.mutationCounters
  };
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  }
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.result !== 'WOULD_ALLOW') process.exitCode = 1;
}

if (require.main === module) main();
module.exports = { evaluate, parseArgs };
