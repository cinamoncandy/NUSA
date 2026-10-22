import { createHash } from "node:crypto";
import { canonicalResearchJson } from "../../../packages/contracts/src/researchRuntime";
import { assertLearningInputSet, learningCycleId, learningInputSetFingerprint, type LearningInputSet } from "./learningInputSet";

/**
 * A1 - the Learning Decision.
 *
 * A decision consumes the fixed identity of a Learning Input Set (A2), never an arbitrary query
 * result, and it is a **receipt rather than an authority**. The only shape this module can produce is
 *
 *     Learning Decision -> validation -> bounded application
 *
 * The forbidden shape, which this module is deliberately incapable of expressing, is
 *
 *     Learning Decision -> direct arbitrary config mutation
 *
 * There is no function here that mutates configuration, no setter, and no apply path. Decisions are
 * built by pure derivation and returned frozen. Application is A4's job and produces a separate
 * durable receipt; this decision cannot claim that an application occurred (v2 sections 21-24).
 *
 * The mutable surface is an owner allowlist, not something learning may extend. Today it holds exactly
 * one field: `longBarTickEvery` in [1, 4]. A proposal naming any other field is refused, so learning
 * cannot invent a mutable field out of a successful trial. A proposal naming an immutable surface is
 * refused as well, and that refusal is unconditional: it does not become admissible because the
 * evidence behind the decision was negative, or because the change is small, or because it is late in
 * the programme.
 *
 * Nothing here claims performance. `decisionOutcome` reports only what validation concluded about a
 * proposal. PERFORMANCE_IMPROVEMENT stays UNPROVEN until a cost-complete realized PAPER comparison
 * says otherwise, and no decision can move that flag.
 */

export const LEARNING_DECISION_SCHEMA_VERSION = 1;
export const MAX_LEARNING_DECISION_CHANGES = 32;
export const MAX_LEARNING_DECISION_REASON_EVIDENCE = 64;
export const MAX_LEARNING_DECISION_RECEIPT_BYTES = 16_384;
export const ALLOWED_SURFACE_VERSION = "learning-allowed-surface-v1";
export const IMMUTABLE_SURFACE_VERSION = "learning-immutable-surface-v1";
export class LearningDecisionError extends Error {
  public constructor(readonly code: string, message: string) {
    super(message);
    this.name = "LearningDecisionError";
  }
}

/** One owner-defined mutable field. Learning may only propose inside these bounds. */
export interface MutableSurfaceDefinition {
  readonly surface: string;
  readonly minimum: number;
  readonly maximum: number;
  /** Largest step one cycle may take, independent of the absolute bounds. */
  readonly maximumDeltaPerCycle: number;
}

/**
 * The complete mutable aperture as of this version.
 *
 * This is an owner decision recorded in code, not a learning output. Extending it requires an owner
 * change that also updates ALLOWED_SURFACE_VERSION and the falsification tests; learning has no path
 * to add a row here at runtime.
 */
export const MUTABLE_SURFACE_ALLOWLIST: readonly MutableSurfaceDefinition[] = Object.freeze([
  Object.freeze({ surface: "longBarTickEvery", minimum: 1, maximum: 4, maximumDeltaPerCycle: 1 }),
]);

/**
 * Surfaces no decision may ever move, by exact name or by prefix.
 *
 * These are the PAPER-only guarantees, the Risk limits, the qualification and sampling rules, the
 * out-of-sample and walk-forward integrity rules, cost completeness, leakage rules, and the
 * Governance and Release authorities. A proposal naming one of them is recorded REJECTED rather than
 * silently dropped, so the attempt itself becomes durable evidence (v2 section 29).
 */
const IMMUTABLE_EXACT: readonly string[] = Object.freeze([
  "PAPER_ONLY",
  "liveAuthority",
  "productionMutationAllowed",
  "aiAuthority",
  "aiDecisionAuthority",
  "minimumSample",
  "minimumSampleSize",
  "oosWindow",
  "oosRatio",
  "walkForward",
  "purge",
  "embargo",
  "costGate",
  "costCompleteness",
  "leakageRules",
  "governance",
  "releaseAuthority",
  "brokerAuthority",
  "orderAuthority",
  "withdrawalAuthority",
]);
const IMMUTABLE_PREFIXES: readonly string[] = Object.freeze(["risk", "qualification", "governance", "release", "live", "broker", "order"]);

