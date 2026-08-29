import { validateEvolutionOpportunity, type EvolutionOpportunity } from "./evolveOpportunity";

export type WorkflowFailureConclusion = "failure" | "cancelled" | "timed_out";

export interface WorkflowFailureEvidence {
  readonly workflowName: string;
  readonly runId: number;
  readonly headSha: string;
  readonly conclusion: WorkflowFailureConclusion;
  readonly completedAt: string;
}

export interface WorkflowOpportunitySourceInput {
  readonly observations: readonly WorkflowFailureEvidence[];
  readonly observedAt: string;
  readonly maxAgeSeconds: number;
}

const SHA = /^[0-9a-f]{40}$/;
const NAME = /^[A-Za-z0-9_.:/ -]{1,120}$/;
const CONCLUSIONS = new Set<WorkflowFailureConclusion>(["failure", "cancelled", "timed_out"]);

function normalizedName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function validateObservation(value: WorkflowFailureEvidence): void {
  if (!NAME.test(value.workflowName)) throw new Error("EVOLVE_WORKFLOW_EVIDENCE_NAME_INVALID");
  if (!Number.isSafeInteger(value.runId) || value.runId <= 0) throw new Error("EVOLVE_WORKFLOW_EVIDENCE_RUN_ID_INVALID");
  if (!SHA.test(value.headSha)) throw new Error("EVOLVE_WORKFLOW_EVIDENCE_SHA_INVALID");
  if (!CONCLUSIONS.has(value.conclusion)) throw new Error("EVOLVE_WORKFLOW_EVIDENCE_CONCLUSION_INVALID");
  if (!Number.isFinite(Date.parse(value.completedAt))) throw new Error("EVOLVE_WORKFLOW_EVIDENCE_COMPLETED_AT_INVALID");
}

/**
 * Converts fresh, concrete GitHub Actions failure evidence into bounded EVOLVE
 * opportunities. This source only describes problems. It does not execute work,
 * create queues, mutate production, or grant authority.
 */
export function deriveWorkflowFailureOpportunities(input: WorkflowOpportunitySourceInput): readonly EvolutionOpportunity[] {
  const observedAtMs = Date.parse(input.observedAt);
  if (!Number.isFinite(observedAtMs)) throw new Error("EVOLVE_WORKFLOW_SOURCE_OBSERVED_AT_INVALID");
  if (!Number.isFinite(input.maxAgeSeconds) || input.maxAgeSeconds <= 0) throw new Error("EVOLVE_WORKFLOW_SOURCE_MAX_AGE_INVALID");

  const deduped = new Map<string, EvolutionOpportunity>();
  for (const observation of input.observations) {
    validateObservation(observation);
    const completedAtMs = Date.parse(observation.completedAt);
    const ageSeconds = (observedAtMs - completedAtMs) / 1000;
    if (ageSeconds < 0 || ageSeconds > input.maxAgeSeconds) continue;

    const name = normalizedName(observation.workflowName);
    if (!name) throw new Error("EVOLVE_WORKFLOW_EVIDENCE_NAME_INVALID");
    const id = `gha:${name}:${observation.headSha}:${observation.conclusion}`;
    if (deduped.has(id)) continue;

    const opportunity = validateEvolutionOpportunity({
      id,
      source: "github-actions",
      problem: `Canonical workflow ${observation.workflowName} concluded ${observation.conclusion} for ${observation.headSha}.`,
      evidence: [{
        source: "github-actions",
        reference: `workflow:${observation.runId}@${observation.headSha}`,
        quality: 1,
      }],
      impact: observation.workflowName === "CI" ? 0.95 : 0.75,
      confidence: 1,
      risk: 0.15,
      reversibility: 0.95,
      status: "DISCOVERED",
      createdAt: observation.completedAt,
    });
    deduped.set(id, opportunity);
  }

  return Object.freeze([...deduped.values()].sort((a, b) => a.id.localeCompare(b.id)));
}
