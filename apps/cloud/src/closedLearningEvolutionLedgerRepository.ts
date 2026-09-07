import { canonicalResearchJson } from "../../../packages/contracts/src/researchRuntime";
import type { SqliteEvolutionLearningLedger } from "../../../packages/storage/src/evolutionLearningLedger";
import type {
  ClosedLearningCycleRecord,
  ClosedLearningCycleRepository,
  ClosedLearningPaperDeploymentReceipt,
  ClosedLearningResearchDecision,
} from "./closedLearningLoopCoordinator";

type EvolutionRecord = Parameters<SqliteEvolutionLearningLedger["append"]>[0];
type EvolutionLedgerPort = Pick<SqliteEvolutionLearningLedger, "append" | "list">;

const CYCLE = /^closed-learning:[a-f0-9]{64}$/;
const HASH = /^[a-f0-9]{64}$/;

function parseDecision(value: string): ClosedLearningResearchDecision {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("closed learning durable decision is invalid JSON"); }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("closed learning durable decision is invalid");
  const item = parsed as Record<string, unknown>;
  if (typeof item.decisionId !== "string" || item.decisionId.trim() === "" || typeof item.decisionReference !== "string" || item.decisionReference.trim() === "") throw new Error("closed learning durable decision identity is invalid");
  if (!new Set(["REJECTED", "INSUFFICIENT", "QUALIFIED_FOR_LEAGUE"]).has(String(item.outcome))) throw new Error("closed learning durable outcome is invalid");
  if (!Array.isArray(item.reasons) || item.reasons.some((reason) => typeof reason !== "string" || reason.trim() === "")) throw new Error("closed learning durable reasons are invalid");
  const outcome = item.outcome as ClosedLearningResearchDecision["outcome"];
  const candidateId = typeof item.candidateId === "string" && item.candidateId.trim() ? item.candidateId.trim() : undefined;
  const candidateVersion = typeof item.candidateVersion === "string" && item.candidateVersion.trim() ? item.candidateVersion.trim() : undefined;
  if (outcome === "QUALIFIED_FOR_LEAGUE" && (!candidateId || !candidateVersion)) throw new Error("closed learning durable qualified candidate is invalid");
  if (outcome !== "QUALIFIED_FOR_LEAGUE" && (candidateId || candidateVersion)) throw new Error("closed learning durable non-qualified candidate is invalid");
  return Object.freeze({
    decisionId: item.decisionId.trim(),
    outcome,
    ...(candidateId ? { candidateId } : {}),
    ...(candidateVersion ? { candidateVersion } : {}),
    decisionReference: item.decisionReference.trim(),
    reasons: Object.freeze([...new Set((item.reasons as string[]).map((reason) => reason.trim()))].sort()),
  });
}