/** A proposal naming a surface that is neither allowlisted nor immutable is still refused. */
function isImmutableSurface(surface: string): boolean {
  if (IMMUTABLE_EXACT.includes(surface)) return true;
  const lower = surface.toLowerCase();
  return IMMUTABLE_PREFIXES.some((prefix) => lower.startsWith(prefix.toLowerCase()));
}

function allowlistedSurface(surface: string): MutableSurfaceDefinition | undefined {
  return MUTABLE_SURFACE_ALLOWLIST.find((definition) => definition.surface === surface);
}

export type LearningChangeVerdict = "ADMISSIBLE" | "REJECTED";

/** The §27 aperture fields, carried per change so a later application is bounded and auditable. */
export interface LearningChangeAssessment {
  readonly surface: string;
  /** A1 premise only; A4 must re-read the owner spec and reject any mismatch before application. */
  readonly currentValue: number;
  readonly proposedValue: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly maximumDeltaPerCycle?: number;
  readonly verdict: LearningChangeVerdict;
  readonly reason: string;
}

export interface LearningChangeRequest {
  readonly surface: string;
  /** Untrusted caller premise, never sufficient authority for an application. */
  readonly currentValue: number;
  readonly proposedValue: number;
}

export type LearningDecisionOutcome = "ADMISSIBLE" | "REJECTED" | "INSUFFICIENT";

export interface LearningDecision {
  readonly schemaVersion: typeof LEARNING_DECISION_SCHEMA_VERSION;
  readonly learningCycleId: string;
  readonly learningInputSetFingerprint: string;
  readonly previousResearchSpecFingerprint: string;
  readonly learningPolicyVersion: string;
  readonly objectiveVersion: string;
  readonly proposedChanges: readonly LearningChangeAssessment[];
  readonly admissibleChanges: readonly LearningChangeAssessment[];
  readonly rejectedChanges: readonly LearningChangeAssessment[];
  readonly reasonEvidence: readonly string[];
  /** Largest absolute step among admissible changes; zero when nothing is admissible. */
  readonly changeMagnitude: number;
  readonly allowedSurfaceVersion: string;
  readonly immutableSurfaceVersion: string;
  readonly decisionOutcome: LearningDecisionOutcome;
  readonly createdAt: string;
  readonly sourceCommit: string;
  readonly runtimeIdentity: string;
}

export interface LearningDecisionInput {
  readonly inputSet: LearningInputSet;
  readonly previousResearchSpecFingerprint: string;
  readonly objectiveVersion: string;
  readonly proposedChanges: readonly LearningChangeRequest[];
  readonly reasonEvidence: readonly string[];
  readonly createdAt: string;
  readonly sourceCommit: string;
  readonly runtimeIdentity: string;
}

/** Owner-read snapshot supplied by the future bounded A4 apply gate, never by an AI proposal. */
export interface LearningDecisionCurrentResearchSpec {
  readonly fingerprint: string;
  readonly values: Readonly<Record<string, number>>;
}

const SHA64 = /^[a-f0-9]{64}$/;
const BOUNDED = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;

function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new LearningDecisionError("NON_FINITE_VALUE", "learning decision contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (typeof value === "object") {
    return (
      "{" +
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => compareCanonicalStrings(left, right))
        .map(([key, entry]) => JSON.stringify(key) + ":" + canonical(entry))
        .join(",") +
      "}"
    );
  }
  throw new LearningDecisionError("NON_CANONICAL_VALUE", "learning decision contains a value that has no canonical form");
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function assertBoundedString(value: unknown, field: string): string {
  if (typeof value !== "string" || !BOUNDED.test(value) || hasControlCharacter(value)) {
    throw new LearningDecisionError("MALFORMED_DECISION_INPUT", field + " must be a bounded identifier");
  }
  return value;
}

