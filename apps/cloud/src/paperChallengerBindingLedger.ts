import { canonicalResearchJson } from "../../../packages/contracts/src/researchRuntime";
import type { SqliteEvolutionLearningLedger } from "../../../packages/storage/src/evolutionLearningLedger";
import { validatePaperCandidateExecutionBinding, type PaperCandidateExecutionBinding } from "./cioDecisionEngine";
import type { PaperCandidateBindingProvider } from "./cloudRuntimeDashboardHydrator";

type EvolutionRecord = Parameters<SqliteEvolutionLearningLedger["append"]>[0];
type EvolutionLedgerPort = Pick<SqliteEvolutionLearningLedger, "append" | "list">;

export interface PaperChallengerActivationReceipt {
  readonly schemaVersion: 1;
  readonly status: "ACTIVE";
  readonly market: string;
  readonly binding: PaperCandidateExecutionBinding;
  readonly activatedAt: number;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
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
  return Object.freeze({ schemaVersion: 1, status: "ACTIVE", market: normalizedMarket, binding, activatedAt, liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" });
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
  return Object.freeze(ledger.list().flatMap((record) => {
    const kind = eventKind(record);
    return kind === "ACTIVE" ? [parseActivation(record)] : kind === "REVOKED" ? [parseRevocation(record)] : [];
  }));
}

/**
 * Durable active-challenger state derived exclusively from the existing hash-chained Evolution Learning ledger.
 * The ledger is append-only: activation and revocation never overwrite candidate/version history.
 */
export class PaperChallengerBindingLedger implements PaperCandidateBindingProvider {
  public constructor(private readonly ledger: EvolutionLedgerPort) {}

  public activate(marketValue: string, bindingValue: PaperCandidateExecutionBinding): PaperChallengerActivationReceipt {
    const normalizedMarket = market(marketValue);
    const binding = validatePaperCandidateExecutionBinding(bindingValue, bindingValue.periodStartAt);
    const event: PaperChallengerActivationReceipt = Object.freeze({ schemaVersion: 1, status: "ACTIVE", market: normalizedMarket, binding, activatedAt: binding.periodStartAt, liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" });
    const opportunityId = `paper-challenger:${normalizedMarket}:${binding.bindingFingerprintSha256}:active`;
    this.ledger.append({ opportunityId, problem: PREFIX, evidenceReferences: [`binding:${binding.bindingFingerprintSha256}`, `dataset:${binding.datasetContentSha256}`], hypothesis: canonicalResearchJson(event), changeReference: `candidate:${binding.candidateId}`, validationStatus: "ACTIVE", outcome: "SUCCESS", failureReason: null, rollbackReference: null, reusable: true, recordedAt: new Date(binding.periodStartAt).toISOString() });
    return this.current(normalizedMarket, binding.periodStartAt) ?? (() => { throw new Error("PAPER challenger activation was not recoverable"); })();
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

  public read(marketValue: string, decisionAt: number): PaperCandidateExecutionBinding | undefined {
    return this.current(marketValue, decisionAt)?.binding;
  }
}
