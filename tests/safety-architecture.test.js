const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, validateSafetyArchitecture, evaluateSafetyAction } = require('../scripts/validate-safety-architecture');

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function baseInput() {
  return {
    operationalState: 'SAFE',
    riskDirection: 'INCREASE',
    hardRiskDecision: 'ALLOW',
    learnedRiskRecommendation: 'ALLOW',
    evidence: [{ id: 'risk', safetyCritical: true, status: 'PASS' }],
  };
}

test('baseline safety architecture validates', () => {
  assert.equal(validateSafetyArchitecture(loadConfig()).pass, true);
});

test('safety-critical UNKNOWN blocks risk increase', () => {
  const input = baseInput();
  input.evidence[0].status = 'UNKNOWN';
  const result = evaluateSafetyAction(loadConfig(), input);
  assert.equal(result.decision, 'BLOCK');
  assert.ok(result.reasons.includes('SAFETY_CRITICAL_UNKNOWN'));
});

test('learned ALLOW cannot relax a hard-risk BLOCK', () => {
  const input = baseInput();
  input.hardRiskDecision = 'BLOCK';
  input.learnedRiskRecommendation = 'ALLOW';
  const result = evaluateSafetyAction(loadConfig(), input);
  assert.equal(result.decision, 'BLOCK');
  assert.ok(result.reasons.includes('HARD_RISK_BLOCK'));
});

test('learned risk may tighten an otherwise allowed action', () => {
  const input = baseInput();
  input.learnedRiskRecommendation = 'BLOCK';
  const result = evaluateSafetyAction(loadConfig(), input);
  assert.equal(result.decision, 'BLOCK');
  assert.ok(result.reasons.includes('LEARNED_RISK_TIGHTENED_TO_BLOCK'));
});

test('RESTRICTED blocks new risk but permits a risk-reducing action', () => {
  const increase = baseInput();
  increase.operationalState = 'RESTRICTED';
  assert.equal(evaluateSafetyAction(loadConfig(), increase).decision, 'BLOCK');
  const reduce = baseInput();
  reduce.operationalState = 'RESTRICTED';
  reduce.riskDirection = 'REDUCE';
  assert.equal(evaluateSafetyAction(loadConfig(), reduce).decision, 'ALLOW');
});

test('HALT recovery improvement requires explicit human evidence', () => {
  const input = baseInput();
  input.operationalState = 'HALT';
  input.riskDirection = 'REDUCE';
  input.recoveryRequestedState = 'RESTRICTED';
  input.humanRecoveryAuthorized = false;
  const config = loadConfig();
  const invalid = clone(config);
  invalid.authorities.recovery.haltImprovementRequiresHumanAuthorization = false;
  assert.equal(validateSafetyArchitecture(invalid).pass, false);
  const ordinary = baseInput();
  ordinary.operationalState = 'RESTRICTED';
  ordinary.riskDirection = 'REDUCE';
  ordinary.recoveryRequestedState = 'DEGRADED';
  const result = evaluateSafetyAction(config, ordinary);
  assert.equal(result.decision, 'BLOCK');
  assert.ok(result.reasons.includes('HUMAN_RECOVERY_EVIDENCE_REQUIRED'));
});

test('hard governor HALT cannot be overridden by a risk-reducing label', () => {
  const input = baseInput();
  input.operationalState = 'HALT';
  input.riskDirection = 'REDUCE';
  input.hardRiskDecision = 'HALT';
  assert.equal(evaluateSafetyAction(loadConfig(), input).decision, 'HALT');
});

test('policy allowing learned hard-limit relaxation fails closed', () => {
  const config = clone(loadConfig());
  config.authorities.learnedRisk.mayRelaxHardLimits = true;
  const validation = validateSafetyArchitecture(config);
  assert.equal(validation.pass, false);
  assert.ok(validation.failures.includes('LEARNED_RISK_RELAXATION_ALLOWED'));
  assert.equal(evaluateSafetyAction(config, baseInput()).decision, 'HALT');
});
