import { createHash } from "node:crypto";
import type { CodingRunnerNoActionOutcome } from "./codingRunnerRemediation";
import type { ReleaseCompletionStatus } from "./releaseCompletion";

/**
 * Deterministic classification of whether an Autopilot execution produced a verified useful completion
 * (docs/AUTOPILOT_COMPLETION_RECEIPT_DESIGN.md). It only reads evidence that other components produced; it grants no
 * authority, merges nothing and never counts a no-action outcome as productive. Missing evidence is reported by name and
 * never filled in.
 */
export type AutopilotCompletionClassification =
  | "VERIFIED_USEFUL_COMPLETION"
  | "VALID_NO_ACTION"
  | "FAILED_TO_REMEDIATE"
  | "BLOCKED"
  | "INCOMPLETE";

export interface AutopilotCompletionEvidence {
  readonly task: Readonly<{ executionId: string; dedupeKey: string }>;
  readonly remediation: Readonly<{ outcome: CodingRunnerNoActionOutcome | "CHANGE_PRODUCED"; attempts: number; maxAttempts: number }>;
  readonly change: Readonly<{ headSha: string | null; changedFiles: readonly string[]; pullRequestNumber: number | null }>;
  readonly ci: Readonly<{ conclusion: string | null; headSha: string | null }>;
  readonly audit: Readonly<{ independentApproval: boolean; auditedHeadSha: string | null; approvedByAppId: string | null }>;
  readonly release: Readonly<{ status: ReleaseCompletionStatus | null; mergedSha: string | null }>;
  /** `required` is derived upstream from the Worker runtime-input scope; false means no deployment check is demanded. */
  readonly runtime: Readonly<{ required: boolean; deployedRevisionIsDescendantOfMerged: boolean | null; healthOk: boolean | null }>;
  readonly liveAuthority: string;
  readonly productionMutationAllowed: boolean;
  readonly aiAuthority: string;
}

export interface TrustedCompletionPolicy {
  /** Release-authority GitHub App ID from protected configuration, never from caller evidence. */
  readonly releaseAppId: string;
}

