export type NusaProgressDomain =
  | "VERIFIED_ECONOMIC_EDGE"
  | "AUTONOMY"
  | "RELIABILITY_RECOVERY"
  | "SAFETY_RESEARCH_INTEGRITY"
  | "PRODUCT_UX"
  | "INFRASTRUCTURE_MODULE_HEALTH";

export type NusaAcceptanceClass =
  | "CODE_COMPLETE"
  | "RUNTIME_VERIFIED"
  | "EVIDENCE_VERIFIED"
  | "PRODUCT_ACCEPTED"
  | "HUMAN_ONLY";

export type NusaEvidenceKind =
  | "REPOSITORY"
  | "CI"
  | "RUNTIME"
  | "PAPER"
  | "DEVICE"
  | "HUMAN"
  | "MOCK";

export type NusaEvidenceStatus = "PASS" | "FAIL" | "UNKNOWN";

export interface NusaProgressEvidenceRef {
  readonly id: string;
  readonly kind: NusaEvidenceKind;
  readonly status: NusaEvidenceStatus;
  readonly observedAt: number;
  /** Stable locator that an independent verifier can resolve for this evidence class. */
  readonly source: string;
  /** SHA-256 of the immutable evidence payload or receipt addressed by `source`. */
  readonly sourceFingerprint: string;
  /**
   * Optional SHA-256 identity of the thing being accepted. PRODUCT_ACCEPTED uses this to bind the
   * physical-device result and human acceptance to the exact same APK/artifact rather than letting
   * unrelated evidence satisfy the two halves of the gate.
   */
  readonly subjectFingerprint?: string;
}

export interface NusaProgressItemInput {
  readonly id: string;
  readonly domain: NusaProgressDomain;
  readonly weight: number;
  readonly requiredAcceptance: NusaAcceptanceClass;
  readonly evidence: readonly NusaProgressEvidenceRef[];
}

export interface NusaProgressScorecardPolicy {
  readonly asOf: number;
  readonly maximumEvidenceAgeMs: number;
  readonly domainWeights?: Partial<Readonly<Record<NusaProgressDomain, number>>>;
}

export interface NusaProgressItemResult {
  readonly id: string;
  readonly domain: NusaProgressDomain;
  readonly weight: number;
  readonly requiredAcceptance: NusaAcceptanceClass;
  readonly status: "PASS" | "FAIL" | "UNKNOWN";
  readonly reasons: readonly string[];
  readonly acceptedEvidenceIds: readonly string[];
}

export interface NusaProgressDomainResult {
  readonly domain: NusaProgressDomain;
  readonly configuredWeight: number;
  readonly itemWeightTotal: number;
  readonly earnedItemWeight: number;
  readonly completionRatio: number;
}

export interface NusaProgressScorecard {
  readonly schemaVersion: 1;
  readonly asOf: number;
  readonly overallProgressRatio: number;
  readonly domains: readonly NusaProgressDomainResult[];
  readonly items: readonly NusaProgressItemResult[];
  readonly reasons: readonly string[];
}

export class NusaProgressScorecardError extends Error {
  public constructor(readonly code: string, message: string) {
    super(message);
    this.name = "NusaProgressScorecardError";
  }
}

const DOMAINS: readonly NusaProgressDomain[] = Object.freeze([
  "VERIFIED_ECONOMIC_EDGE",
  "AUTONOMY",
  "RELIABILITY_RECOVERY",
  "SAFETY_RESEARCH_INTEGRITY",
  "PRODUCT_UX",
  "INFRASTRUCTURE_MODULE_HEALTH",
]);

const DEFAULT_DOMAIN_WEIGHTS: Readonly<Record<NusaProgressDomain, number>> = Object.freeze({
  VERIFIED_ECONOMIC_EDGE: 0.3,
  AUTONOMY: 0.15,
  RELIABILITY_RECOVERY: 0.15,
  SAFETY_RESEARCH_INTEGRITY: 0.2,
  PRODUCT_UX: 0.1,
  INFRASTRUCTURE_MODULE_HEALTH: 0.1,
});

const SOURCE_PREFIX: Readonly<Record<NusaEvidenceKind, string>> = Object.freeze({
  REPOSITORY: "github://commit/",
  CI: "github://actions/run/",
  RUNTIME: "runtime://evidence/",
  PAPER: "paper://evidence/",
  DEVICE: "device://physical/",
  HUMAN: "human://acceptance/",
  MOCK: "mock://fixture/",
});

const HEX_64 = /^[a-f0-9]{64}$/;
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function assertFiniteNonNegative(value: number, code: string, message: string): void {
  if (!Number.isFinite(value) || value < 0) throw new NusaProgressScorecardError(code, message);
}