/**
 * Classifies one proposal against the owner allowlist and the immutable surface.
 *
 * Order matters: the immutable surface is tested first and unconditionally, so no amount of
 * allowlist overlap, evidence weight, or change size can make an immutable field movable.
 */
export function assessChange(request: LearningChangeRequest): LearningChangeAssessment {
  if (request == null || typeof request !== "object") throw new LearningDecisionError("MALFORMED_CHANGE", "proposed change is required");
  const surface = assertBoundedString(request.surface, "change surface");
  if (!Number.isFinite(request.currentValue) || !Number.isFinite(request.proposedValue)) {
    throw new LearningDecisionError("MALFORMED_CHANGE", "change values must be finite numbers");
  }

  if (isImmutableSurface(surface)) {
    return Object.freeze({
      surface,
      currentValue: request.currentValue,
      proposedValue: request.proposedValue,
      verdict: "REJECTED" as const,
      reason: "immutable surface: no learning decision may move it, whatever the evidence",
    });
  }

  const definition = allowlistedSurface(surface);
  if (definition == null) {
    return Object.freeze({
      surface,
      currentValue: request.currentValue,
      proposedValue: request.proposedValue,
      verdict: "REJECTED" as const,
      reason: "surface is not on the owner allowlist: learning may not invent a mutable field",
    });
  }

  const bounds = Object.freeze({
    minimum: definition.minimum,
    maximum: definition.maximum,
    maximumDeltaPerCycle: definition.maximumDeltaPerCycle,
  });

  if (!Number.isSafeInteger(request.currentValue) || !Number.isSafeInteger(request.proposedValue)) {
    return Object.freeze({ surface, currentValue: request.currentValue, proposedValue: request.proposedValue, ...bounds, verdict: "REJECTED" as const, reason: "cadence values must be safe integers" });
  }

  if (request.currentValue < definition.minimum || request.currentValue > definition.maximum) {
    return Object.freeze({ surface, currentValue: request.currentValue, proposedValue: request.proposedValue, ...bounds, verdict: "REJECTED" as const, reason: "current value is outside the owner bounds" });
  }

  if (request.proposedValue < definition.minimum || request.proposedValue > definition.maximum) {
    return Object.freeze({ surface, currentValue: request.currentValue, proposedValue: request.proposedValue, ...bounds, verdict: "REJECTED" as const, reason: "proposed value is outside the owner bounds" });
  }
  if (Math.abs(request.proposedValue - request.currentValue) > definition.maximumDeltaPerCycle) {
    return Object.freeze({ surface, currentValue: request.currentValue, proposedValue: request.proposedValue, ...bounds, verdict: "REJECTED" as const, reason: "step exceeds the maximum delta allowed in one cycle" });
  }
  if (request.proposedValue === request.currentValue) {
    return Object.freeze({ surface, currentValue: request.currentValue, proposedValue: request.proposedValue, ...bounds, verdict: "REJECTED" as const, reason: "proposal does not change the current value" });
  }

  return Object.freeze({ surface, currentValue: request.currentValue, proposedValue: request.proposedValue, ...bounds, verdict: "ADMISSIBLE" as const, reason: "within the owner-defined aperture for one cycle" });
}

/**
 * Builds a Learning Decision by pure derivation.
 *
 * The outcome is a statement about validation, not about performance and not about what was done:
 * - `INSUFFICIENT` - there is no proposal to assess.
 * - `REJECTED`     - at least one proposal was made and every one of them was refused.
 * - `ADMISSIBLE`   - at least one change passes the local aperture; META eligibility is separate.
 *
 * `ADMISSIBLE` therefore means "may be considered by the bounded application gate", never "already in effect". The applied
 * values arrive separately from A4, and an execution failure is recorded in A4's own receipt rather
 * than rewriting this decision (v2 section 23).
 */
