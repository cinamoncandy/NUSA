import { createHash } from "node:crypto";

interface ShadowCompletionDiagnostics {
  readonly sessionId: string | null;
  readonly startedAt: number | null;
  readonly state: "COMPLETED" | string;
  readonly signalCount: number;
  readonly actualOrderCount: number;
  readonly actualFillCount: number;
  readonly cashMutationCount: number;
  readonly positionMutationCount: number;
  readonly executionGateCallCount: number;
  readonly actualBrokerCallCount: number;
}

export type ShadowCompletionSafety = "SAFE_COMPLETION" | "NOT_SAFE_COMPLETION";

export interface ShadowCompletionEvidence {
  readonly schemaVersion: 1;
  readonly sessionId: string;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly durationMs: number;
  readonly completionReason: string;
  readonly signalCount: number;
  readonly actualOrderCount: number;
  readonly actualFillCount: number;
  readonly cashMutationCount: number;
  readonly positionMutationCount: number;
  readonly executionGateCallCount: number;
  readonly brokerCallCount: number;
  readonly privateApiCallCount: number;
  readonly finalState: "COMPLETED" | string;
  readonly safety: ShadowCompletionSafety;
  readonly createdAt: number;
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]));
}

export function hashShadowCompletionEvidence(value: ShadowCompletionEvidence): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

export function isSafeShadowCompletion(value: Readonly<Pick<ShadowCompletionEvidence, "finalState" | "actualOrderCount" | "actualFillCount" | "cashMutationCount" | "positionMutationCount" | "executionGateCallCount" | "brokerCallCount" | "privateApiCallCount">>): boolean {
  return value.finalState === "COMPLETED" && [value.actualOrderCount, value.actualFillCount, value.cashMutationCount, value.positionMutationCount, value.executionGateCallCount, value.brokerCallCount, value.privateApiCallCount].every((count) => count === 0);
}

export function buildShadowCompletionEvidence(input: Readonly<{ diagnostics: ShadowCompletionDiagnostics; completionReason: string; completedAt: number; privateApiCallCount?: number; createdAt?: number }>): ShadowCompletionEvidence | null {
  const d = input.diagnostics;
  if (d.sessionId === null || d.startedAt === null || d.state !== "COMPLETED") return null;
  const privateApiCallCount = input.privateApiCallCount ?? 0;
  const evidence: ShadowCompletionEvidence = Object.freeze({
    schemaVersion: 1,
    sessionId: d.sessionId,
    startedAt: d.startedAt,
    completedAt: input.completedAt,
    durationMs: Math.max(0, input.completedAt - d.startedAt),
    completionReason: input.completionReason,
    signalCount: d.signalCount,
    actualOrderCount: d.actualOrderCount,
    actualFillCount: d.actualFillCount,
    cashMutationCount: d.cashMutationCount,
    positionMutationCount: d.positionMutationCount,
    executionGateCallCount: d.executionGateCallCount,
    brokerCallCount: d.actualBrokerCallCount,
    privateApiCallCount,
    finalState: d.state,
    safety: isSafeShadowCompletion({ finalState: d.state, actualOrderCount: d.actualOrderCount, actualFillCount: d.actualFillCount, cashMutationCount: d.cashMutationCount, positionMutationCount: d.positionMutationCount, executionGateCallCount: d.executionGateCallCount, brokerCallCount: d.actualBrokerCallCount, privateApiCallCount }) ? "SAFE_COMPLETION" : "NOT_SAFE_COMPLETION",
    createdAt: input.createdAt ?? input.completedAt
  });
  return evidence;
}
