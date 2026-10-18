import { createHash } from "node:crypto";
import { canonicalResearchJson } from "./researchRuntime";
/**
 * The bounded learning application that caused this research request.
 *
 * v2 section 8: an application changing `longBarTickEvery` is not itself evidence that the next
 * research run tested the change. The link has to be restorable from provenance alone, so the
 * request names its causal parent by identity, and all three identities are required together -
 * a half-specified parent would read as a link while leaving one end unverifiable.
 *
 * The direction is deliberate. The application exists before the request does, so the request is
 * what carries the link; from an application fingerprint the resulting research spec is then
 * restorable by lookup, and from a spec its causal parent is restorable by reading it.
 */
export interface ResearchLearningParent { readonly type: "learning-application"; readonly learningCycleId: string; readonly learningDecisionFingerprint: string; readonly applicationFingerprint: string; }
export interface ResearchPrecommitInput { readonly schemaVersion: 1; readonly experimentIdentity: string; readonly candidateIdentity: string; readonly strategyIdentity: string; readonly datasetBinding: Readonly<Record<string, unknown>>; readonly sourceSha: string; readonly parameterPlan: Readonly<Record<string, unknown>>; readonly candidateCohort?: readonly Readonly<Record<string, unknown>>[]; readonly searchUniverse?: Readonly<Record<string, unknown>>; readonly costPlan: Readonly<Record<string, unknown>>; readonly regimePlan: Readonly<Record<string, unknown>>; readonly evaluationPlan: Readonly<Record<string, unknown>>; readonly validationPolicyIdentity: string; readonly createdAt: string; /** Present only when this request is the direct consequence of a bounded learning application. */ readonly causedByLearning?: ResearchLearningParent; }
export interface ResearchPrecommit extends ResearchPrecommitInput { readonly fingerprint: string; }
export interface ResearchExecutionBinding { readonly executionId: string; readonly precommitFingerprint: string; readonly actualInput: Readonly<Record<string, unknown>>; readonly inputFingerprint: string; }
export class ResearchPrecommitError extends Error { public constructor(readonly code: string, message: string) { super(message); this.name = "ResearchPrecommitError"; } }
const SHA1 = /^[a-f0-9]{40}$/i; const SHA256 = /^[a-f0-9]{64}$/i; const text = (value: unknown): value is string => typeof value === "string" && value.trim() !== ""; const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
export function researchPrecommitFingerprint(input: ResearchPrecommitInput): string { return createHash("sha256").update(canonicalResearchJson(input), "utf8").digest("hex"); }
function validateInput(input: ResearchPrecommitInput): void { if (input.schemaVersion !== 1) throw new ResearchPrecommitError("UNSUPPORTED_PRECOMMIT_SCHEMA", "unsupported precommit schema"); if (!SHA1.test(input.sourceSha) || !text(input.experimentIdentity) || !text(input.candidateIdentity) || !text(input.strategyIdentity) || !text(input.validationPolicyIdentity)) throw new ResearchPrecommitError("INVALID_PRECOMMIT_IDENTITY", "precommit identities are required"); if (!Number.isFinite(Date.parse(input.createdAt))) throw new ResearchPrecommitError("INVALID_PRECOMMIT_TIMESTAMP", "createdAt must be an ISO timestamp"); if (input.causedByLearning !== undefined) { const parent = input.causedByLearning; if (parent == null || typeof parent !== "object" || parent.type !== "learning-application" || !text(parent.learningCycleId) || !SHA256.test(parent.applicationFingerprint ?? "") || !SHA256.test(parent.learningDecisionFingerprint ?? "")) throw new ResearchPrecommitError("INVALID_LEARNING_CAUSATION", "a learning-caused research request must name its cycle, application, and decision"); } }
export function createResearchPrecommit(input: ResearchPrecommitInput): ResearchPrecommit { validateInput(input); return freeze({ ...input, fingerprint: researchPrecommitFingerprint(input) }); }
/**
 * Whether this research request was caused by a particular bounded learning application.
 *
 * The reverse end of v2 section 8: given an application fingerprint, the resulting research spec is
 * restorable by scanning requests for the parent they name. It is a read of recorded causation,
 * never an input to it, and it answers false for any request that names no learning parent.
 */
export function researchSpecCausedByApplication(precommit: ResearchPrecommitInput | ResearchPrecommit, applicationFingerprint: string): boolean { return precommit.causedByLearning != null && precommit.causedByLearning.applicationFingerprint === applicationFingerprint; }
export function verifyResearchPrecommit(precommit: ResearchPrecommit): void { const { fingerprint, ...input } = precommit; validateInput(input); if (!SHA256.test(fingerprint) || fingerprint !== researchPrecommitFingerprint(input)) throw new ResearchPrecommitError("PRECOMMIT_FINGERPRINT_MISMATCH", "precommit fingerprint mismatch"); }
export function bindResearchExecution(precommit: ResearchPrecommit, executionId: string, actualInput: Readonly<Record<string, unknown>>): ResearchExecutionBinding { verifyResearchPrecommit(precommit); if (!text(executionId)) throw new ResearchPrecommitError("INVALID_EXECUTION_ID", "executionId is required"); const frozenInput = freeze(JSON.parse(canonicalResearchJson(actualInput)) as Readonly<Record<string, unknown>>); return freeze({ executionId, precommitFingerprint: precommit.fingerprint, actualInput: frozenInput, inputFingerprint: createHash("sha256").update(canonicalResearchJson(frozenInput), "utf8").digest("hex") }); }
export function verifyResearchExecutionBinding(precommit: ResearchPrecommit, binding: ResearchExecutionBinding): void { verifyResearchPrecommit(precommit); if (!text(binding.executionId) || binding.precommitFingerprint !== precommit.fingerprint || !SHA256.test(binding.inputFingerprint) || binding.inputFingerprint !== createHash("sha256").update(canonicalResearchJson(binding.actualInput), "utf8").digest("hex")) throw new ResearchPrecommitError("EXECUTION_BINDING_MISMATCH", "execution is not bound to the verified precommit"); }
