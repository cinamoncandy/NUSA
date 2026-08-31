export type EngineeringEvidenceValue = number | "UNKNOWN";

export type EngineeringOpportunityPriorityInput = {
  opportunityId: string;
  expectedProductValue: EngineeringEvidenceValue;
  riskReduction: EngineeringEvidenceValue;
  evidenceGain: EngineeringEvidenceValue;
  criticalPathUnlock: EngineeringEvidenceValue;
  effortCost: EngineeringEvidenceValue;
  dependencyFanOut: EngineeringEvidenceValue;
  uncertainty: EngineeringEvidenceValue;
};

export type EngineeringOpportunityPriorityDecision = {
  opportunityId: string;
  classification: "RANKABLE" | "INSUFFICIENT";
  score: number | null;
  components: Readonly<{
    expectedProductValue: EngineeringEvidenceValue;
    riskReduction: EngineeringEvidenceValue;
    evidenceGain: EngineeringEvidenceValue;
    criticalPathUnlock: EngineeringEvidenceValue;
    effortCost: EngineeringEvidenceValue;
    dependencyFanOut: EngineeringEvidenceValue;
    uncertainty: EngineeringEvidenceValue;
  }>;
  reasons: readonly string[];
};

const MIN_COMPONENT = 0;
const MAX_COMPONENT = 100;
const SAFE_OPPORTUNITY_ID = /^[A-Za-z0-9._:-]{1,256}$/;

function validateComponent(name: string, value: EngineeringEvidenceValue): void {
  if (value === "UNKNOWN") return;
  if (!Number.isFinite(value) || value < MIN_COMPONENT || value > MAX_COMPONENT) {
    throw new Error(`ENGINEERING_PRIORITY_INVALID_${name.toUpperCase()}`);
  }
}

export function scoreEngineeringOpportunity(
  input: EngineeringOpportunityPriorityInput,
): EngineeringOpportunityPriorityDecision {
  if (input == null || typeof input !== "object" || Array.isArray(input) || typeof input.opportunityId !== "string") {
    throw new Error("ENGINEERING_PRIORITY_MISSING_OPPORTUNITY_ID");
  }
  const opportunityId = input.opportunityId.trim();
  if (!SAFE_OPPORTUNITY_ID.test(opportunityId)) throw new Error("ENGINEERING_PRIORITY_OPPORTUNITY_ID_INVALID");

  const components = {
    expectedProductValue: input.expectedProductValue,
    riskReduction: input.riskReduction,
    evidenceGain: input.evidenceGain,
    criticalPathUnlock: input.criticalPathUnlock,
    effortCost: input.effortCost,
    dependencyFanOut: input.dependencyFanOut,
    uncertainty: input.uncertainty,
  } as const;

  for (const [name, value] of Object.entries(components)) validateComponent(name, value);

  const unknown = Object.entries(components)
    .filter(([, value]) => value === "UNKNOWN")
    .map(([name]) => name)
    .sort();

  if (unknown.length > 0) {
    return {
      opportunityId,
      classification: "INSUFFICIENT",
      score: null,
      components,
      reasons: unknown.map((name) => `UNKNOWN_${name.toUpperCase()}`),
    };
  }

  const known = components as Record<keyof typeof components, number>;
  const benefit =
    known.expectedProductValue * 0.3 +
    known.riskReduction * 0.2 +
    known.evidenceGain * 0.15 +
    known.criticalPathUnlock * 0.2 +
    known.dependencyFanOut * 0.05;
  const penalty = known.effortCost * 0.05 + known.uncertainty * 0.05;
  const score = Math.round((benefit - penalty) * 1000) / 1000;

  return {
    opportunityId,
    classification: "RANKABLE",
    score,
    components,
    reasons: ["DETERMINISTIC_EVIDENCE_SCORE"],
  };
}

