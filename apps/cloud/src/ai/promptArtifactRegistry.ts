import { aiSha256, type AiAgentRole } from "../../../../packages/contracts/src/aiInference";

export interface PromptArtifact {
  readonly promptArtifactId: string;
  readonly version: string;
  readonly digest: string;
  readonly role: AiAgentRole;
  readonly inputSchemaId: string;
  readonly outputSchemaId: string;
  readonly allowedEvidenceClasses: readonly string[];
  readonly prohibitedCapabilities: readonly string[];
}

const unsafe = Object.freeze(["ORDER", "CANCEL", "TRANSFER", "WITHDRAW", "CREDENTIAL", "SECRET", "PRODUCTION_MUTATION", "LIVE_EXECUTION", "KILL_SWITCH_RELEASE", "RISK_GOVERNOR_BYPASS"]);

export class PromptArtifactRegistry {
  private readonly artifacts = new Map<string, PromptArtifact>();

  public register(artifact: PromptArtifact): PromptArtifact {
    if (!artifact.promptArtifactId.trim() || !artifact.version.trim() || !artifact.inputSchemaId.trim() || !artifact.outputSchemaId.trim()) throw new Error("prompt artifact identity is required");
    if (!artifact.allowedEvidenceClasses.length || unsafe.some((value) => !artifact.prohibitedCapabilities.map((item) => item.toUpperCase()).includes(value))) throw new Error("prompt artifact capability policy is invalid");
    if (!/^[a-f0-9]{64}$/i.test(artifact.digest)) throw new Error("prompt artifact digest must be sha256");
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
    if (artifact == null || artifact.digest !== digest) throw new Error("PROMPT_DIGEST_MISMATCH");
    return artifact;
  }
}

export function createDefaultPromptArtifactRegistry(): PromptArtifactRegistry {
  const registry = new PromptArtifactRegistry();
  const roles: readonly AiAgentRole[] = ["EVIDENCE_PRODUCER", "STRATEGY_PROPOSER", "ADVERSARIAL_CRITIC", "RISK_VERIFIER"];
  for (const role of roles) {
    const promptArtifactId = `nusa.ai.${role.toLowerCase()}`;
    const version = "1.0.0";
    registry.register({
      promptArtifactId,
      version,
      digest: aiSha256({ promptArtifactId, version, role, policy: "ZERO_AUTHORITY_EVIDENCE_ONLY" }),
      role,
      inputSchemaId: "nusa.ai.evidence-context.v1",
      outputSchemaId: `nusa.ai.${role.toLowerCase()}.output.v1`,
      allowedEvidenceClasses: ["market-data", "risk-state", "model-state", "venue-state", "accounting-state", "policy-state", "incident-state", "derived-calculation"],
      prohibitedCapabilities: unsafe
    });
  }
  return registry;
}