export function buildLearningDecision(input: LearningDecisionInput): LearningDecision {
  if (input == null || typeof input !== "object") throw new LearningDecisionError("MALFORMED_DECISION_INPUT", "learning decision input is required");
  assertLearningInputSet(input.inputSet);
  if (!SHA64.test(input.previousResearchSpecFingerprint ?? "")) throw new LearningDecisionError("MALFORMED_DECISION_INPUT", "previous research spec fingerprint must be a SHA-256 digest");
  assertBoundedString(input.objectiveVersion, "objective version");
  assertBoundedString(input.createdAt, "created at");
  assertBoundedString(input.sourceCommit, "source commit");
  assertBoundedString(input.runtimeIdentity, "runtime identity");
  if (!Array.isArray(input.proposedChanges)) throw new LearningDecisionError("MALFORMED_DECISION_INPUT", "proposed changes must be a list");
  if (!Array.isArray(input.reasonEvidence)) throw new LearningDecisionError("MALFORMED_DECISION_INPUT", "reason evidence must be a list");
  if (input.proposedChanges.length > MAX_LEARNING_DECISION_CHANGES) throw new LearningDecisionError("DECISION_TOO_LARGE", "proposed changes exceed the bounded receipt limit");
  if (input.reasonEvidence.length > MAX_LEARNING_DECISION_REASON_EVIDENCE) throw new LearningDecisionError("DECISION_TOO_LARGE", "reason evidence exceeds the bounded receipt limit");
  const evidenceIds = new Set([...input.inputSet.researchEvidenceRecordIds, ...input.inputSet.paperEvidenceRecordIds]);
  const seenEvidence = new Set<string>();
  for (const reference of input.reasonEvidence) {
    assertBoundedString(reference, "reason evidence reference");
    if (!evidenceIds.has(reference)) throw new LearningDecisionError("UNBOUND_REASON_EVIDENCE", "reason evidence must cite the durable A2 input set");
    if (seenEvidence.has(reference)) throw new LearningDecisionError("DUPLICATE_REASON_EVIDENCE", "reason evidence may not repeat an identity");
    seenEvidence.add(reference);
  }
  const seenSurfaces = new Set<string>();
  for (const change of input.proposedChanges) {
    if (seenSurfaces.has(change?.surface)) throw new LearningDecisionError("DUPLICATE_CHANGE_SURFACE", "a decision may contain only one proposal per surface");
    seenSurfaces.add(change?.surface);
  }
  const proposedChanges = Object.freeze([...input.proposedChanges].sort((left, right) =>
    compareCanonicalStrings(left.surface, right.surface) || left.currentValue - right.currentValue || left.proposedValue - right.proposedValue,
  ).map(assessChange));
  const admissibleChanges = Object.freeze(proposedChanges.filter((change) => change.verdict === "ADMISSIBLE"));
  const rejectedChanges = Object.freeze(proposedChanges.filter((change) => change.verdict === "REJECTED"));
  const changeMagnitude = admissibleChanges.reduce((largest, change) => Math.max(largest, Math.abs(change.proposedValue - change.currentValue)), 0);

  const decisionOutcome: LearningDecisionOutcome =
    admissibleChanges.length > 0 ? "ADMISSIBLE" : proposedChanges.length > 0 ? "REJECTED" : "INSUFFICIENT";

  const decision = Object.freeze({
    schemaVersion: LEARNING_DECISION_SCHEMA_VERSION,
    learningCycleId: learningCycleId(input.inputSet),
    learningInputSetFingerprint: learningInputSetFingerprint(input.inputSet),
    previousResearchSpecFingerprint: input.previousResearchSpecFingerprint,
    learningPolicyVersion: input.inputSet.learningPolicyVersion,
    objectiveVersion: input.objectiveVersion,
    proposedChanges,
    admissibleChanges,
    rejectedChanges,
    reasonEvidence: Object.freeze([...input.reasonEvidence].sort(compareCanonicalStrings)),
    changeMagnitude,
    allowedSurfaceVersion: ALLOWED_SURFACE_VERSION,
    immutableSurfaceVersion: IMMUTABLE_SURFACE_VERSION,
    decisionOutcome,
    createdAt: input.createdAt,
    sourceCommit: input.sourceCommit,
    runtimeIdentity: input.runtimeIdentity,
  });
  if (Buffer.byteLength(canonicalResearchJson(decision), "utf8") > MAX_LEARNING_DECISION_RECEIPT_BYTES) {
    throw new LearningDecisionError("DECISION_TOO_LARGE", "learning decision exceeds the existing durable receipt size limit");
  }
  return decision;
}

