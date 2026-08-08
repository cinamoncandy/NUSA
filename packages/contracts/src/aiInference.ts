import { createHash } from "node:crypto";

export type AiAgentRole = "EVIDENCE_PRODUCER" | "STRATEGY_PROPOSER" | "ADVERSARIAL_CRITIC" | "RISK_VERIFIER";
export type AiOrchestrationStatus = "COMPLETED" | "UNAVAILABLE" | "INCOMPLETE" | "INVALID";
export type ModelFailureCode = "PROVIDER_UNAVAILABLE" | "TIMEOUT" | "OUTPUT_TOO_LARGE" | "MALFORMED_OUTPUT" | "SCHEMA_VIOLATION" | "PROMPT_DIGEST_MISMATCH" | "CONTEXT_INVALID" | "EVIDENCE_MISSING" | "EVIDENCE_DIGEST_MISMATCH" | "SENSITIVE_EVIDENCE" | "REPLAY_CONFLICT" | "UNKNOWN";

export interface ModelUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

export interface AiEvidenceMaterialization {
  readonly evidenceId: string;
  readonly contentDigest: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface ModelRequest {
  readonly requestId: string;
  readonly role: AiAgentRole;
  readonly providerId: string;
  readonly modelVersionId: string;
  readonly promptArtifactId: string;
  readonly promptArtifactVersion: string;
  readonly promptArtifactDigest: string;
  /** Exact immutable instructions covered by promptArtifactDigest. */
  readonly instructions: string;
  readonly contextHash: string;
  readonly inputHash: string;
  /** Evidence-only input. Raw application state and credentials are prohibited. */
  readonly input: Readonly<Record<string, unknown>>;
  readonly maxOutputBytes: number;
  readonly maxTokens: number;
  readonly timeoutMs: number;
  readonly attempt: number;
}

export interface ModelResponse {
  readonly requestId: string;
  readonly providerId: string;
  readonly modelVersionId: string;
  readonly promptArtifactDigest: string;
  readonly contextHash: string;
  readonly inputHash: string;
  readonly structuredOutput: unknown;
  readonly outputHash: string;
  readonly usage?: ModelUsage;
  readonly startedAt: number;
  readonly completedAt: number;
}

export interface ModelFailure {
  readonly requestId: string;
  readonly code: ModelFailureCode;
  readonly retryable: boolean;
  readonly providerId: string;
  readonly modelVersionId: string;
  readonly occurredAt: number;
}

export interface StructuredAgentOutput {
  readonly schemaVersion: 1;
  readonly role: AiAgentRole;
  readonly evidenceReferences: readonly string[];
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface AiReadOnlyProjection {
  readonly status: "AVAILABLE" | "UNAVAILABLE" | "INCOMPLETE";
  readonly thesis: string | null;
  readonly confidence: number;
  readonly evidenceReferences: readonly string[];
  readonly counterEvidence: readonly string[];
  readonly uncertainty: string | null;
  readonly criticSeverity: "none" | "low" | "medium" | "high" | "critical" | null;
  readonly disagreements: readonly string[];
  readonly lastModelRun: number | null;
  readonly modelVersion: string | null;
  readonly promptVersion: string | null;
  readonly calibrationStatus: "UNKNOWN";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
}

export interface ModelProvider {
  readonly providerId: string;
  readonly modelVersionId: string;
  infer(request: ModelRequest): Promise<ModelResponse>;
}

export const canonicalAiJson = (value: unknown): string => {
  const normalize = (item: unknown): unknown => {
    if (item == null || typeof item === "string" || typeof item === "number" || typeof item === "boolean") return item;
    if (Array.isArray(item)) return item.map(normalize);
    if (typeof item === "object") {
      const record = item as Record<string, unknown>;
      return Object.fromEntries(Object.keys(record).sort().filter((key) => record[key] !== undefined).map((key) => [key, normalize(record[key])]));
    }
    throw new Error("unsupported AI value");
  };
  return JSON.stringify(normalize(value));
};

export const aiSha256 = (value: unknown): string => createHash("sha256").update(canonicalAiJson(value), "utf8").digest("hex");

export const isAiSha256 = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