export function rankEngineeringOpportunities(
  inputs: readonly EngineeringOpportunityPriorityInput[],
): EngineeringOpportunityPriorityDecision[] {
  if (!Array.isArray(inputs)) throw new Error("ENGINEERING_PRIORITY_INPUTS_INVALID");
  const opportunityIds = new Set<string>();
  for (const input of inputs) {
    if (input == null || typeof input !== "object" || Array.isArray(input) || typeof input.opportunityId !== "string") {
      throw new Error("ENGINEERING_PRIORITY_MISSING_OPPORTUNITY_ID");
    }
    const opportunityId = input.opportunityId.trim();
    if (!SAFE_OPPORTUNITY_ID.test(opportunityId)) throw new Error("ENGINEERING_PRIORITY_OPPORTUNITY_ID_INVALID");
    if (opportunityIds.has(opportunityId)) throw new Error(`ENGINEERING_PRIORITY_DUPLICATE_OPPORTUNITY_ID:${opportunityId}`);
    opportunityIds.add(opportunityId);
  }
  return inputs
    .map(scoreEngineeringOpportunity)
    .sort((left, right) => {
      if (left.classification !== right.classification) return left.classification === "RANKABLE" ? -1 : 1;
      if (left.score !== right.score) return (right.score ?? Number.NEGATIVE_INFINITY) - (left.score ?? Number.NEGATIVE_INFINITY);
      return left.opportunityId.localeCompare(right.opportunityId);
    });
}

export type EngineeringWorkLane = "FAST" | "DEEP";
export type EngineeringWorkEvidenceState = "VERIFIED" | "UNKNOWN" | "INSUFFICIENT";
export type EngineeringWorkDisposition =
  | "READY"
  | "WAITING_REAL_EVIDENCE"
  | "HUMAN_ONLY"
  | "EXTERNAL_ONLY"
  | "DUPLICATE"
  | "BLOCKED_DEPENDENCY";
export type EngineeringWorkParkingDisposition = Exclude<EngineeringWorkDisposition, "READY">;
export type EngineeringWorkPriority = "P0" | "P1" | "P2" | "P3";

export interface EngineeringWorkPackageInput {
  readonly packageId: string;
  readonly opportunityId: string;
  readonly priority: EngineeringWorkPriority;
  readonly incident: boolean;
  readonly lane: EngineeringWorkLane;
  readonly evidenceState: EngineeringWorkEvidenceState;
  readonly repositoryControlled: boolean;
  readonly dependencies: readonly string[];
  readonly touchedFiles: readonly string[];
  readonly evidenceRequirements: readonly string[];
  readonly estimatedEffort: EngineeringEvidenceValue;
  readonly risk: EngineeringEvidenceValue;
  readonly blastRadius: EngineeringEvidenceValue;
  readonly validationRequirements: readonly string[];
  readonly duplicateOf?: string | null;
  readonly waitingReason?: EngineeringWorkParkingDisposition | null;
}

export interface EngineeringWorkPortfolioContext {
  readonly mergedPackageIds?: readonly string[];
  readonly activeTouchedFiles?: readonly string[];
  readonly activeWorkerCount?: number | null;
  readonly activeClaimCount?: number | null;
}

export interface EngineeringWorkPackage {
  readonly packageId: string;
  readonly opportunityId: string;
  readonly priority: EngineeringWorkPriority;
  readonly incident: boolean;
  readonly lane: EngineeringWorkLane;
  readonly evidenceState: EngineeringWorkEvidenceState;
  readonly repositoryControlled: boolean;
  readonly dependencies: readonly string[];
  readonly touchedFiles: readonly string[];
  readonly evidenceRequirements: readonly string[];
  readonly estimatedEffort: EngineeringEvidenceValue;
  readonly risk: EngineeringEvidenceValue;
  readonly blastRadius: EngineeringEvidenceValue;
  readonly validationRequirements: readonly string[];
  readonly duplicateOf: string | null;
  readonly waitingReason: EngineeringWorkParkingDisposition | null;
  readonly disposition: EngineeringWorkDisposition;
  readonly reasons: readonly string[];
}

export interface EngineeringWorkDependencyEdge {
  readonly packageId: string;
  readonly dependencyId: string;
}

export interface EngineeringWorkConflictEdge {
  readonly packageId: string;
  /** null represents a conflict with an already active claim outside this portfolio. */
  readonly conflictingPackageId: string | null;
  readonly touchedFiles: readonly string[];
  readonly active: boolean;
}

export interface EngineeringWorkPortfolioMetrics {
  readonly candidateGapCount: number;
  readonly validatedGapCount: number;
  readonly readyBacklog: number;
  readonly readyToWorkerRatio: number | "UNKNOWN";
  readonly activeClaimCount: number | "UNKNOWN";
  readonly waitingRealEvidenceCount: number;
  readonly humanOnlyCount: number;
  readonly externalOnlyCount: number;
  readonly duplicateCount: number;
  readonly blockedDependencyCount: number;
  readonly conflictCount: number;
}

