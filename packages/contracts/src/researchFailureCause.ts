/**
 * Learning loop L2, record-only instrumentation (docs/LEARNING_L2_PREREG_2026-11-20.md): a pure classifier that maps one Research
 * experiment result to exactly one cause class from a FIXED, reviewed list. No IO, no clock, no randomness, never throws. Unknown or
 * malformed input is UNCLASSIFIED, never guessed. Nothing in a decision, gate, qualification, allocation, threshold or order path may
 * import this module (pinned by tests/research-failure-cause-isolation.test.js). It stores nothing and changes no behaviour.
 */
export const RESEARCH_FAILURE_CAUSES = Object.freeze([
  "NO_EDGE",
  "COST_DOMINATED",
  "EXCESSIVE_DRAWDOWN",
  "EXECUTION_MISMATCH",
  "REGIME_FRAGILE",
  "DATA_INSUFFICIENT",
  "STALE_EVIDENCE",
  "DEPENDENCE_UNVERIFIED",
  "DESIGN_REJECTED",
  "NOT_APPLICABLE_NOT_A_FAILURE",
  "UNCLASSIFIED",
] as const);
export type ResearchFailureCause = (typeof RESEARCH_FAILURE_CAUSES)[number];

export interface ResearchFailureCauseResult {
  readonly cause: ResearchFailureCause;
  /** A fixed label saying which rule decided; never a copy of the input. */
  readonly basis: "STATUS_CODE" | "EVIDENCE_METRICS" | "UNKNOWN_OR_MALFORMED";
}

const result = (cause: ResearchFailureCause, basis: ResearchFailureCauseResult["basis"]): ResearchFailureCauseResult => Object.freeze({ cause, basis });
const UNCLASSIFIED = result("UNCLASSIFIED", "UNKNOWN_OR_MALFORMED");

const table = (entries: readonly (readonly [string, ResearchFailureCause])[]): ReadonlyMap<string, ResearchFailureCause> => new Map(entries);

/** Failure reasons of apps/cloud/src/researchFailureMemory.ts (RESEARCH_FAILURE_REASONS), without the FAIL_ prefix. */
const FAILURE_REASONS = table([
  ["NO_EDGE", "NO_EDGE"], ["LOW_SAMPLE", "DATA_INSUFFICIENT"], ["COST_SENSITIVE", "COST_DOMINATED"],
  ["EXCESSIVE_DRAWDOWN", "EXCESSIVE_DRAWDOWN"], ["EXECUTION_MISMATCH", "EXECUTION_MISMATCH"],
]);

/** Exact status or reason codes. Sources: researchExperimentRunner.ts (skip reasons, holdoutNote), researchExperimentOrchestrator.ts (NOT_DUE, NO_CANDLES), researchWalkForwardWindows.ts (window refusals), researchQualificationIdentity.ts (policy codes). */
const EXACT = table([
  ["NOT_DUE", "NOT_APPLICABLE_NOT_A_FAILURE"], ["NO_CANDLES", "DATA_INSUFFICIENT"],
  ["DATASET_MANIFEST_ID_MISSING", "DATA_INSUFFICIENT"], ["DATASET_MANIFEST_VOLUME_MISSING", "DATA_INSUFFICIENT"],
  ["DATASET_MANIFEST_BINDING_MISMATCH", "STALE_EVIDENCE"], ["DATASET_MANIFEST_RANGE_MISMATCH", "STALE_EVIDENCE"], ["DATASET_MANIFEST_CONTENT_MISMATCH", "STALE_EVIDENCE"],
  ["HOLDOUT_ALREADY_USED", "DEPENDENCE_UNVERIFIED"], ["HOLDOUT_OVERLAPS_USED", "DEPENDENCE_UNVERIFIED"],
  ["VALIDATION_CHALLENGER_BETTER", "NOT_APPLICABLE_NOT_A_FAILURE"], ["HOLDOUT_CHALLENGER_BETTER", "NOT_APPLICABLE_NOT_A_FAILURE"],
  ["DEFLATED_SHARPE_BELOW_CONFIDENCE_THRESHOLD", "NO_EDGE"], ["REGIME_FRAGILE_EDGE", "REGIME_FRAGILE"],
  ["DEFLATED_SHARPE_EVIDENCE_MISSING", "DATA_INSUFFICIENT"], ["COST_SENSITIVITY_EVIDENCE_MISSING", "DATA_INSUFFICIENT"],
  ["PBO_EVIDENCE_MISSING", "DATA_INSUFFICIENT"], ["REGIME_ROBUSTNESS_EVIDENCE_MISSING", "DATA_INSUFFICIENT"],
  ["REGIME_ROBUSTNESS_EVIDENCE_INSUFFICIENT", "DATA_INSUFFICIENT"], ["TRIAL_LEDGER_EVIDENCE_MISSING", "DATA_INSUFFICIENT"],
]);

/** Window refusal reasons (runner emits WINDOWS_<reason>[_<WINDOW>]). */
const WINDOW_REASONS = table([
  ["INSUFFICIENT_HISTORY", "DATA_INSUFFICIENT"], ["TOO_MANY_GAPS", "DATA_INSUFFICIENT"], ["NO_CANDLES", "DATA_INSUFFICIENT"], ["INVALID_CANDLES", "DATA_INSUFFICIENT"],
  ["INVALID_CONFIG", "DESIGN_REJECTED"], ["INVALID_FOLD_COUNT", "DESIGN_REJECTED"],
]);

