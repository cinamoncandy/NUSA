import { canonicalResearchJson } from "../../../packages/contracts/src/researchRuntime";
import type { SqliteEvolutionLearningLedger } from "../../../packages/storage/src/evolutionLearningLedger";
import { validatePaperCandidateExecutionBinding, type PaperCandidateExecutionBinding } from "./cioDecisionEngine";
import type { PaperCandidateBindingProvider } from "./cloudRuntimeDashboardHydrator";
import { samePaperResearchLineage, validatePaperResearchLineage, type PaperResearchLineage } from "./paperResearchLineage";
import { paperChallengerPolicyIdentity } from "./paperChallengerPolicyIdentity";

type EvolutionRecord = Parameters<SqliteEvolutionLearningLedger["append"]>[0];
type EvolutionLedgerPort = Pick<SqliteEvolutionLearningLedger, "append" | "list">;

export interface PaperChallengerActivationReceipt {
  readonly schemaVersion: 1;
  readonly status: "ACTIVE";
  readonly market: string;
  readonly binding: PaperCandidateExecutionBinding;
  readonly activatedAt: number;
  /** Legacy activations may not have lineage. New closed-learning deployments require it. */
  readonly researchLineage?: PaperResearchLineage;
  /** Legacy activations may omit the exact Strategy Governance authorization snapshot. */
  readonly governanceAuthorization?: PaperChallengerGovernanceAuthorization;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

export interface PaperChallengerGovernanceAuthorization {
  readonly strategyId: string;
  readonly candidateId: string;
  readonly candidateVersion: string;
  readonly familyId: string;
  readonly evidenceFingerprintSha256: string;
  readonly lifecycle: string;
  readonly approval: Readonly<{
    readonly actorType: string;
    readonly approvalReference: string;
    readonly approvedAt: number;
    readonly decisionFingerprint: string;
  }>;
}

export interface PaperChallengerRevocationReceipt {
  readonly schemaVersion: 1;
  readonly status: "REVOKED";
  readonly market: string;
  readonly bindingFingerprintSha256: string;
  readonly candidateId: string;
  readonly revokedAt: number;
  readonly reason: string;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

const MARKET = /^KRW-[A-Z0-9-]+$/;
const HASH = /^[a-f0-9]{64}$/;
const APPROVAL_REFERENCE = /^[A-Za-z0-9_.:/#@-]{1,240}$/;
const PREFIX = "NUSA PAPER challenger binding lifecycle";

function market(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!MARKET.test(normalized)) throw new Error("PAPER challenger market is invalid");
  return normalized;
}

function timestamp(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
  return value;
}

function text(value: string, field: string, max = 500): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(`${field} is invalid`);
  return normalized;
}

function eventKind(record: EvolutionRecord): "ACTIVE" | "REVOKED" | undefined {
  if (record.problem !== PREFIX) return undefined;
  return record.validationStatus === "ACTIVE" ? "ACTIVE" : record.validationStatus === "REVOKED" ? "REVOKED" : undefined;
}

function parseActivation(record: EvolutionRecord): PaperChallengerActivationReceipt {
  let parsed: unknown;
  try { parsed = JSON.parse(record.hypothesis); } catch { throw new Error("persisted PAPER challenger activation is invalid JSON"); }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("persisted PAPER challenger activation is invalid");
  const item = parsed as PaperChallengerActivationReceipt;
  if (item.schemaVersion !== 1 || item.status !== "ACTIVE" || item.liveAuthority !== "NONE" || item.productionMutationAllowed !== false || item.aiAuthority !== "ZERO_AUTHORITY") throw new Error("persisted PAPER challenger activation authority is invalid");
  const normalizedMarket = market(item.market);
  const activatedAt = timestamp(item.activatedAt, "activatedAt");
  const binding = validatePaperCandidateExecutionBinding(item.binding, Math.max(activatedAt, item.binding.periodStartAt));
  if (binding.periodStartAt !== activatedAt) throw new Error("PAPER challenger activation must match the canonical period start");
  const researchLineage = item.researchLineage == null ? undefined : validatePaperResearchLineage(item.researchLineage);
  if (researchLineage != null && (researchLineage.candidateId !== binding.candidateId || researchLineage.candidateVersion !== binding.candidateStrategy?.specificationHash)) throw new Error("PAPER challenger Research lineage candidate conflict");
  const governanceAuthorization = item.governanceAuthorization == null ? undefined : validateGovernanceAuthorization(item.governanceAuthorization, binding, researchLineage);
  return Object.freeze({
    schemaVersion: 1,
    status: "ACTIVE",
    market: normalizedMarket,
    binding,
    activatedAt,
    ...(researchLineage == null ? {} : { researchLineage }),
    ...(governanceAuthorization == null ? {} : { governanceAuthorization }),
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}

function validateGovernanceAuthorization(value: PaperChallengerGovernanceAuthorization, binding: PaperCandidateExecutionBinding, researchLineage?: PaperResearchLineage): PaperChallengerGovernanceAuthorization {
  const approval = value?.approval;
  const policyIdentity = approval?.actorType === "POLICY" && researchLineage != null
    ? paperChallengerPolicyIdentity({ candidateId: binding.candidateId, candidateVersion: binding.candidateStrategy?.specificationHash ?? "", familyId: binding.candidateStrategy?.familyId ?? "", evidenceFingerprintSha256: binding.bindingFingerprintSha256, replayRunFingerprintSha256: researchLineage.replayRunFingerprintSha256, researchDecisionReference: researchLineage.researchDecisionReference })
    : undefined;
  if (!value?.strategyId?.trim() || value.strategyId.length > 240 || value.candidateId !== binding.candidateId || value.candidateVersion !== binding.candidateStrategy?.specificationHash
    || value.familyId !== binding.candidateStrategy?.familyId || value.evidenceFingerprintSha256 !== binding.bindingFingerprintSha256 || value.lifecycle !== "CHALLENGER"
    || (approval?.actorType !== "HUMAN" && !(approval?.actorType === "POLICY" && approval.approvalReference?.startsWith("policy:") === true))
    || !APPROVAL_REFERENCE.test(approval.approvalReference ?? "") || !HASH.test(approval.decisionFingerprint) || !Number.isSafeInteger(approval.approvedAt) || approval.approvedAt < 0 || approval.approvedAt > binding.periodStartAt
    || (approval.actorType === "POLICY" && (policyIdentity == null || approval.decisionFingerprint !== policyIdentity.decisionFingerprint || approval.approvalReference !== policyIdentity.approvalReference))) {
    throw new Error("PAPER challenger Governance authorization does not bind the active candidate");
  }
  return Object.freeze({ ...value, approval: Object.freeze({ ...approval }) });
}

function parseRevocation(record: EvolutionRecord): PaperChallengerRevocationReceipt {
  let parsed: unknown;
  try { parsed = JSON.parse(record.hypothesis); } catch { throw new Error("persisted PAPER challenger revocation is invalid JSON"); }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("persisted PAPER challenger revocation is invalid");
  const item = parsed as PaperChallengerRevocationReceipt;
  if (item.schemaVersion !== 1 || item.status !== "REVOKED" || item.liveAuthority !== "NONE" || item.productionMutationAllowed !== false || item.aiAuthority !== "ZERO_AUTHORITY") throw new Error("persisted PAPER challenger revocation authority is invalid");
  if (!HASH.test(item.bindingFingerprintSha256)) throw new Error("persisted PAPER challenger revocation fingerprint is invalid");
  return Object.freeze({ schemaVersion: 1, status: "REVOKED", market: market(item.market), bindingFingerprintSha256: item.bindingFingerprintSha256, candidateId: text(item.candidateId, "candidateId", 240), revokedAt: timestamp(item.revokedAt, "revokedAt"), reason: text(item.reason, "reason"), liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" });
}

function lifecycle(ledger: EvolutionLedgerPort): readonly (PaperChallengerActivationReceipt | PaperChallengerRevocationReceipt)[] {
  const events: (PaperChallengerActivationReceipt | PaperChallengerRevocationReceipt)[] = [];
  for (const record of ledger.list()) {
    const kind = eventKind(record);
    if (kind === "ACTIVE") events.push(parseActivation(record));
    else if (kind === "REVOKED") events.push(parseRevocation(record));
  }
  return Object.freeze(events);
}

/**
 * Durable active-challenger state derived exclusively from the existing hash-chained Evolution Learning ledger.
 * The ledger is append-only: activation and revocation never overwrite candidate/version history.
 */
export class PaperChallengerBindingLedger implements PaperCandidateBindingProvider {
  public constructor(private readonly ledger: EvolutionLedgerPort) {}

  public activate(marketValue: string, bindingValue: PaperCandidateExecutionBinding, researchLineageValue: PaperResearchLineage | undefined, governanceAuthorizationValue: PaperChallengerGovernanceAuthorization): PaperChallengerActivationReceipt {
    const normalizedMarket = market(marketValue);
    const binding = validatePaperCandidateExecutionBinding(bindingValue, bindingValue.periodStartAt);
    const researchLineage = researchLineageValue == null ? undefined : validatePaperResearchLineage(researchLineageValue);
    if (researchLineage != null && (researchLineage.candidateId !== binding.candidateId || researchLineage.candidateVersion !== binding.candidateStrategy?.specificationHash)) throw new Error("PAPER challenger Research lineage candidate conflict");
    const governanceAuthorization = validateGovernanceAuthorization(governanceAuthorizationValue, binding, researchLineage);
    const event: PaperChallengerActivationReceipt = Object.freeze({
      schemaVersion: 1,
      status: "ACTIVE",
      market: normalizedMarket,
      binding,
      activatedAt: binding.periodStartAt,
      ...(researchLineage == null ? {} : { researchLineage }),
      governanceAuthorization,
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    });
    const opportunityId = `paper-challenger:${normalizedMarket}:${binding.bindingFingerprintSha256}:active`;
    const evidenceReferences = [`binding:${binding.bindingFingerprintSha256}`, `dataset:${binding.datasetContentSha256}`];
    if (researchLineage != null) evidenceReferences.push(`research-run:${researchLineage.originalRunFingerprintSha256}`, `research-replay:${researchLineage.replayRunFingerprintSha256}`);
    evidenceReferences.push(`governance:${governanceAuthorization.approval.decisionFingerprint}`);
    this.ledger.append({ opportunityId, problem: PREFIX, evidenceReferences, hypothesis: canonicalResearchJson(event), changeReference: `candidate:${binding.candidateId}`, validationStatus: "ACTIVE", outcome: "SUCCESS", failureReason: null, rollbackReference: null, reusable: true, recordedAt: new Date(binding.periodStartAt).toISOString() });
    const recovered = this.current(normalizedMarket, binding.periodStartAt) ?? (() => { throw new Error("PAPER challenger activation was not recoverable"); })();
    if (researchLineage != null && (recovered.researchLineage == null || !samePaperResearchLineage(recovered.researchLineage, researchLineage))) throw new Error("PAPER challenger Research lineage was not recoverable");
    if (recovered.governanceAuthorization?.approval.decisionFingerprint !== governanceAuthorization.approval.decisionFingerprint) throw new Error("PAPER challenger Governance authorization was not recoverable");
    return recovered;
  }

  public revoke(marketValue: string, bindingFingerprintSha256: string, candidateId: string, revokedAtValue: number, reasonValue: string): PaperChallengerRevocationReceipt {
    const normalizedMarket = market(marketValue);
    if (!HASH.test(bindingFingerprintSha256)) throw new Error("PAPER challenger revocation fingerprint is invalid");
    const revokedAt = timestamp(revokedAtValue, "revokedAt");
    const reason = text(reasonValue, "reason");
    const active = this.current(normalizedMarket, revokedAt);
    if (active == null || active.binding.bindingFingerprintSha256 !== bindingFingerprintSha256 || active.binding.candidateId !== candidateId.trim()) throw new Error("PAPER challenger revocation does not match the active immutable binding");
    const event: PaperChallengerRevocationReceipt = Object.freeze({ schemaVersion: 1, status: "REVOKED", market: normalizedMarket, bindingFingerprintSha256, candidateId: active.binding.candidateId, revokedAt, reason, liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" });
    this.ledger.append({ opportunityId: `paper-challenger:${normalizedMarket}:${bindingFingerprintSha256}:revoke`, problem: PREFIX, evidenceReferences: [`binding:${bindingFingerprintSha256}`], hypothesis: canonicalResearchJson(event), changeReference: `candidate:${active.binding.candidateId}`, validationStatus: "REVOKED", outcome: "UNDERPERFORMED", failureReason: reason, rollbackReference: `binding:${bindingFingerprintSha256}`, reusable: true, recordedAt: new Date(revokedAt).toISOString() });
    return event;
  }

  public current(marketValue: string, decisionAtValue: number): PaperChallengerActivationReceipt | undefined {
    const normalizedMarket = market(marketValue);
    const decisionAt = timestamp(decisionAtValue, "decisionAt");
    let active: PaperChallengerActivationReceipt | undefined;
    for (const event of lifecycle(this.ledger)) {
      if (event.market !== normalizedMarket) continue;
      const occurredAt = event.status === "ACTIVE" ? event.activatedAt : event.revokedAt;
      if (occurredAt > decisionAt) continue;
      if (event.status === "ACTIVE") {
        if (active != null) throw new Error("multiple PAPER challengers are active for one market");
        active = event;
      } else if (active != null && active.binding.bindingFingerprintSha256 === event.bindingFingerprintSha256) {
        active = undefined;
      }
    }
    return active;
  }

  public lineage(marketValue: string, decisionAt: number): PaperResearchLineage | undefined {
    return this.current(marketValue, decisionAt)?.researchLineage;
  }

  public read(marketValue: string, decisionAt: number): PaperCandidateExecutionBinding | undefined {
    return this.current(marketValue, decisionAt)?.binding;
  }
}