export interface EngineeringWorkPortfolio {
  readonly schemaVersion: 1;
  readonly packages: readonly EngineeringWorkPackage[];
  readonly ready: readonly EngineeringWorkPackage[];
  readonly parked: readonly EngineeringWorkPackage[];
  readonly dependencyEdges: readonly EngineeringWorkDependencyEdge[];
  readonly conflictEdges: readonly EngineeringWorkConflictEdge[];
  readonly metrics: EngineeringWorkPortfolioMetrics;
}

const SAFE_WORK_PACKAGE_ID = /^[A-Za-z0-9._:-]{1,256}$/;
const WORK_PRIORITIES: ReadonlySet<EngineeringWorkPriority> = new Set(["P0", "P1", "P2", "P3"]);
const WORK_LANES: ReadonlySet<EngineeringWorkLane> = new Set(["FAST", "DEEP"]);
const WORK_EVIDENCE_STATES: ReadonlySet<EngineeringWorkEvidenceState> = new Set(["VERIFIED", "UNKNOWN", "INSUFFICIENT"]);
const WORK_PARKING_DISPOSITIONS: ReadonlySet<EngineeringWorkParkingDisposition> = new Set([
  "WAITING_REAL_EVIDENCE",
  "HUMAN_ONLY",
  "EXTERNAL_ONLY",
  "DUPLICATE",
  "BLOCKED_DEPENDENCY",
]);
const WORK_PRIORITY_RANK: Readonly<Record<EngineeringWorkPriority, number>> = Object.freeze({ P0: 0, P1: 1, P2: 2, P3: 3 });

function freezeArray<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values]);
}

function normalizeWorkIdentifier(value: unknown, code: string): string {
  if (typeof value !== "string") throw new Error(code);
  const normalized = value.trim();
  if (!SAFE_WORK_PACKAGE_ID.test(normalized)) throw new Error(code);
  return normalized;
}

function normalizeWorkTextArray(value: unknown, code: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(code);
  const normalized = value.map((entry) => {
    if (typeof entry !== "string" || entry.trim() === "" || entry.length > 1024) throw new Error(code);
    return entry.trim();
  });
  if (new Set(normalized).size !== normalized.length) throw new Error(`${code}_DUPLICATE`);
  return freezeArray(normalized);
}

function normalizeTouchedFiles(value: unknown, packageId: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`ENGINEERING_WORK_TOUCHED_FILES_INVALID:${packageId}`);
  const normalized = value.map((entry) => {
    if (typeof entry !== "string") throw new Error(`ENGINEERING_WORK_TOUCHED_FILE_INVALID:${packageId}`);
    const path = entry.trim();
    const segments = path.split("/");
    const invalid = path.length === 0
      || path.startsWith("/")
      || path.endsWith("/")
      || path.includes("\\")
      || segments.some((segment) => segment.length === 0 || segment === "." || segment === "..");
    if (invalid || path.length > 1024) throw new Error(`ENGINEERING_WORK_TOUCHED_FILE_INVALID:${packageId}`);
    return path;
  });
  if (new Set(normalized).size !== normalized.length) throw new Error(`ENGINEERING_WORK_TOUCHED_FILES_DUPLICATE:${packageId}`);
  return freezeArray(normalized);
}

function normalizeWorkEvidence(name: string, value: unknown): EngineeringEvidenceValue {
  if (value === "UNKNOWN") return value;
  if (typeof value !== "number" || !Number.isFinite(value) || value < MIN_COMPONENT || value > MAX_COMPONENT) {
    throw new Error(`ENGINEERING_WORK_INVALID_${name.toUpperCase()}`);
  }
  return value;
}