function requiredKinds(requiredAcceptance: NusaAcceptanceClass): readonly NusaEvidenceKind[] {
  switch (requiredAcceptance) {
    case "CODE_COMPLETE": return Object.freeze(["REPOSITORY", "CI"]);
    case "RUNTIME_VERIFIED": return Object.freeze(["RUNTIME"]);
    case "EVIDENCE_VERIFIED": return Object.freeze(["PAPER"]);
    case "PRODUCT_ACCEPTED": return Object.freeze(["DEVICE", "HUMAN"]);
    case "HUMAN_ONLY": return Object.freeze(["HUMAN"]);
  }
}

function validatePolicy(policy: NusaProgressScorecardPolicy): Readonly<Record<NusaProgressDomain, number>> {
  if (!Number.isSafeInteger(policy.asOf) || policy.asOf < 0) throw new NusaProgressScorecardError("INVALID_AS_OF", "scorecard asOf must be a non-negative safe integer");
  if (!Number.isSafeInteger(policy.maximumEvidenceAgeMs) || policy.maximumEvidenceAgeMs < 0) throw new NusaProgressScorecardError("INVALID_MAXIMUM_EVIDENCE_AGE", "maximumEvidenceAgeMs must be a non-negative safe integer");
  const weights = { ...DEFAULT_DOMAIN_WEIGHTS, ...(policy.domainWeights ?? {}) };
  let total = 0;
  for (const domain of DOMAINS) {
    const value = weights[domain];
    assertFiniteNonNegative(value, "INVALID_DOMAIN_WEIGHT", `domain weight ${domain} must be finite and non-negative`);
    total += value;
  }
  if (Math.abs(total - 1) > 1e-12) throw new NusaProgressScorecardError("DOMAIN_WEIGHTS_NOT_NORMALIZED", `domain weights must sum to 1, received ${total}`);
  return freeze(weights);
}

function validateEvidence(evidence: NusaProgressEvidenceRef, policy: NusaProgressScorecardPolicy): void {
  if (!evidence.id.trim()) throw new NusaProgressScorecardError("EMPTY_EVIDENCE_ID", "evidence id is required");
  if (!evidence.source.trim()) throw new NusaProgressScorecardError("EMPTY_EVIDENCE_SOURCE", `evidence ${evidence.id} source is required`);
  const expectedPrefix = SOURCE_PREFIX[evidence.kind];
  if (!evidence.source.startsWith(expectedPrefix) || evidence.source.length <= expectedPrefix.length) {
    throw new NusaProgressScorecardError("EVIDENCE_SOURCE_KIND_MISMATCH", `evidence ${evidence.id} source does not match ${evidence.kind}`);
  }
  if (!HEX_64.test(evidence.sourceFingerprint)) {
    throw new NusaProgressScorecardError("INVALID_EVIDENCE_FINGERPRINT", `evidence ${evidence.id} requires a lowercase SHA-256 sourceFingerprint`);
  }
  if (evidence.subjectFingerprint != null && !HEX_64.test(evidence.subjectFingerprint)) {
    throw new NusaProgressScorecardError("INVALID_SUBJECT_FINGERPRINT", `evidence ${evidence.id} subjectFingerprint must be a lowercase SHA-256 digest`);
  }
  if (!Number.isSafeInteger(evidence.observedAt) || evidence.observedAt < 0 || evidence.observedAt > policy.asOf) {
    throw new NusaProgressScorecardError("INVALID_EVIDENCE_TIMESTAMP", `evidence ${evidence.id} timestamp is invalid or future-derived`);
  }
}

function productSubjectBound(fresh: readonly NusaProgressEvidenceRef[]): boolean {
  const deviceSubjects = new Set(fresh
    .filter((evidence) => evidence.kind === "DEVICE" && evidence.status === "PASS")
    .map((evidence) => evidence.subjectFingerprint)
    .filter((value): value is string => value != null));
  return fresh.some((evidence) => evidence.kind === "HUMAN" && evidence.status === "PASS" && evidence.subjectFingerprint != null && deviceSubjects.has(evidence.subjectFingerprint));
}