const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const own = (record: Record<string, unknown>, key: string): unknown => (Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined);

function classifyCode(raw: string): ResearchFailureCauseResult {
  const code = raw.split(":")[0] ?? "";
  const exact = EXACT.get(code);
  if (exact !== undefined) return result(exact, "STATUS_CODE");
  if (code.startsWith("FAIL_")) { const reason = FAILURE_REASONS.get(code.slice(5)); if (reason !== undefined) return result(reason, "STATUS_CODE"); }
  // SKIPPED_<reason> / ERROR_<reason> are the orchestrator's count keys; unwrap once.
  for (const prefix of ["SKIPPED_", "ERROR_"]) if (code.startsWith(prefix) && code.length > prefix.length) return classifyReasonOnly(code.slice(prefix.length));
  return classifyReasonOnly(code);
}

function classifyReasonOnly(code: string): ResearchFailureCauseResult {
  const exact = EXACT.get(code);
  if (exact !== undefined) return result(exact, "STATUS_CODE");
  if (code.startsWith("WINDOWS_")) {
    const rest = code.slice(8);
    for (const [name, cause] of WINDOW_REASONS) if (rest === name || rest.startsWith(`${name}_`)) return result(cause, "STATUS_CODE");
  }
  // REPEAT_<reason> is a derived per-strategy streak count, not an experiment result; PROVENANCE_*, EXPERIMENT_FAILED and everything else are not guessed.
  return UNCLASSIFIED;
}

const metricsOf = (side: unknown): Record<string, unknown> | null => {
  if (!isRecord(side)) return null;
  const nested = own(side, "metrics");
  return isRecord(nested) ? nested : side;
};

/** Mirrors the fixed priority of classifyResearchFailure (researchFailureMemory.ts) over a stored or in-memory comparison record. */
function classifyEvidence(evidence: Record<string, unknown>): ResearchFailureCauseResult {
  const outcome = own(evidence, "result");
  if (outcome === "CHALLENGER_BETTER") return result("NOT_APPLICABLE_NOT_A_FAILURE", "EVIDENCE_METRICS");
  if (outcome !== "CHAMPION_BETTER" && outcome !== "EQUIVALENT" && outcome !== "INCONCLUSIVE") return UNCLASSIFIED;
  const challenger = metricsOf(own(evidence, "challenger")), champion = metricsOf(own(evidence, "champion"));
  if (challenger == null || champion == null || finite(own(challenger, "netReturn")) == null) return result("DATA_INSUFFICIENT", "EVIDENCE_METRICS");
  const reason = own(evidence, "reason");
  if (typeof reason === "string" && reason !== "MULTI_METRIC_COMPARISON" && reason !== "NET_RETURN_COMPARISON") return result("DATA_INSUFFICIENT", "EVIDENCE_METRICS");
  const cost = own(evidence, "costEvidence");
  if (isRecord(cost)) { const gross = finite(own(cost, "grossReturn")), net = finite(own(cost, "netReturn")); if (gross != null && net != null && gross > 0 && net <= 0) return result("COST_DOMINATED", "EVIDENCE_METRICS"); }
  const drawdown = finite(own(challenger, "maximumDrawdown")), championDrawdown = finite(own(champion, "maximumDrawdown"));
  if (drawdown != null && championDrawdown != null && drawdown > championDrawdown) return result("EXCESSIVE_DRAWDOWN", "EVIDENCE_METRICS");
  const quality = finite(own(challenger, "executionQuality")), championQuality = finite(own(champion, "executionQuality"));
  if (quality != null && championQuality != null && quality < championQuality) return result("EXECUTION_MISMATCH", "EVIDENCE_METRICS");
  return result("NO_EDGE", "EVIDENCE_METRICS");
}

function classifyObject(input: Record<string, unknown>): ResearchFailureCauseResult {
  const status = own(input, "status");
  if (status === "SKIPPED" || status === "ERROR") { const reason = own(input, "reason"); return typeof reason === "string" ? classifyReasonOnly(reason.split(":")[0] ?? "") : UNCLASSIFIED; }
  if (status === "NOT_DUE" || status === "NO_CANDLES") return classifyCode(status);
  if (status === "COMPLETED") {
    const validation = own(input, "validation");
    if (!isRecord(validation)) return UNCLASSIFIED;
    const holdout = own(input, "holdout");
    if (isRecord(holdout)) return classifyEvidence(holdout);
    const note = own(input, "holdoutNote");
    if (note === "VALIDATION_NOT_FAVOURABLE") return classifyEvidence(validation);
    if (note === "HOLDOUT_ALREADY_USED" || note === "HOLDOUT_OVERLAPS_USED") return classifyCode(note);
    return UNCLASSIFIED;
  }
  if (typeof own(input, "result") === "string") return classifyEvidence(input);
  return UNCLASSIFIED;
}

/**
 * Accepts an ExperimentOutcome (runner), a comparison-evidence or stored result record, or one status / count-key string.
 * Always returns exactly one fixed class; never throws.
 */
export function classifyFailureCause(input: unknown): ResearchFailureCauseResult {
  try {
    if (typeof input === "string") return classifyCode(input);
    if (isRecord(input)) return classifyObject(input);
    return UNCLASSIFIED;
  } catch {
    return UNCLASSIFIED;
  }
}
