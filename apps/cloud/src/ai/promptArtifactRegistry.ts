import { aiSha256, type AiAgentRole } from "../../../../packages/contracts/src/aiInference";

export interface PromptArtifact {
  readonly promptArtifactId: string;
  readonly version: string;
  readonly digest: string;
  readonly role: AiAgentRole;
  readonly instructions: string;
  readonly inputSchemaId: string;
  readonly outputSchemaId: string;
  readonly allowedEvidenceClasses: readonly string[];
  readonly prohibitedCapabilities: readonly string[];
}

export type PromptArtifactDefinition = Omit<PromptArtifact, "digest">;

const unsafe = Object.freeze(["ORDER", "CANCEL", "TRANSFER", "WITHDRAW", "CREDENTIAL", "SECRET", "PRODUCTION_MUTATION", "LIVE_EXECUTION", "KILL_SWITCH_RELEASE", "RISK_GOVERNOR_BYPASS"]);

export function promptArtifactDigest(artifact: PromptArtifactDefinition): string {
  return aiSha256({
    promptArtifactId: artifact.promptArtifactId,
    version: artifact.version,
    role: artifact.role,
    instructions: artifact.instructions,
    inputSchemaId: artifact.inputSchemaId,
    outputSchemaId: artifact.outputSchemaId,
    allowedEvidenceClasses: artifact.allowedEvidenceClasses,
    prohibitedCapabilities: artifact.prohibitedCapabilities
  });
}

const definitionOf = (artifact: PromptArtifact): PromptArtifactDefinition => ({
  promptArtifactId: artifact.promptArtifactId,
  version: artifact.version,
  role: artifact.role,
  instructions: artifact.instructions,
  inputSchemaId: artifact.inputSchemaId,
  outputSchemaId: artifact.outputSchemaId,
  allowedEvidenceClasses: artifact.allowedEvidenceClasses,
  prohibitedCapabilities: artifact.prohibitedCapabilities
});

export class PromptArtifactRegistry {
  private readonly artifacts = new Map<string, PromptArtifact>();

  public register(artifact: PromptArtifact): PromptArtifact {
    if (!artifact.promptArtifactId.trim() || !artifact.version.trim() || !artifact.instructions.trim() || !artifact.inputSchemaId.trim() || !artifact.outputSchemaId.trim()) throw new Error("prompt artifact identity and instructions are required");
    if (!artifact.allowedEvidenceClasses.length || unsafe.some((value) => !artifact.prohibitedCapabilities.map((item) => item.toUpperCase()).includes(value))) throw new Error("prompt artifact capability policy is invalid");
    if (!/^[a-f0-9]{64}$/i.test(artifact.digest)) throw new Error("prompt artifact digest must be sha256");
    if (promptArtifactDigest(definitionOf(artifact)) !== artifact.digest) throw new Error("prompt artifact digest does not bind the complete prompt body");
    const key = `${artifact.promptArtifactId}@${artifact.version}`;
    const current = this.artifacts.get(key);
    if (current != null && JSON.stringify(current) !== JSON.stringify(artifact)) throw new Error("prompt artifact version conflict");
    const frozen = Object.freeze({ ...artifact, allowedEvidenceClasses: Object.freeze([...artifact.allowedEvidenceClasses]), prohibitedCapabilities: Object.freeze([...artifact.prohibitedCapabilities]) });
    this.artifacts.set(key, frozen);
    return frozen;
  }

  public get(id: string, version: string): PromptArtifact | undefined {
    return this.artifacts.get(`${id}@${version}`);
  }

  public assertDefinition(id: string, version: string, digest: string): PromptArtifact {
    const artifact = this.get(id, version);
    if (artifact == null || artifact.digest !== digest || promptArtifactDigest(definitionOf(artifact)) !== artifact.digest) throw new Error("PROMPT_DIGEST_MISMATCH");
    return artifact;
  }
}

const roleInstructions: Readonly<Record<AiAgentRole, string>> = Object.freeze({
  EVIDENCE_PRODUCER: "Analyze only the supplied verified evidence payloads. State material facts and derived observations, cite supplied evidence IDs for every factual claim, identify missing evidence and uncertainty, and emit only the required structured JSON. Never request or expose credentials, secrets, orders, transfers, production mutation, LIVE execution, risk bypass, or safety-control release.",
  STRATEGY_PROPOSER: "Using only the supplied verified evidence payloads and prior bounded analysis, propose at most a PAPER/Research candidate or no action. Cite supplied evidence IDs, state assumptions and uncertainty, and emit a rawProbability number within [0,1] as an uncalibrated model estimate only. rawProbability is not a verified success probability, performance guarantee, execution signal, risk input, or authority. Emit only the required structured JSON. Never place or request orders, transfers, credentials, production mutation, LIVE execution, risk changes, risk bypass, or safety-control release.",
  ADVERSARIAL_CRITIC: "Critique the supplied PAPER/Research proposal and verified evidence. Search for counter-evidence, failed assumptions, missing tests and alternative explanations; bind the review to the supplied proposal hash and emit only the required structured JSON. Never request orders, transfers, credentials, production mutation, LIVE execution, risk bypass, or safety-control release.",
  RISK_VERIFIER: "Review the supplied verified evidence and PAPER/Research proposal against deterministic risk-policy references. Report hard denies, warnings, missing requirements and escalations; emit only the required structured JSON. This analysis cannot override deterministic risk, HALT, kill switch, P0 state, or any human-only LIVE gate and cannot authorize orders, transfers or production mutation."
});

export function createDefaultPromptArtifactRegistry(): PromptArtifactRegistry {
  const registry = new PromptArtifactRegistry();
  const roles: readonly AiAgentRole[] = ["EVIDENCE_PRODUCER", "STRATEGY_PROPOSER", "ADVERSARIAL_CRITIC", "RISK_VERIFIER"];
  for (const role of roles) {
    const definition: PromptArtifactDefinition = {
      promptArtifactId: `nusa.ai.${role.toLowerCase()}`,
      version: "1.0.0",
      role,
      instructions: roleInstructions[role],
      inputSchemaId: "nusa.ai.evidence-context.v1",
      outputSchemaId: `nusa.ai.${role.toLowerCase()}.output.v1`,
      allowedEvidenceClasses: ["market-data", "risk-state", "model-state", "venue-state", "accounting-state", "policy-state", "incident-state", "derived-calculation"],
      prohibitedCapabilities: unsafe
    };
    registry.register({ ...definition, digest: promptArtifactDigest(definition) });
  }
  return registry;
}