function normalizeWorkPackage(input: EngineeringWorkPackageInput): Omit<EngineeringWorkPackage, "disposition" | "reasons"> {
  if (input == null || typeof input !== "object" || Array.isArray(input)) throw new Error("ENGINEERING_WORK_PACKAGE_INVALID");
  const packageId = normalizeWorkIdentifier(input.packageId, "ENGINEERING_WORK_PACKAGE_ID_INVALID");
  const opportunityId = normalizeWorkIdentifier(input.opportunityId, "ENGINEERING_WORK_OPPORTUNITY_ID_INVALID");
  if (!WORK_PRIORITIES.has(input.priority)) throw new Error(`ENGINEERING_WORK_PRIORITY_INVALID:${packageId}`);
  if (typeof input.incident !== "boolean") throw new Error(`ENGINEERING_WORK_INCIDENT_INVALID:${packageId}`);
  if (!WORK_LANES.has(input.lane)) throw new Error(`ENGINEERING_WORK_LANE_INVALID:${packageId}`);
  if (!WORK_EVIDENCE_STATES.has(input.evidenceState)) throw new Error(`ENGINEERING_WORK_EVIDENCE_STATE_INVALID:${packageId}`);
  if (typeof input.repositoryControlled !== "boolean") throw new Error(`ENGINEERING_WORK_REPOSITORY_CONTROL_INVALID:${packageId}`);

  const dependencies = input.dependencies == null
    ? (() => { throw new Error(`ENGINEERING_WORK_DEPENDENCIES_INVALID:${packageId}`); })()
    : input.dependencies.map((dependency) => normalizeWorkIdentifier(dependency, `ENGINEERING_WORK_DEPENDENCY_INVALID:${packageId}`));
  if (new Set(dependencies).size !== dependencies.length) throw new Error(`ENGINEERING_WORK_DEPENDENCIES_DUPLICATE:${packageId}`);
  if (dependencies.includes(packageId)) throw new Error(`ENGINEERING_WORK_DEPENDENCY_SELF:${packageId}`);

  const duplicateOf = input.duplicateOf == null ? null : normalizeWorkIdentifier(input.duplicateOf, `ENGINEERING_WORK_DUPLICATE_OF_INVALID:${packageId}`);
  if (duplicateOf === packageId) throw new Error(`ENGINEERING_WORK_DUPLICATE_OF_SELF:${packageId}`);
  const waitingReason = input.waitingReason == null ? null : input.waitingReason;
  if (waitingReason !== null && !WORK_PARKING_DISPOSITIONS.has(waitingReason)) throw new Error(`ENGINEERING_WORK_WAITING_REASON_INVALID:${packageId}`);

  return {
    packageId,
    opportunityId,
    priority: input.priority,
    incident: input.incident,
    lane: input.lane,
    evidenceState: input.evidenceState,
    repositoryControlled: input.repositoryControlled,
    dependencies: freezeArray(dependencies),
    touchedFiles: normalizeTouchedFiles(input.touchedFiles, packageId),
    evidenceRequirements: normalizeWorkTextArray(input.evidenceRequirements, `ENGINEERING_WORK_EVIDENCE_REQUIREMENTS_INVALID:${packageId}`),
    estimatedEffort: normalizeWorkEvidence("EFFORT", input.estimatedEffort),
    risk: normalizeWorkEvidence("RISK", input.risk),
    blastRadius: normalizeWorkEvidence("BLAST_RADIUS", input.blastRadius),
    validationRequirements: normalizeWorkTextArray(input.validationRequirements, `ENGINEERING_WORK_VALIDATION_REQUIREMENTS_INVALID:${packageId}`),
    duplicateOf,
    waitingReason,
  };
}

function assertWorkPackageDag(packages: readonly Omit<EngineeringWorkPackage, "disposition" | "reasons">[]): void {
  const byId = new Map(packages.map((item) => [item.packageId, item] as const));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (packageId: string): void => {
    if (visited.has(packageId)) return;
    if (visiting.has(packageId)) throw new Error(`ENGINEERING_WORK_DEPENDENCY_CYCLE:${packageId}`);
    visiting.add(packageId);
    for (const dependency of byId.get(packageId)?.dependencies ?? []) {
      if (byId.has(dependency)) visit(dependency);
    }
    visiting.delete(packageId);
    visited.add(packageId);
  };
  for (const item of packages) visit(item.packageId);
}

function compareWorkPackages(left: EngineeringWorkPackage, right: EngineeringWorkPackage): number {
  return Number(right.incident) - Number(left.incident)
    || WORK_PRIORITY_RANK[left.priority] - WORK_PRIORITY_RANK[right.priority]
    || (left.lane === right.lane ? 0 : left.lane === "FAST" ? -1 : 1)
    || left.packageId.localeCompare(right.packageId);
}

function overlap(left: readonly string[], right: ReadonlySet<string>): readonly string[] {
  return freezeArray(left.filter((path) => right.has(path)).sort());
}