/** The deterministic identity of a decision. Same decision content yields the same fingerprint. */
export function learningDecisionFingerprint(decision: LearningDecision): string {
  return digest(decision);
}

/** Stable retry identity excludes attempt metadata but includes every decision premise and result. */
export function learningDecisionContentFingerprint(decision: LearningDecision): string {
  return digest({
    schemaVersion: decision.schemaVersion,
    learningCycleId: decision.learningCycleId,
    learningInputSetFingerprint: decision.learningInputSetFingerprint,
    previousResearchSpecFingerprint: decision.previousResearchSpecFingerprint,
    learningPolicyVersion: decision.learningPolicyVersion,
    objectiveVersion: decision.objectiveVersion,
    proposedChanges: decision.proposedChanges,
    admissibleChanges: decision.admissibleChanges,
    rejectedChanges: decision.rejectedChanges,
    reasonEvidence: decision.reasonEvidence,
    changeMagnitude: decision.changeMagnitude,
    allowedSurfaceVersion: decision.allowedSurfaceVersion,
    immutableSurfaceVersion: decision.immutableSurfaceVersion,
    decisionOutcome: decision.decisionOutcome,
  });
}

/**
 * Fails closed on anything that is not exactly a Learning Decision.
 *
 * Frozen-ness is deliberately *not* checked here. It is a construction guarantee, enforced by
 * `buildLearningDecision` returning frozen objects. A receipt read back from
 * durable storage is a fresh object by construction, so requiring it to be frozen would make every
 * replay fail and the ledger unreadable.
 */