function parseDeployment(value: string): ClosedLearningPaperDeploymentReceipt {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("closed learning durable PAPER receipt is invalid JSON"); }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("closed learning durable PAPER receipt is invalid");
  const item = parsed as Record<string, unknown>;
  if (item.authority !== "PAPER_RESEARCH_ONLY" || item.liveAuthority !== "NONE" || item.productionMutationAllowed !== false || item.aiAuthority !== "ZERO_AUTHORITY") throw new Error("closed learning durable PAPER receipt authority is invalid");
  if (typeof item.deploymentId !== "string" || !item.deploymentId.trim() || typeof item.candidateId !== "string" || !item.candidateId.trim() || typeof item.candidateVersion !== "string" || !item.candidateVersion.trim()) throw new Error("closed learning durable PAPER receipt identity is invalid");
  return Object.freeze({ deploymentId: item.deploymentId.trim(), candidateId: item.candidateId.trim(), candidateVersion: item.candidateVersion.trim(), authority: "PAPER_RESEARCH_ONLY", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" });
}

function references(record: EvolutionRecord): { evidenceId: string; fingerprint: string } {
  const evidenceId = record.evidenceReferences.find((value) => value.startsWith("closed-learning-evidence:"))?.slice("closed-learning-evidence:".length);
  const fingerprint = record.evidenceReferences.find((value) => value.startsWith("closed-learning-fingerprint:"))?.slice("closed-learning-fingerprint:".length);
  if (!evidenceId || !fingerprint || !HASH.test(fingerprint)) throw new Error("closed learning durable evidence identity is invalid");
  return { evidenceId, fingerprint };
}

/** Durable adapter over the existing append-only, hash-chained Evolution Learning ledger. */
export class ClosedLearningEvolutionLedgerRepository implements ClosedLearningCycleRepository {
  public constructor(private readonly ledger: EvolutionLedgerPort, private readonly now: () => number = Date.now) {}

  public get(cycleId: string): ClosedLearningCycleRecord | undefined {
    if (!CYCLE.test(cycleId)) throw new Error("closed learning cycleId is invalid");
    const decisionRecord = this.ledger.list().find((record) => record.opportunityId === `${cycleId}:decision`);
    if (decisionRecord == null) return undefined;
    const identity = references(decisionRecord);
    const decision = parseDecision(decisionRecord.hypothesis);
    const paperRecord = this.ledger.list().find((record) => record.opportunityId === `${cycleId}:paper`);
    const paperDeployment = paperRecord == null ? undefined : parseDeployment(paperRecord.hypothesis);
    if (paperDeployment != null && (paperDeployment.candidateId !== decision.candidateId || paperDeployment.candidateVersion !== decision.candidateVersion)) throw new Error("closed learning durable candidate identity conflict");
    return Object.freeze({ cycleId, evidenceId: identity.evidenceId, evidenceFingerprintSha256: identity.fingerprint, decision, ...(paperDeployment ? { paperDeployment } : {}), recordedAt: Date.parse(decisionRecord.recordedAt) });
  }

  public append(record: ClosedLearningCycleRecord): ClosedLearningCycleRecord {
    if (!CYCLE.test(record.cycleId) || !record.evidenceId.trim() || !HASH.test(record.evidenceFingerprintSha256)) throw new Error("closed learning cycle record identity is invalid");
    const existing = this.get(record.cycleId);
    const common = {
      problem: "NUSA production PAPER closed learning cycle",
      evidenceReferences: [`closed-learning-evidence:${record.evidenceId}`, `closed-learning-fingerprint:${record.evidenceFingerprintSha256}`],
      changeReference: record.decision.decisionReference,
      validationStatus: record.decision.outcome,
      outcome: record.decision.outcome === "QUALIFIED_FOR_LEAGUE" ? "SUCCESS" as const : record.decision.outcome === "INSUFFICIENT" ? "PARTIAL_SUCCESS" as const : "UNDERPERFORMED" as const,
      failureReason: record.decision.outcome === "QUALIFIED_FOR_LEAGUE" ? null : record.decision.reasons.join(";").slice(0, 1_000) || record.decision.outcome,
      rollbackReference: null,
      reusable: true,
    };
    if (existing == null) {
      this.ledger.append({ ...common, opportunityId: `${record.cycleId}:decision`, hypothesis: canonicalResearchJson(record.decision), recordedAt: new Date(record.recordedAt).toISOString() });
    } else if (canonicalResearchJson(existing.decision) !== canonicalResearchJson(record.decision) || existing.evidenceId !== record.evidenceId || existing.evidenceFingerprintSha256 !== record.evidenceFingerprintSha256) {
      throw new Error("closed learning durable cycle identity conflict");
    }
    if (record.paperDeployment != null) {
      const current = this.get(record.cycleId);
      if (current?.paperDeployment == null) {
        const timestamp = this.now();
        if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error("closed learning durable clock is invalid");
        this.ledger.append({ ...common, opportunityId: `${record.cycleId}:paper`, hypothesis: canonicalResearchJson(record.paperDeployment), changeReference: record.paperDeployment.deploymentId, recordedAt: new Date(timestamp).toISOString() });
      } else if (canonicalResearchJson(current.paperDeployment) !== canonicalResearchJson(record.paperDeployment)) {
        throw new Error("closed learning durable PAPER deployment conflict");
      }
    }
    return this.get(record.cycleId)!;
  }
}
