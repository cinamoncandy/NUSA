"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateShadowGovernance } = require("../scripts/validate-shadow-governance.js");

const runtime = `
actualBrokerCallCount: 0 as const
actualOrderDelta: 0 as const
actualFillDelta: 0 as const
actualCashDelta: 0 as const
actualPositionDelta: 0 as const
SHADOW_MUTATION
verifyShadowPilotEvents
`;

const valid = () => ({
  version: 1,
  mode: "SHADOW_READ_ONLY",
  authority: "OBSERVATION_ONLY",
  production_equivalent_decision_path: true,
  execution_transport_connected: false,
  identities: {
    source_revision_required: true,
    deployment_bundle_required: true,
    strategy_identity_required: true,
    safety_policy_identity_required: true,
    market_data_provenance_required: true,
  },
  mutations: { broker: "PROHIBITED", order: "PROHIBITED", fill: "PROHIBITED", cash: "PROHIBITED", position: "PROHIBITED" },
  evidence: { hash_chain_required: true, zero_actual_mutation_counters_required: true, decision_provenance_required: true, immutable_session_result_required: true },
  decision_rewrite: {
    hard_risk_reject_to_allow: "PROHIBITED",
    hard_risk_halt_to_allow: "PROHIBITED",
    safety_restricted_to_allow: "PROHIBITED",
    safety_halt_to_allow: "PROHIBITED",
  },
  promotion: {
    observation_may_recommend: true,
    shadow_evidence_sufficient_for_production_promotion: false,
    shadow_evidence_sufficient_for_live_authorization: false,
    autonomous_production_mutation: false,
  },
  runtime_binding: { implementation: "apps/desktop/src/shadow/shadowPilotRuntime.ts", verification_entrypoint: "scripts/run-shadow-paper-pilot.js" },
});

test("valid Shadow governance contract passes", () => {
  assert.deepEqual(validateShadowGovernance(valid(), runtime), []);
});

test("connected execution transport fails closed", () => {
  const config = valid(); config.execution_transport_connected = true;
  assert.ok(validateShadowGovernance(config, runtime).includes("SHADOW_EXECUTION_TRANSPORT_CONNECTED"));
});

test("any mutation domain not prohibited fails closed", () => {
  const config = valid(); config.mutations.order = "ALLOWED";
  assert.ok(validateShadowGovernance(config, runtime).includes("SHADOW_MUTATION_NOT_PROHIBITED:order"));
});

test("missing identity or market-data provenance binding fails closed", () => {
  const config = valid(); config.identities.market_data_provenance_required = false;
  assert.ok(validateShadowGovernance(config, runtime).includes("SHADOW_IDENTITY_BINDING_MISSING:market_data_provenance_required"));
});

test("hard-risk or safety decision rewrite fails closed", () => {
  const config = valid(); config.decision_rewrite.hard_risk_reject_to_allow = "ALLOWED";
  assert.ok(validateShadowGovernance(config, runtime).includes("SHADOW_DECISION_REWRITE_ALLOWED:hard_risk_reject_to_allow"));
});

test("Shadow evidence cannot grant production promotion or LIVE authority", () => {
  const config = valid();
  config.promotion.shadow_evidence_sufficient_for_live_authorization = true;
  config.promotion.shadow_evidence_sufficient_for_production_promotion = true;
  const errors = validateShadowGovernance(config, runtime);
  assert.ok(errors.includes("SHADOW_EVIDENCE_GRANTS_LIVE_AUTHORITY"));
  assert.ok(errors.includes("SHADOW_EVIDENCE_GRANTS_PRODUCTION_PROMOTION"));
});

test("runtime without zero-mutation proof fails closed", () => {
  const broken = runtime.replace("actualBrokerCallCount: 0 as const", "actualBrokerCallCount: number");
  assert.ok(validateShadowGovernance(valid(), broken).some((error) => error.startsWith("SHADOW_RUNTIME_PROOF_MISSING:")));
});

test("runtime execution dependency fails closed", () => {
  const broken = `${runtime}\nconst broker = new PaperBroker();\nbroker.placeOrder({});`;
  assert.ok(validateShadowGovernance(valid(), broken).includes("SHADOW_RUNTIME_EXECUTION_DEPENDENCY"));
});
