import { createHash } from "node:crypto";
import { CLOUD_PAPER_RISK_LIMITS } from "./cloudPaperCanonicalRiskGateway";
import type { IndependentRiskLimits } from "./independentRiskGateway";

function validateLimits(limits: IndependentRiskLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`cloud PAPER risk limit ${name} is invalid`);
  }
}

/**
 * Mirrors the exact canonical risk-gateway policy fingerprint material: JSON serialization of the
 * immutable IndependentRiskLimits object followed by SHA-256. Production composition uses the
 * exported CLOUD_PAPER_RISK_LIMITS, so closed-learning evidence can bind itself to the same risk
 * policy without reaching into mutable/private gateway state.
 */
export function cloudPaperRiskPolicyFingerprint(limits: IndependentRiskLimits = CLOUD_PAPER_RISK_LIMITS): string {
  validateLimits(limits);
  return createHash("sha256").update(JSON.stringify(limits), "utf8").digest("hex");
}

export const CLOUD_PAPER_RISK_POLICY_FINGERPRINT = cloudPaperRiskPolicyFingerprint();
