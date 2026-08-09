"use strict";
const {
  CANONICAL_PROMOTION_AUTHORITY,
  createStrategyResearchScorecard
} = require("./strategy-research-scorecard.js");

function verifyStrategyResearchScorecard(request, scorecard) {
  const errors = [];
  if (!scorecard) return { status: "FAIL", errors: ["scorecard is missing"] };
  if (scorecard.productionMutationAllowed !== false || scorecard.promotionAuthority !== false) {
    errors.push("scorecard must not grant authority");
  }
  if (scorecard.canonicalPromotionAuthority !== CANONICAL_PROMOTION_AUTHORITY) {
    errors.push("scorecard must identify the canonical promotion gate authority");
  }
  if (Object.prototype.hasOwnProperty.call(scorecard, "decision") || Object.prototype.hasOwnProperty.call(scorecard, "researchDecision")) {
    errors.push("provenance scorecard must not emit a promotion decision");
  }
  try {
    const rebuilt = createStrategyResearchScorecard(request);
    for (const key of [
      "readiness",
      "readinessReason",
      "dimensions",
      "evidenceSummary",
      "unresolvedEvidenceTypes",
      "canonicalPromotionAuthority",
      "scorecardInputSha256"
    ]) {
      if (JSON.stringify(scorecard[key]) !== JSON.stringify(rebuilt[key])) {
        errors.push(`${key} does not match deterministic rebuild`);
      }
    }
  } catch (error) {
    errors.push(error.message);
  }
  return { status: errors.length ? "FAIL" : "PASS", errors: Object.freeze(errors) };
}

module.exports = { verifyStrategyResearchScorecard };