function validatePortfolioContext(context: EngineeringWorkPortfolioContext): {
  readonly mergedPackageIds: ReadonlySet<string>;
  readonly activeTouchedFiles: ReadonlySet<string>;
  readonly activeWorkerCount: number | null;
  readonly activeClaimCount: number | null;
} {
  if (context == null || typeof context !== "object" || Array.isArray(context)) throw new Error("ENGINEERING_WORK_PORTFOLIO_CONTEXT_INVALID");
  const merged = context.mergedPackageIds ?? [];
  const activeTouchedFiles = context.activeTouchedFiles ?? [];
  if (!Array.isArray(merged) || !Array.isArray(activeTouchedFiles)) throw new Error("ENGINEERING_WORK_PORTFOLIO_CONTEXT_INVALID");
  const mergedPackageIds = merged.map((value) => normalizeWorkIdentifier(value, "ENGINEERING_WORK_MERGED_PACKAGE_ID_INVALID"));
  if (new Set(mergedPackageIds).size !== mergedPackageIds.length) throw new Error("ENGINEERING_WORK_MERGED_PACKAGE_ID_DUPLICATE");
  const canonicalActiveFiles = normalizeTouchedFiles(activeTouchedFiles, "active");
  const activeWorkerCount = context.activeWorkerCount ?? null;
  const activeClaimCount = context.activeClaimCount ?? null;
  for (const [name, value] of [["WORKER", activeWorkerCount], ["CLAIM", activeClaimCount]] as const) {
    if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw new Error(`ENGINEERING_WORK_ACTIVE_${name}_COUNT_INVALID`);
  }
  return {
    mergedPackageIds: new Set(mergedPackageIds),
    activeTouchedFiles: new Set(canonicalActiveFiles),
    activeWorkerCount,
    activeClaimCount,
  };
}

/**
 * Converts discovered work into a deterministic, evidence-bound portfolio.
 * This is a read-only planner: parked work is retained for auditability, READY
 * work is never discarded for conflicts, and claiming remains the responsibility
 * of the canonical #903 control-plane function.
 */
