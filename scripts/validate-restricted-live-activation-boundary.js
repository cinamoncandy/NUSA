const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function validateActivationBoundary(profile) {
  const failures = [];
  const req = profile.representativeRequest || {};
  const scope = req.scope || {};
  const safety = req.safety || {};
  const readiness = req.readinessEvidence || {};
  const approvers = Array.isArray(req.approvers) ? req.approvers : [];
  const authority = profile.authority || {};

  if (profile.mode !== 'RESTRICTED_LIVE_ACTIVATION_BOUNDARY') failures.push('MODE_INVALID');
  if (profile.defaultDecision !== 'DENY') failures.push('DEFAULT_NOT_DENY');
  if (!Array.isArray(profile.allowedMachineDecisions) || profile.allowedMachineDecisions.join('|') !== 'DENY|ELIGIBLE_FOR_HUMAN_REVIEW') failures.push('MACHINE_DECISIONS_INVALID');
  for (const prohibited of ['ACTIVE', 'EXECUTE', 'CONNECT', 'SUBMIT_ORDER']) {
    if (!profile.prohibitedMachineDecisions?.includes(prohibited)) failures.push(`PROHIBITED_DECISION_MISSING:${prohibited}`);
  }
  if (profile.activationExecutorPresent !== false) failures.push('ACTIVATION_EXECUTOR_PRESENT');
  if (profile.executionTransportConnected !== false) failures.push('EXECUTION_TRANSPORT_CONNECTED');
  if (profile.credentialAccessAllowed !== false) failures.push('CREDENTIAL_ACCESS_ALLOWED');
  if (profile.automaticActivationAllowed !== false) failures.push('AUTOMATIC_ACTIVATION_ALLOWED');
  if (profile.realMoneyExecutionAllowed !== false) failures.push('REAL_MONEY_EXECUTION_ALLOWED');
  if (profile.liveTradingMutation !== 'prohibited') failures.push('LIVE_MUTATION_NOT_PROHIBITED');
  if (profile.requiredHumanApprovers !== 2 || profile.requireDistinctHumanApprovers !== true) failures.push('TWO_DISTINCT_HUMANS_NOT_REQUIRED');
  if (profile.requireExactScope !== true || profile.requireSingleUseNonce !== true || profile.rejectReplay !== true || profile.requireExpiry !== true) failures.push('BOUNDARY_SCOPE_OR_REPLAY_GUARD_MISSING');
  if (profile.requiredOperationalState !== 'SAFE' || profile.safetyCriticalUnknownAllowed !== false) failures.push('SAFETY_STATE_NOT_FAIL_CLOSED');
  if (profile.requiredHardRiskResult !== 'PASS' || profile.requiredDeploymentIntegrityResult !== 'PASS') failures.push('REQUIRED_SAFETY_EVIDENCE_MISSING');
  if (profile.killSwitchMustBeInactive !== true || profile.openP0Allowed !== false || profile.requireVerifiedRollback !== true) failures.push('HARD_BOUNDARY_GUARD_MISSING');
  if (profile.requireReadinessEvidence !== true || profile.requiredReadinessWorkOrder !== 'WO-0032') failures.push('READINESS_BINDING_MISSING');
  if (!profile.requiredReadinessArtifactDigest?.startsWith('sha256:') || !profile.requiredReadinessCodeRevision) failures.push('READINESS_IDENTITY_MISSING');
  if (authority.humanLiveAuthority !== true || authority.aiLiveAuthority !== false || authority.metaAiLiveAuthority !== false || authority.ciLiveAuthority !== false || authority.shadowLiveAuthority !== false || authority.promotionEvidenceLiveAuthority !== false) failures.push('AUTHORITY_SEPARATION_INVALID');

  if (req.decision !== 'DENY') failures.push('REPRESENTATIVE_REQUEST_NOT_DENY');
  if (!req.authorizationId || !req.nonce || req.noncePreviouslyConsumed !== false) failures.push('AUTHORIZATION_OR_NONCE_INVALID');
  if (req.requester?.kind !== 'HUMAN') failures.push('REQUESTER_NOT_HUMAN');
  if (approvers.length !== 2 || approvers.some((a) => a?.kind !== 'HUMAN')) failures.push('APPROVERS_NOT_TWO_HUMANS');
  if (approvers.length === 2 && approvers[0]?.principalId === approvers[1]?.principalId) failures.push('DUPLICATE_APPROVER');
  for (const key of ['deploymentBundleId', 'artifactDigest', 'capabilityContract', 'strategyIdentity', 'rollbackBundleId']) if (!scope[key]) failures.push(`SCOPE_MISSING:${key}`);
  if (!Array.isArray(scope.symbols) || scope.symbols.length === 0) failures.push('SYMBOL_SCOPE_MISSING');
  if (!(scope.maxOrderNotional > 0) || !(scope.maxPortfolioExposure > 0)) failures.push('RISK_BOUNDS_INVALID');
  if (!req.reason) failures.push('REASON_MISSING');
  const issuedAt = Date.parse(req.issuedAt);
  const expiresAt = Date.parse(req.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) failures.push('EXPIRY_INVALID');
  if (safety.operationalState !== 'SAFE' || safety.safetyCriticalUnknown !== false || safety.hardRiskResult !== 'PASS' || safety.deploymentIntegrityResult !== 'PASS' || safety.killSwitchActive !== false || safety.openP0 !== false || safety.rollbackVerified !== true) failures.push('SAFETY_EVIDENCE_INVALID');
  if (readiness.workOrder !== profile.requiredReadinessWorkOrder || readiness.artifactDigest !== profile.requiredReadinessArtifactDigest || readiness.codeRevision !== profile.requiredReadinessCodeRevision) failures.push('READINESS_EVIDENCE_MISMATCH');

  return {
    pass: failures.length === 0,
    failures,
    eligibilityDecision: failures.length === 0 ? 'ELIGIBLE_FOR_HUMAN_REVIEW' : 'DENY'
  };
}

function buildEvidence(profile, codeRevision = process.env.GITHUB_SHA || 'local') {
  const validation = validateActivationBoundary(profile);
  return {
    version: 1,
    kind: 'restricted-live-activation-boundary',
    result: validation.pass ? 'PASS' : 'FAIL',
    eligibilityDecision: validation.eligibilityDecision,
    activationPerformed: false,
    activationExecutorPresent: profile.activationExecutorPresent,
    executionTransportConnected: profile.executionTransportConnected,
    credentialAccessAllowed: profile.credentialAccessAllowed,
    realMoneyExecutionAllowed: profile.realMoneyExecutionAllowed,
    codeRevision,
    configurationHash: sha256(JSON.stringify(profile)),
    observedAt: new Date().toISOString(),
    readinessArtifactDigest: profile.requiredReadinessArtifactDigest,
    checks: validation.failures.length ? validation.failures : ['ALL_ACTIVATION_BOUNDARY_CHECKS_PASS']
  };
}

function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const outputIndex = args.indexOf('--output');
  const outputPath = outputIndex >= 0 && args[outputIndex + 1] ? path.resolve(args[outputIndex + 1]) : null;
  const positional = args.filter((arg, index) => arg !== '--output' && index !== outputIndex + 1 && !arg.startsWith('--'));
  const profilePath = path.resolve(positional[0] || 'config/live/restricted-live-activation-boundary.json');
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  const evidence = buildEvidence(profile);
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  }
  console.log(JSON.stringify(evidence, null, 2));
  if (evidence.result !== 'PASS') process.exitCode = 1;
}

if (require.main === module) main();
module.exports = { validateActivationBoundary, buildEvidence };