function scoreItem(item: NusaProgressItemInput, policy: NusaProgressScorecardPolicy): NusaProgressItemResult {
  if (!item.id.trim()) throw new NusaProgressScorecardError("EMPTY_ITEM_ID", "scorecard item id is required");
  if (!DOMAINS.includes(item.domain)) throw new NusaProgressScorecardError("INVALID_DOMAIN", `item ${item.id} domain is unsupported`);
  if (!Number.isFinite(item.weight) || item.weight <= 0) throw new NusaProgressScorecardError("INVALID_ITEM_WEIGHT", `item ${item.id} weight must be finite and positive`);
  const evidenceIds = new Set<string>();
  for (const evidence of item.evidence) {
    validateEvidence(evidence, policy);
    if (evidenceIds.has(evidence.id)) throw new NusaProgressScorecardError("DUPLICATE_EVIDENCE_ID", `item ${item.id} duplicates evidence id ${evidence.id}`);
    evidenceIds.add(evidence.id);
  }

  const staleIds = new Set(item.evidence
    .filter((evidence) => policy.asOf - evidence.observedAt > policy.maximumEvidenceAgeMs)
    .map((evidence) => evidence.id));
  const fresh = item.evidence.filter((evidence) => !staleIds.has(evidence.id));
  const required = requiredKinds(item.requiredAcceptance);
  const accepted: string[] = [];
  const reasons: string[] = [];

  for (const kind of required) {
    const matching = fresh.filter((evidence) => evidence.kind === kind);
    if (matching.length === 0) {
      reasons.push(`MISSING_${kind}_EVIDENCE`);
      continue;
    }
    if (matching.some((evidence) => evidence.status === "FAIL")) {
      reasons.push(`${kind}_EVIDENCE_FAILED`);
      continue;
    }
    const pass = matching.filter((evidence) => evidence.status === "PASS");
    if (pass.length === 0) {
      reasons.push(`${kind}_EVIDENCE_UNKNOWN`);
      continue;
    }
    accepted.push(...pass.map((evidence) => evidence.id));
  }

  if (item.requiredAcceptance === "PRODUCT_ACCEPTED" && !reasons.some((reason) => reason.startsWith("MISSING_") || reason.endsWith("_EVIDENCE_UNKNOWN") || reason.endsWith("_EVIDENCE_FAILED")) && !productSubjectBound(fresh)) {
    reasons.push("PRODUCT_EVIDENCE_SUBJECT_MISMATCH");
  }
  if (staleIds.size > 0) reasons.push("STALE_EVIDENCE_PRESENT");
  if (item.evidence.some((evidence) => evidence.kind === "MOCK" && evidence.status === "PASS")) reasons.push("MOCK_EVIDENCE_NON_ACCEPTING");

  const hasFailure = reasons.some((reason) => reason.endsWith("_EVIDENCE_FAILED"));
  const hasMissingOrUnknown = reasons.some((reason) => reason.startsWith("MISSING_") || reason.endsWith("_EVIDENCE_UNKNOWN") || reason === "PRODUCT_EVIDENCE_SUBJECT_MISMATCH");
  const status: NusaProgressItemResult["status"] = hasFailure ? "FAIL" : hasMissingOrUnknown ? "UNKNOWN" : "PASS";

  return freeze({
    id: item.id.trim(),
    domain: item.domain,
    weight: item.weight,
    requiredAcceptance: item.requiredAcceptance,
    status,
    reasons: freeze([...new Set(reasons)].sort()),
    acceptedEvidenceIds: freeze([...new Set(accepted)].sort()),
  });
}

/**
 * Computes NUSA progress from explicit evidence only. There is no partial credit for stale,
 * missing, mock-only, or weaker evidence classes, so recomputing after an evidence regression
 * automatically demotes the score instead of preserving an inflated historical level.
 */
export function computeNusaProgressScorecard(
  items: readonly NusaProgressItemInput[],
  policy: NusaProgressScorecardPolicy,
): NusaProgressScorecard {
  if (items.length === 0) throw new NusaProgressScorecardError("EMPTY_SCORECARD", "scorecard requires at least one item");
  const domainWeights = validatePolicy(policy);
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) throw new NusaProgressScorecardError("DUPLICATE_ITEM_ID", `duplicate scorecard item ${item.id}`);
    ids.add(item.id);
  }

  const results = freeze(items.map((item) => scoreItem(item, policy)));
  const domains = freeze(DOMAINS.map((domain) => {
    const domainItems = results.filter((item) => item.domain === domain);
    const itemWeightTotal = domainItems.reduce((sum, item) => sum + item.weight, 0);
    const earnedItemWeight = domainItems.filter((item) => item.status === "PASS").reduce((sum, item) => sum + item.weight, 0);
    const completionRatio = itemWeightTotal === 0 ? 0 : earnedItemWeight / itemWeightTotal;
    return freeze({ domain, configuredWeight: domainWeights[domain], itemWeightTotal, earnedItemWeight, completionRatio });
  }));
  const overallProgressRatio = domains.reduce((sum, domain) => sum + domain.configuredWeight * domain.completionRatio, 0);
  const reasons: string[] = [];
  if (results.some((item) => item.status === "UNKNOWN")) reasons.push("UNKNOWN_EVIDENCE_REMAINS");
  if (results.some((item) => item.status === "FAIL")) reasons.push("FAILED_EVIDENCE_PRESENT");

  return freeze({
    schemaVersion: 1,
    asOf: policy.asOf,
    overallProgressRatio,
    domains,
    items: results,
    reasons: freeze(reasons),
  });
}