export function buildEngineeringWorkPortfolio(
  inputs: readonly EngineeringWorkPackageInput[],
  context: EngineeringWorkPortfolioContext = {},
): EngineeringWorkPortfolio {
  if (!Array.isArray(inputs)) throw new Error("ENGINEERING_WORK_PORTFOLIO_INPUTS_INVALID");
  const normalized = inputs.map(normalizeWorkPackage);
  const packageIds = new Set<string>();
  const opportunityOwners = new Map<string, EngineeringWorkPackageInput["packageId"]>();
  for (const item of normalized) {
    if (packageIds.has(item.packageId)) throw new Error(`ENGINEERING_WORK_PACKAGE_ID_DUPLICATE:${item.packageId}`);
    const priorPackageId = opportunityOwners.get(item.opportunityId);
    if (priorPackageId !== undefined && item.duplicateOf !== priorPackageId) {
      throw new Error(`ENGINEERING_WORK_OPPORTUNITY_ID_DUPLICATE:${item.opportunityId}`);
    }
    packageIds.add(item.packageId);
    opportunityOwners.set(item.opportunityId, item.packageId);
  }
  assertWorkPackageDag(normalized);
  const portfolioContext = validatePortfolioContext(context);

  const packages = normalized.map((item): EngineeringWorkPackage => {
    if (item.duplicateOf !== null) {
      return Object.freeze({ ...item, disposition: "DUPLICATE", reasons: freezeArray([`DUPLICATE_OF:${item.duplicateOf}`]) });
    }
    if (item.waitingReason !== null) {
      return Object.freeze({ ...item, disposition: item.waitingReason, reasons: freezeArray([`EXPLICIT_${item.waitingReason}`]) });
    }
    if (!item.repositoryControlled) {
      return Object.freeze({ ...item, disposition: "EXTERNAL_ONLY", reasons: freezeArray(["REPOSITORY_SCOPE_NOT_CONTROLLED"]) });
    }
    if (item.evidenceState !== "VERIFIED") {
      return Object.freeze({ ...item, disposition: "WAITING_REAL_EVIDENCE", reasons: freezeArray([`EVIDENCE_${item.evidenceState}`]) });
    }
    const unknownMetadata = [
      ["EFFORT", item.estimatedEffort],
      ["RISK", item.risk],
      ["BLAST_RADIUS", item.blastRadius],
    ].filter(([, value]) => value === "UNKNOWN").map(([name]) => name);
    if (unknownMetadata.length > 0) {
      return Object.freeze({
        ...item,
        disposition: "WAITING_REAL_EVIDENCE",
        reasons: freezeArray(unknownMetadata.map((name) => `UNKNOWN_WORK_METADATA:${name}`)),
      });
    }
    const unsatisfied = item.dependencies.filter((dependency) => !portfolioContext.mergedPackageIds.has(dependency));
    if (unsatisfied.length > 0) {
      return Object.freeze({
        ...item,
        disposition: "BLOCKED_DEPENDENCY",
        reasons: freezeArray(unsatisfied.sort().map((dependency) => `DEPENDENCY_NOT_MERGED:${dependency}`)),
      });
    }
    return Object.freeze({
      ...item,
      disposition: "READY",
      reasons: freezeArray(["EVIDENCE_VERIFIED", "REPOSITORY_CONTROLLED", "DEPENDENCIES_SATISFIED"]),
    });
  });

  const ready = packages.filter((item) => item.disposition === "READY").sort(compareWorkPackages);
  const parked = packages.filter((item) => item.disposition !== "READY").sort((left, right) => left.disposition.localeCompare(right.disposition) || left.packageId.localeCompare(right.packageId));
  const dependencyEdges = freezeArray(normalized.flatMap((item) => item.dependencies.map((dependencyId) => ({ packageId: item.packageId, dependencyId })))
    .sort((left, right) => left.packageId.localeCompare(right.packageId) || left.dependencyId.localeCompare(right.dependencyId)));
  const conflictEdges: EngineeringWorkConflictEdge[] = [];
  for (let leftIndex = 0; leftIndex < ready.length; leftIndex += 1) {
    const left = ready[leftIndex]!;
    const leftFiles = new Set(left.touchedFiles);
    const activeOverlap = overlap(left.touchedFiles, portfolioContext.activeTouchedFiles);
    if (activeOverlap.length > 0) {
      conflictEdges.push(Object.freeze({ packageId: left.packageId, conflictingPackageId: null, touchedFiles: activeOverlap, active: true }));
    }
    for (let rightIndex = leftIndex + 1; rightIndex < ready.length; rightIndex += 1) {
      const right = ready[rightIndex]!;
      const shared = overlap(right.touchedFiles, leftFiles);
      if (shared.length > 0) {
        conflictEdges.push(Object.freeze({ packageId: left.packageId, conflictingPackageId: right.packageId, touchedFiles: shared, active: false }));
      }
    }
  }

  const candidateGapCount = packages.filter((item) => item.disposition !== "DUPLICATE").length;
  const validatedGapCount = packages.filter((item) => item.evidenceState === "VERIFIED" && item.disposition !== "DUPLICATE").length;
  const readyBacklog = ready.length;
  const activeWorkerCount = portfolioContext.activeWorkerCount;
  const readyToWorkerRatio = activeWorkerCount === null || activeWorkerCount === 0
    ? "UNKNOWN"
    : Math.round((readyBacklog / activeWorkerCount) * 1000) / 1000;
  const metrics: EngineeringWorkPortfolioMetrics = Object.freeze({
    candidateGapCount,
    validatedGapCount,
    readyBacklog,
    readyToWorkerRatio,
    activeClaimCount: portfolioContext.activeClaimCount ?? "UNKNOWN",
    waitingRealEvidenceCount: packages.filter((item) => item.disposition === "WAITING_REAL_EVIDENCE").length,
    humanOnlyCount: packages.filter((item) => item.disposition === "HUMAN_ONLY").length,
    externalOnlyCount: packages.filter((item) => item.disposition === "EXTERNAL_ONLY").length,
    duplicateCount: packages.filter((item) => item.disposition === "DUPLICATE").length,
    blockedDependencyCount: packages.filter((item) => item.disposition === "BLOCKED_DEPENDENCY").length,
    conflictCount: conflictEdges.length,
  });

  return Object.freeze({
    schemaVersion: 1,
    packages: freezeArray(packages.sort((left, right) => left.packageId.localeCompare(right.packageId))),
    ready: freezeArray(ready),
    parked: freezeArray(parked),
    dependencyEdges,
    conflictEdges: freezeArray(conflictEdges),
    metrics,
  });
}