export function assertLearningDecision(value: unknown): asserts value is LearningDecision {
  if (value == null || typeof value !== "object") throw new LearningDecisionError("MALFORMED_DECISION", "learning decision is required");
  const candidate = value as Partial<LearningDecision>;
  if (candidate.schemaVersion !== LEARNING_DECISION_SCHEMA_VERSION) throw new LearningDecisionError("MALFORMED_DECISION", "learning decision schema version is unsupported");
  const fields = ["schemaVersion", "learningCycleId", "learningInputSetFingerprint", "previousResearchSpecFingerprint", "learningPolicyVersion", "objectiveVersion", "proposedChanges", "admissibleChanges", "rejectedChanges", "reasonEvidence", "changeMagnitude", "allowedSurfaceVersion", "immutableSurfaceVersion", "decisionOutcome", "createdAt", "sourceCommit", "runtimeIdentity"];
  if (Object.keys(candidate).sort().join("\n") !== fields.sort().join("\n")) throw new LearningDecisionError("MALFORMED_DECISION", "learning decision contains missing or unsupported fields");
  if (!SHA64.test(candidate.learningInputSetFingerprint ?? "")) throw new LearningDecisionError("MALFORMED_DECISION", "learning decision input fingerprint is invalid");
  if (candidate.learningCycleId !== "learning-cycle:" + candidate.learningInputSetFingerprint) throw new LearningDecisionError("MALFORMED_DECISION", "learning cycle identity does not match its input set");
  if (!SHA64.test(candidate.previousResearchSpecFingerprint ?? "")) throw new LearningDecisionError("MALFORMED_DECISION", "previous research spec fingerprint is invalid");
  if (candidate.allowedSurfaceVersion !== ALLOWED_SURFACE_VERSION) throw new LearningDecisionError("MALFORMED_DECISION", "learning decision allowed-surface version is unsupported");
  if (candidate.immutableSurfaceVersion !== IMMUTABLE_SURFACE_VERSION) throw new LearningDecisionError("MALFORMED_DECISION", "learning decision immutable-surface version is unsupported");
  if (!["ADMISSIBLE", "REJECTED", "INSUFFICIENT"].includes(candidate.decisionOutcome ?? "")) throw new LearningDecisionError("MALFORMED_DECISION", "learning decision outcome is outside the closed set");
  for (const field of ["proposedChanges", "admissibleChanges", "rejectedChanges", "reasonEvidence"] as const) {
    if (!Array.isArray(candidate[field])) throw new LearningDecisionError("MALFORMED_DECISION", field + " must be a list");
  }
  if (candidate.proposedChanges!.length > MAX_LEARNING_DECISION_CHANGES || candidate.reasonEvidence!.length > MAX_LEARNING_DECISION_REASON_EVIDENCE) {
    throw new LearningDecisionError("MALFORMED_DECISION", "learning decision exceeds the bounded receipt limits");
  }
  if (Buffer.byteLength(canonicalResearchJson(candidate), "utf8") > MAX_LEARNING_DECISION_RECEIPT_BYTES) {
    throw new LearningDecisionError("MALFORMED_DECISION", "learning decision exceeds the existing durable receipt size limit");
  }
  for (const [field, item] of [["learningPolicyVersion", candidate.learningPolicyVersion], ["objectiveVersion", candidate.objectiveVersion], ["createdAt", candidate.createdAt], ["sourceCommit", candidate.sourceCommit], ["runtimeIdentity", candidate.runtimeIdentity]] as const) assertBoundedString(item, field);
  for (const reference of candidate.reasonEvidence!) assertBoundedString(reference, "reason evidence reference");

  const proposed = candidate.proposedChanges as readonly LearningChangeRequest[];
  const assessments = proposed.map(assessChange);
  const seenSurfaces = new Set<string>();
  for (const change of proposed) {
    if (seenSurfaces.has(change.surface)) throw new LearningDecisionError("MALFORMED_DECISION", "decision contains duplicate proposals for one surface");
    seenSurfaces.add(change.surface);
  }
  const admissible = assessments.filter((change) => change.verdict === "ADMISSIBLE");
  const rejected = assessments.filter((change) => change.verdict === "REJECTED");
  if (canonical(assessments) !== canonical(candidate.proposedChanges)
    || canonical(admissible) !== canonical(candidate.admissibleChanges)
    || canonical(rejected) !== canonical(candidate.rejectedChanges)) {
    throw new LearningDecisionError("MALFORMED_DECISION", "decision assessments do not match the owner aperture");
  }

  const expectedMagnitude = admissible.reduce((largest, change) => Math.max(largest, Math.abs(change.proposedValue - change.currentValue)), 0);
  if (candidate.changeMagnitude !== expectedMagnitude) throw new LearningDecisionError("MALFORMED_DECISION", "learning decision change magnitude is invalid");
  const expectedOutcome = admissible.length > 0 ? "ADMISSIBLE" : proposed.length > 0 ? "REJECTED" : "INSUFFICIENT";
  if (candidate.decisionOutcome !== expectedOutcome) throw new LearningDecisionError("MALFORMED_DECISION", "decision outcome does not match its validated assessments");
}

/**
 * Revalidates every allowlisted premise against an owner-read current spec snapshot.
 * A1's stored `currentValue` is only a proposal premise. Any A4 implementation must call this with
 * the canonical current spec read immediately before application; a caller-provided claim alone is
 * not sufficient to authorize a mutation.
 */
export function assertLearningDecisionPremisesMatchCurrentSpec(
  value: unknown,
  currentSpec: LearningDecisionCurrentResearchSpec,
): asserts value is LearningDecision {
  assertLearningDecision(value);
  if (currentSpec == null || typeof currentSpec !== "object" || !SHA64.test(currentSpec.fingerprint ?? "")) {
    throw new LearningDecisionError("CURRENT_SPEC_UNAVAILABLE", "canonical current research spec identity is required before application");
  }
  if (currentSpec.fingerprint !== value.previousResearchSpecFingerprint) {
    throw new LearningDecisionError("CURRENT_SPEC_IDENTITY_MISMATCH", "current research spec does not match the decision premise");
  }
  for (const change of value.proposedChanges) {
    if (allowlistedSurface(change.surface) == null) continue;
    const actual = currentSpec.values?.[change.surface];
    if (!Number.isFinite(actual) || actual !== change.currentValue) {
      throw new LearningDecisionError("CURRENT_SPEC_VALUE_MISMATCH", "decision premise does not match the canonical current research spec");
    }
  }
}
