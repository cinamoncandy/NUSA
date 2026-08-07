const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = path.join(process.cwd(), 'config', 'safety', 'architecture.json');

function validateSafetyArchitecture(config) {
  const failures = [];
  const states = Array.isArray(config?.operationalStates) ? config.operationalStates : [];
  const expected = [
    ['SAFE', 0],
    ['DEGRADED', 1],
    ['RESTRICTED', 2],
    ['HALT', 3],
  ];

  if (config?.version !== 1) failures.push('SAFETY_VERSION_INVALID');
  for (const [id, severity] of expected) {
    const state = states.find((item) => item?.id === id);
    if (!state || state.severity !== severity) failures.push(`STATE_ORDER_INVALID:${id}`);
  }
  if (states.length !== expected.length) failures.push('STATE_SET_INVALID');

  const hard = config?.authorities?.hardRiskGovernor;
  const learned = config?.authorities?.learnedRisk;
  const recovery = config?.authorities?.recovery;
  if (!hard?.finalForHardLimits) failures.push('HARD_RISK_NOT_FINAL');
  if (hard?.learnedOverrideAllowed !== false) failures.push('HARD_RISK_LEARNED_OVERRIDE_ALLOWED');
  if (learned?.mayTighten !== true) failures.push('LEARNED_RISK_CANNOT_TIGHTEN');
  if (learned?.mayRelaxHardLimits !== false) failures.push('LEARNED_RISK_RELAXATION_ALLOWED');
  if (recovery?.haltImprovementRequiresHumanAuthorization !== true) failures.push('HALT_HUMAN_RECOVERY_NOT_REQUIRED');
  if (recovery?.authorizationEvidenceRequired !== true) failures.push('HALT_RECOVERY_EVIDENCE_NOT_REQUIRED');

  if (config?.unknownPolicy?.safetyCriticalUnknownBlocksRiskIncrease !== true) failures.push('UNKNOWN_NOT_FAIL_CLOSED');
  if (config?.unknownPolicy?.unknownMayAuthorizeRiskIncrease !== false) failures.push('UNKNOWN_MAY_AUTHORIZE_RISK');
  if (config?.actionPolicy?.restrictedAllowsRiskReduction !== true) failures.push('RESTRICTED_RISK_REDUCTION_DISABLED');
  if (config?.actionPolicy?.haltAllowsRiskReductionOnlyWhenHardGovernorDoesNotHalt !== true) failures.push('HALT_RISK_REDUCTION_RULE_INVALID');
  if (config?.actionPolicy?.neutralActionInHalt !== 'BLOCK') failures.push('HALT_NEUTRAL_ACTION_NOT_BLOCKED');

  const protectedPrincipals = new Set(config?.protectedAuthorityPrincipals || []);
  for (const principal of ['meta-ai', 'strategy', 'model', 'provider', 'deployment-component']) {
    if (!protectedPrincipals.has(principal)) failures.push(`PROTECTED_PRINCIPAL_MISSING:${principal}`);
  }
  const overrides = new Set(config?.forbiddenOverrides || []);
  for (const boundary of ['hard-risk-limit', 'kill-switch', 'human-live-authority', 'production-promotion-authority']) {
    if (!overrides.has(boundary)) failures.push(`FORBIDDEN_OVERRIDE_MISSING:${boundary}`);
  }
  if (config?.liveTradingMutation !== 'prohibited') failures.push('LIVE_MUTATION_NOT_PROHIBITED');
  if (config?.productionPromotionMutation !== 'prohibited') failures.push('PRODUCTION_PROMOTION_MUTATION_NOT_PROHIBITED');

  return { pass: failures.length === 0, failures };
}

function evaluateSafetyAction(config, input) {
  const validation = validateSafetyArchitecture(config);
  if (!validation.pass) return { decision: 'HALT', reasons: ['SAFETY_ARCHITECTURE_INVALID', ...validation.failures] };

  const reasons = [];
  const evidence = Array.isArray(input?.evidence) ? input.evidence : [];
  const criticalUnknown = evidence.some((item) => item?.safetyCritical === true && item?.status === 'UNKNOWN');
  const criticalFail = evidence.some((item) => item?.safetyCritical === true && item?.status === 'FAIL');

  if (input?.hardRiskDecision === 'HALT' || criticalFail) return { decision: 'HALT', reasons: ['HARD_SAFETY_HALT'] };
  if (input?.operationalState === 'HALT') {
    if (input?.riskDirection === 'REDUCE' && input?.hardRiskDecision === 'ALLOW') {
      return { decision: 'ALLOW', reasons: ['HALT_RISK_REDUCTION_ONLY'] };
    }
    return { decision: 'HALT', reasons: ['OPERATIONAL_HALT'] };
  }
  if (input?.hardRiskDecision === 'BLOCK') reasons.push('HARD_RISK_BLOCK');
  if (criticalUnknown && input?.riskDirection === 'INCREASE') reasons.push('SAFETY_CRITICAL_UNKNOWN');
  if (input?.operationalState === 'RESTRICTED' && input?.riskDirection === 'INCREASE') reasons.push('RESTRICTED_NEW_RISK_BLOCKED');
  if (input?.learnedRiskRecommendation === 'BLOCK') reasons.push('LEARNED_RISK_TIGHTENED_TO_BLOCK');

  if (input?.recoveryRequestedState) {
    const severity = Object.fromEntries(config.operationalStates.map((state) => [state.id, state.severity]));
    if (severity[input.recoveryRequestedState] < severity[input.operationalState]) {
      if (input?.humanRecoveryAuthorized !== true || !input?.humanRecoveryEvidenceId) {
        reasons.push('HUMAN_RECOVERY_EVIDENCE_REQUIRED');
      }
    }
  }

  return reasons.length ? { decision: 'BLOCK', reasons } : { decision: 'ALLOW', reasons: input?.learnedRiskRecommendation === 'TIGHTEN' ? ['LEARNED_RISK_TIGHTENED'] : [] };
}

function loadConfig(file = DEFAULT_CONFIG) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

if (require.main === module) {
  const result = validateSafetyArchitecture(loadConfig());
  if (!result.pass) {
    console.error('Safety Architecture validation FAILED');
    for (const failure of result.failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log('Safety Architecture validation PASS');
}

module.exports = { validateSafetyArchitecture, evaluateSafetyAction, loadConfig };
