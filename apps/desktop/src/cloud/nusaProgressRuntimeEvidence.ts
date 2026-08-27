import { createHash } from "node:crypto";
import type { NusaProgressEvidenceRef } from "./nusaProgressScorecard";

export interface ActualPaperRuntimeEvidenceReceipt {
  readonly schema_version: 1;
  readonly evidence_type: "nusa.actual-paper-runtime-e2e";
  readonly result: "PASS" | "FAIL";
  readonly source_commit: string;
  readonly completed_at: string;
  readonly authority: {
    readonly mode: "PAPER_ONLY";
    readonly liveAuthority: "NONE";
    readonly productionMutationAllowed: false;
    readonly aiAuthority: "ZERO_AUTHORITY";
  };
  readonly market_data: {
    readonly private_credentials_used: false;
  };
  readonly prohibited_capabilities: {
    readonly upbit_private_credentials: false;
    readonly live_order_endpoint: false;
    readonly withdrawal_transfer: false;
    readonly real_money_mutation: false;
  };
}

export interface ActualPaperRuntimeArtifactReceipt {
  readonly artifactId: number;
  readonly artifactDigest: `sha256:${string}`;
  readonly headSha: string;
  /** Exact UTF-8 bytes of the immutable JSON evidence payload. */
  readonly payload: string;
}

export interface ActualPaperRuntimeProgressEvidence {
  readonly runtime: NusaProgressEvidenceRef;
  readonly paper: NusaProgressEvidenceRef;
}

const SHA_40 = /^[a-f0-9]{40}$/;
const SHA_64 = /^[a-f0-9]{64}$/;
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

export class NusaProgressRuntimeEvidenceError extends Error {
  public constructor(readonly code: string, message: string) {
    super(message);
    this.name = "NusaProgressRuntimeEvidenceError";
  }
}

function parsePayload(payload: string): ActualPaperRuntimeEvidenceReceipt {
  try {
    return JSON.parse(payload) as ActualPaperRuntimeEvidenceReceipt;
  } catch {
    throw new NusaProgressRuntimeEvidenceError("INVALID_RUNTIME_EVIDENCE_JSON", "runtime evidence payload must be valid JSON");
  }
}

function assertSafeReceipt(receipt: ActualPaperRuntimeEvidenceReceipt): void {
  if (receipt.schema_version !== 1 || receipt.evidence_type !== "nusa.actual-paper-runtime-e2e") {
    throw new NusaProgressRuntimeEvidenceError("UNSUPPORTED_RUNTIME_EVIDENCE_SCHEMA", "unsupported Actual PAPER runtime evidence schema");
  }
  if (receipt.authority?.mode !== "PAPER_ONLY" || receipt.authority.liveAuthority !== "NONE" || receipt.authority.productionMutationAllowed !== false || receipt.authority.aiAuthority !== "ZERO_AUTHORITY") {
    throw new NusaProgressRuntimeEvidenceError("UNSAFE_RUNTIME_AUTHORITY", "runtime evidence must preserve PAPER-only zero authority");
  }
  if (receipt.market_data?.private_credentials_used !== false || receipt.prohibited_capabilities?.upbit_private_credentials !== false || receipt.prohibited_capabilities?.live_order_endpoint !== false || receipt.prohibited_capabilities?.withdrawal_transfer !== false || receipt.prohibited_capabilities?.real_money_mutation !== false) {
    throw new NusaProgressRuntimeEvidenceError("PROHIBITED_RUNTIME_CAPABILITY_PRESENT", "runtime evidence contains a prohibited LIVE/private capability");
  }
}

/**
 * Converts an immutable Actual PAPER runtime artifact into the two evidence classes it genuinely
 * demonstrates. The adapter binds payload bytes, artifact digest, and exact head SHA; workflow
 * success by itself is deliberately insufficient.
 */
export function collectActualPaperRuntimeProgressEvidence(
  artifact: ActualPaperRuntimeArtifactReceipt,
  expectedHeadSha: string,
): ActualPaperRuntimeProgressEvidence {
  if (!Number.isSafeInteger(artifact.artifactId) || artifact.artifactId <= 0) {
    throw new NusaProgressRuntimeEvidenceError("INVALID_ARTIFACT_ID", "artifactId must be a positive safe integer");
  }
  if (!SHA_40.test(expectedHeadSha) || !SHA_40.test(artifact.headSha) || artifact.headSha !== expectedHeadSha) {
    throw new NusaProgressRuntimeEvidenceError("RUNTIME_EVIDENCE_HEAD_MISMATCH", "runtime evidence must belong to the exact expected head SHA");
  }
  const digest = artifact.artifactDigest.startsWith("sha256:") ? artifact.artifactDigest.slice(7) : "";
  if (!SHA_64.test(digest)) {
    throw new NusaProgressRuntimeEvidenceError("INVALID_ARTIFACT_DIGEST", "artifact digest must be a lowercase sha256 digest");
  }
  const receipt = parsePayload(artifact.payload);
  if (receipt.source_commit !== expectedHeadSha) {
    throw new NusaProgressRuntimeEvidenceError("PAYLOAD_HEAD_MISMATCH", "runtime evidence payload source_commit must match the exact head SHA");
  }
  const observedAt = Date.parse(receipt.completed_at);
  if (!Number.isSafeInteger(observedAt) || observedAt < 0) {
    throw new NusaProgressRuntimeEvidenceError("INVALID_RUNTIME_EVIDENCE_TIMESTAMP", "runtime evidence completed_at must be a valid timestamp");
  }
  assertSafeReceipt(receipt);

  const payloadFingerprint = createHash("sha256").update(artifact.payload, "utf8").digest("hex");
  const status = receipt.result === "PASS" ? "PASS" : "FAIL";
  const base = `actual-paper-runtime:${expectedHeadSha}:${artifact.artifactId}`;

  return freeze({
    runtime: freeze({
      id: `${base}:runtime`,
      kind: "RUNTIME",
      status,
      observedAt,
      source: `runtime://evidence/github-actions-artifact/${artifact.artifactId}/${expectedHeadSha}`,
      sourceFingerprint: payloadFingerprint,
    }),
    paper: freeze({
      id: `${base}:paper`,
      kind: "PAPER",
      status,
      observedAt,
      source: `paper://evidence/github-actions-artifact/${artifact.artifactId}/${expectedHeadSha}`,
      sourceFingerprint: payloadFingerprint,
    }),
  });
}