export interface AutopilotCompletionResult {
  readonly classification: AutopilotCompletionClassification;
  readonly missing: readonly string[];
  readonly receiptId: string | null;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

const SHA40 = /^[0-9a-f]{40}$/i;
const APP_ID = /^[1-9][0-9]*$/;

function result(classification: AutopilotCompletionClassification, missing: readonly string[] = [], receiptId: string | null = null): AutopilotCompletionResult {
  return Object.freeze({
    classification,
    missing: Object.freeze([...missing]),
    receiptId,
    liveAuthority: "NONE" as const,
    productionMutationAllowed: false as const,
    aiAuthority: "ZERO_AUTHORITY" as const,
  });
}

export function classifyAutopilotCompletion(evidence: AutopilotCompletionEvidence, policy: TrustedCompletionPolicy): AutopilotCompletionResult {
  if (!APP_ID.test(policy.releaseAppId)) throw new Error("AUTOPILOT_COMPLETION_POLICY_APP_ID_INVALID");
  if (evidence.liveAuthority !== "NONE" || evidence.productionMutationAllowed !== false || evidence.aiAuthority !== "ZERO_AUTHORITY") {
    return result("BLOCKED", ["authorityInvariants"]);
  }
  const { remediation } = evidence;
  if (!Number.isSafeInteger(remediation.attempts) || !Number.isSafeInteger(remediation.maxAttempts) || remediation.attempts < 0 || remediation.maxAttempts < 1) {
    return result("INCOMPLETE", ["remediation.attempts"]);
  }
  if (remediation.outcome === "FAILED_CLOSED") return result("BLOCKED", ["remediation.failedClosed"]);
  if (remediation.outcome === "VALID_NO_ACTION") return result("VALID_NO_ACTION");
  if (remediation.outcome === "FAILED_TO_REMEDIATE") return result("FAILED_TO_REMEDIATE");

  const missing: string[] = [];
  const head = evidence.change.headSha?.toLowerCase() ?? null;
  if (head === null || !SHA40.test(head)) missing.push("change.headSha");
  if (evidence.change.changedFiles.length === 0) missing.push("change.changedFiles");
  if (evidence.change.pullRequestNumber === null || !Number.isSafeInteger(evidence.change.pullRequestNumber) || evidence.change.pullRequestNumber < 1) missing.push("change.pullRequestNumber");
  if (evidence.ci.conclusion !== "success") missing.push("ci.success");
  if (head === null || evidence.ci.headSha?.toLowerCase() !== head) missing.push("ci.headShaMatch");
  if (!evidence.audit.independentApproval) missing.push("audit.independentApproval");
  if (head === null || evidence.audit.auditedHeadSha?.toLowerCase() !== head) missing.push("audit.headShaMatch");
  if (evidence.audit.approvedByAppId !== policy.releaseAppId) missing.push("audit.trustedApp");
  const merged = evidence.release.mergedSha?.toLowerCase() ?? null;
  if (evidence.release.status !== "RELEASE_COMPLETE") missing.push("release.complete");
  if (merged === null || !SHA40.test(merged)) missing.push("release.mergedSha");
  if (evidence.runtime.required && (evidence.runtime.deployedRevisionIsDescendantOfMerged !== true || evidence.runtime.healthOk !== true)) missing.push("runtime.verified");
  if (missing.length > 0) return result("INCOMPLETE", missing);

  const receiptId = createHash("sha256").update(`${evidence.task.executionId}\n${evidence.task.dedupeKey}\n${merged}`).digest("hex");
  return result("VERIFIED_USEFUL_COMPLETION", [], receiptId);
}

const OUTCOMES = new Set(["VALID_NO_ACTION", "FAILED_TO_REMEDIATE", "FAILED_CLOSED", "CHANGE_PRODUCED"]);
const RELEASE_STATUSES = new Set(["RELEASE_NOT_APPLICABLE", "RELEASE_PROVENANCE_MISSING", "NOT_RELEASED", "CONVERGENCE_INCOMPLETE", "RELEASE_COMPLETE"]);

const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const str = (value: unknown, max = 200): string | null => typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
const strOrNull = (value: unknown): string | null => value === null || value === undefined ? null : str(value);

/**
 * Parses untrusted JSON into evidence, or returns null. Fields that are absent become null/false rather than being
 * guessed, so the classifier reports them as missing.
 */
export function parseAutopilotCompletionEvidence(value: unknown): AutopilotCompletionEvidence | null {
  const root = record(value);
  const task = record(root?.task);
  const remediation = record(root?.remediation);
  const change = record(root?.change);
  const ci = record(root?.ci);
  const audit = record(root?.audit);
  const release = record(root?.release);
  const runtime = record(root?.runtime);
  if (!root || !task || !remediation || !change || !ci || !audit || !release || !runtime) return null;
  const executionId = str(task.executionId);
  const dedupeKey = str(task.dedupeKey);
  const outcome = str(remediation.outcome);
  if (!executionId || !dedupeKey || !outcome || !OUTCOMES.has(outcome)) return null;
  if (!Array.isArray(change.changedFiles) || change.changedFiles.length > 200 || !change.changedFiles.every((file) => str(file, 300) !== null)) return null;
  const releaseStatus = release.status === null || release.status === undefined ? null : str(release.status);
  if (releaseStatus !== null && !RELEASE_STATUSES.has(releaseStatus)) return null;
  return Object.freeze({
    task: Object.freeze({ executionId, dedupeKey }),
    remediation: Object.freeze({ outcome: outcome as CodingRunnerNoActionOutcome | "CHANGE_PRODUCED", attempts: Number(remediation.attempts), maxAttempts: Number(remediation.maxAttempts) }),
    change: Object.freeze({ headSha: strOrNull(change.headSha), changedFiles: Object.freeze([...(change.changedFiles as string[])]), pullRequestNumber: typeof change.pullRequestNumber === "number" ? change.pullRequestNumber : null }),
    ci: Object.freeze({ conclusion: strOrNull(ci.conclusion), headSha: strOrNull(ci.headSha) }),
    audit: Object.freeze({ independentApproval: audit.independentApproval === true, auditedHeadSha: strOrNull(audit.auditedHeadSha), approvedByAppId: strOrNull(audit.approvedByAppId) }),
    release: Object.freeze({ status: releaseStatus as ReleaseCompletionStatus | null, mergedSha: strOrNull(release.mergedSha) }),
    runtime: Object.freeze({ required: runtime.required === true, deployedRevisionIsDescendantOfMerged: typeof runtime.deployedRevisionIsDescendantOfMerged === "boolean" ? runtime.deployedRevisionIsDescendantOfMerged : null, healthOk: typeof runtime.healthOk === "boolean" ? runtime.healthOk : null }),
    liveAuthority: String(root.liveAuthority),
    productionMutationAllowed: root.productionMutationAllowed === false ? false : true,
    aiAuthority: String(root.aiAuthority),
  });
}
