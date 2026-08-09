import type { AiAgentRole } from "../../../../packages/contracts/src/aiInference";

export type AiJsonSchema = Readonly<Record<string, unknown>>;

const stringArraySchema = (): AiJsonSchema => ({ type: "array", items: { type: "string" } });

const payloadSchema = (role: AiAgentRole): AiJsonSchema => {
  if (role === "EVIDENCE_PRODUCER") {
    return {
      type: "object",
      additionalProperties: false,
      required: ["observations", "missingEvidence", "evidenceBundleHash"],
      properties: {
        observations: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["claim", "claimType", "evidenceReferences", "confidence", "freshnessStatus"],
            properties: {
              claim: { type: "string" },
              claimType: { type: "string", enum: ["fact", "derived", "assumption", "unknown"] },
              evidenceReferences: stringArraySchema(),
              confidence: { type: "string" },
              freshnessStatus: { type: "string", enum: ["fresh", "stale", "conflicted", "unknown"] }
            }
          }
        },
        missingEvidence: stringArraySchema(),
        evidenceBundleHash: { type: "string" }
      }
    };
  }
  if (role === "STRATEGY_PROPOSER") {
    return {
      type: "object",
      additionalProperties: false,
      required: ["strategyVersionId", "decision", "rationaleClaims", "assumptions", "uncertainty", "rawProbability", "expectedEffect", "costSensitivity", "capacitySensitivity"],
      properties: {
        strategyVersionId: { type: "string" },
        decision: { type: "string", enum: ["candidate", "no_action", "insufficient_evidence"] },
        rationaleClaims: stringArraySchema(),
        assumptions: stringArraySchema(),
        uncertainty: { type: "string" },
        rawProbability: { type: "number", minimum: 0, maximum: 1 },
        expectedEffect: { type: "string" },
        costSensitivity: { type: "string" },
        capacitySensitivity: { type: "string" }
      }
    };
  }
  if (role === "ADVERSARIAL_CRITIC") {
    return {
      type: "object",
      additionalProperties: false,
      required: ["reviewedProposalHash", "counterClaims", "failedAssumptions", "missingTests", "alternativeExplanations", "severity"],
      properties: {
        reviewedProposalHash: { type: "string" },
        counterClaims: stringArraySchema(),
        failedAssumptions: stringArraySchema(),
        missingTests: stringArraySchema(),
        alternativeExplanations: stringArraySchema(),
        severity: { type: "string", enum: ["none", "low", "medium", "high", "critical"] }
      }
    };
  }
  return {
    type: "object",
    additionalProperties: false,
    required: ["result", "hardDenies", "warnings", "missingRequirements", "requiredEscalations", "policyReferences"],
    properties: {
      result: { type: "string", enum: ["verified", "denied", "incomplete"] },
      hardDenies: stringArraySchema(),
      warnings: stringArraySchema(),
      missingRequirements: stringArraySchema(),
      requiredEscalations: stringArraySchema(),
      policyReferences: stringArraySchema()
    }
  };
};

export const structuredOutputSchema = (role: AiAgentRole): AiJsonSchema => ({
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "role", "evidenceReferences", "payload"],
  properties: {
    schemaVersion: { type: "integer", enum: [1] },
    role: { type: "string", enum: [role] },
    evidenceReferences: stringArraySchema(),
    payload: payloadSchema(role)
  }
});
