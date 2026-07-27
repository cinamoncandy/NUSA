"use strict";
const { canonicalHash, canonicalize } = require("./canonical-hash.js");

const REQUIRED_EVIDENCE_TYPES = Object.freeze(["DATASET_QUALITY", "BACKTEST_BASELINE", "COST_STRESS", "WALK_FORWARD", "PARAMETER_ROBUSTNESS", "REGIME_ANALYSIS", "CROSS_MARKET_VALIDATION", "PAPER_OPERATIONAL_SAFETY"]);
const DIMENSIONS = Object.freeze([["D-001", "Data Integrity", "DATASET_QUALITY"], ["D-002", "Backtest Integrity", "BACKTEST_BASELINE"], ["D-003", "Cost Resilience", "COST_STRESS"], ["D-004", "Out-of-Sample Performance", "WALK_FORWARD"], ["D-005", "Parameter Robustness", "PARAMETER_ROBUSTNESS"], ["D-006", "Regime Robustness", "REGIME_ANALYSIS"], ["D-007", "Cross-Market Generalization", "CROSS_MARKET_VALIDATION"], ["D-008", "Sample Sufficiency", "sampleSufficiency"], ["D-009", "Benchmark Competitiveness", "benchmarkCompetitiveness"], ["D-010", "Operational Paper Safety", "PAPER_OPERATIONAL_SAFETY"]]);
const ASSESSMENTS = new Set(["PASS", "FAIL", "BLOCKED", "INCONCLUSIVE"]);

function freeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } return value; }
function identityKey(identity) { return ["strategyId", "strategyVersion", "datasetId", "datasetVersion", "executionId", "riskProfileId"].map((key) => identity?.[key] ?? "").join("|"); }
function trust(evidence, identity) {
  if (!evidence) return { level: "MISSING", errors: ["required evidence is missing"] };
  const errors = [];
  if (!REQUIRED_EVIDENCE_TYPES.includes(evidence.type)) errors.push("unsupported evidence type");
  if (!["REAL", "SYNTHETIC"].includes(evidence.source)) errors.push("source must be REAL or SYNTHETIC");
  if (!ASSESSMENTS.has(evidence.assessment)) errors.push("assessment is invalid");
  if (identityKey(evidence.identity) !== identityKey(identity)) errors.push("evidence identity does not match scorecard identity");
  if (!evidence.payload || typeof evidence.payload !== "object") errors.push("payload is required");
  if (!/^[a-f0-9]{64}$/i.test(evidence.payloadSha256 ?? "")) { if (evidence.source === "REAL" && errors.length === 0) return { level: "UNVERIFIED_REAL", errors: ["payload hash is absent or malformed"] }; errors.push("payloadSha256 is invalid"); }
  else if (canonicalHash(evidence.payload) !== evidence.payloadSha256) errors.push("payload hash does not match payload");
  if (evidence.type === "PAPER_OPERATIONAL_SAFETY" && evidence.payload.evidenceType === "PAPER_OPERATIONAL_SAFETY") {
    const payload = evidence.payload;
    if (payload.evidenceType !== "PAPER_OPERATIONAL_SAFETY" || payload.actualGatewayBacked !== true || !/^[a-f0-9]{64}$/i.test(payload.resultSha256 ?? "") || canonicalHash(Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "resultSha256"))) !== payload.resultSha256) errors.push("operational paper safety evidence is invalid");
    if (payload.operationalShadowEvidencePresent || payload.operationalCanaryEvidencePresent) errors.push("operational evidence claims are unsupported");
  }
  return errors.length ? { level: "INVALID", errors } : { level: evidence.source === "REAL" ? "VERIFIED_REAL" : "VERIFIED_SYNTHETIC", errors: [] };
}
function dimension(id, name, source, evidence, evidenceTrust) {
  let assessment; let reason;
  if (id === "D-008" || id === "D-009") { const value = evidence?.payload?.[source]; assessment = ASSESSMENTS.has(value) ? value : "MISSING"; reason = assessment === "MISSING" ? `${source} is not explicitly declared` : `declared by ${evidence.type}`; }
  else { assessment = evidence ? evidence.assessment : "MISSING"; if (id === "D-010" && evidence?.payload?.blockers?.length) assessment = "FAIL"; reason = evidence ? `declared by ${source}` : "required evidence is missing"; }
  return freeze({ id, name, assessment, trustLevel: evidenceTrust?.level ?? "MISSING", reason });
}
function decide(dimensions, trusts) {
  const levels = [...trusts.values()].map((entry) => entry.level);
  if (levels.includes("INVALID")) return ["INVALID", "one or more evidence seals or linkages are invalid"];
  if (levels.includes("MISSING") || levels.includes("UNVERIFIED_REAL")) return ["INSUFFICIENT_EVIDENCE", "required evidence is missing or unverified"];
  if (levels.includes("VERIFIED_SYNTHETIC")) return ["CONTINUE_RESEARCH", "synthetic evidence cannot support a paper-promotion review"];
  const failed = dimensions.filter((item) => item.assessment === "FAIL").map((item) => item.id);
  if (failed.some((id) => ["D-001", "D-002", "D-010"].includes(id))) return ["REJECT_STRATEGY", "a safety-critical research dimension failed"];
  if (failed.some((id) => ["D-005", "D-006", "D-007"].includes(id))) return ["REVISE_STRATEGY", "robustness or generalization evidence failed"];
  if (failed.length) return ["CONTINUE_RESEARCH", "a non-terminal research dimension failed"];
  if (dimensions.some((item) => ["BLOCKED", "INCONCLUSIVE"].includes(item.assessment))) return ["HOLD", "research evidence is blocked or inconclusive"];
  if (dimensions.some((item) => item.assessment === "MISSING")) return ["INSUFFICIENT_EVIDENCE", "a required dimension is not explicitly evidenced"];
  return ["PROMOTE_TO_EXTENDED_PAPER_REVIEW", "all required real evidence is sealed and passed"];
}
function createStrategyResearchScorecard(request) {
  if (!request || !request.identity || !Array.isArray(request.evidence) || !Number.isSafeInteger(request.evaluatedAtMs)) throw new Error("invalid scorecard request");
  const evidence = [...request.evidence].sort((left, right) => `${left.type}|${left.evidenceId}`.localeCompare(`${right.type}|${right.evidenceId}`));
  const selected = new Map(); const trusts = new Map();
  for (const type of REQUIRED_EVIDENCE_TYPES) { const matches = evidence.filter((item) => item.type === type); if (matches.length !== 1) trusts.set(type, { level: matches.length ? "INVALID" : "MISSING", errors: [matches.length ? `duplicate evidence type: ${type}` : "required evidence is missing"] }); else { selected.set(type, matches[0]); trusts.set(type, trust(matches[0], request.identity)); } }
  const dimensions = DIMENSIONS.map(([id, name, source]) => { const type = id === "D-008" ? "WALK_FORWARD" : id === "D-009" ? "CROSS_MARKET_VALIDATION" : source; return dimension(id, name, source, selected.get(type), trusts.get(type)); });
  const [decision, decisionReason] = decide(dimensions, trusts);
  return freeze({ schemaVersion: "WO-0031/v1", scorecardId: request.scorecardId, identity: { ...request.identity }, evaluatedAtMs: request.evaluatedAtMs, evidence: evidence.map((item) => ({ evidenceId: item.evidenceId, type: item.type, source: item.source, assessment: item.assessment, payloadSha256: item.payloadSha256, identity: { ...item.identity } })), evidenceSummary: REQUIRED_EVIDENCE_TYPES.map((type) => ({ type, trustLevel: trusts.get(type).level, errors: [...trusts.get(type).errors] })), dimensions, decision, decisionReason, unresolvedEvidenceTypes: REQUIRED_EVIDENCE_TYPES.filter((type) => trusts.get(type).level !== "VERIFIED_REAL"), promotionAuthority: false, productionMutationAllowed: false, scorecardInputSha256: canonicalHash(canonicalize({ scorecardId: request.scorecardId, identity: request.identity, evaluatedAtMs: request.evaluatedAtMs, evidence })) });
}
module.exports = { REQUIRED_EVIDENCE_TYPES, DIMENSIONS, trust, createStrategyResearchScorecard };
