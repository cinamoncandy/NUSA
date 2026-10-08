import { canonicalResearchJson } from "../../../packages/contracts/src/researchRuntime";
import type { SqliteEvolutionLearningLedger } from "../../../packages/storage/src/evolutionLearningLedger";
import type {
  ClosedLearningCycleRecord,
  ClosedLearningCycleRepository,
  ClosedLearningPaperDeploymentReceipt,
  ClosedLearningResearchDecision,
} from "./closedLearningLoopCoordinator";
import { createHash } from "node:crypto";

type EvolutionRecord = Parameters<SqliteEvolutionLearningLedger["append"]>[0];
type EvolutionLedgerPort = Pick<SqliteEvolutionLearningLedger, "append" | "list">;

const CYCLE = /^closed-learning:[a-f0-9]{64}$/;
const HASH = /^[a-f0-9]{64}$/;
const SHA1 = /^[a-f0-9]{40}$/;
const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const FAILURE = /^closed-learning-failure:[a-f0-9]{64}$/;

export interface ClosedLearningCycleFailureReceipt {
  readonly failureId: string;
  readonly closedPeriodId: string;
  readonly evidenceId: string;
  readonly evidenceFingerprintSha256: string;
  readonly sourceCommitSha: string;
  readonly runtimeSourceCommitSha: string;
  readonly stage: "CYCLE" | "FINALIZE";
  readonly code: string;
  readonly recordedAt: number;
}

function failureIdentity(input: Omit<ClosedLearningCycleFailureReceipt, "failureId" | "recordedAt">): string {
  return `closed-learning-failure:${createHash("sha256").update(canonicalResearchJson(input), "utf8").digest("hex")}`;
}

function parseFailure(record: EvolutionRecord): ClosedLearningCycleFailureReceipt {
  if (!FAILURE.test(record.opportunityId) || record.validationStatus !== "CYCLE_FAILURE") throw new Error("closed learning durable failure namespace is invalid");
  let value: unknown;
  try { value = JSON.parse(record.hypothesis); } catch { throw new Error("closed learning durable failure is invalid JSON"); }
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error("closed learning durable failure is invalid");
  const item = value as Record<string, unknown>;
  const receipt = item as unknown as ClosedLearningCycleFailureReceipt;
  if (receipt.failureId !== record.opportunityId || !FAILURE.test(receipt.failureId) || typeof receipt.closedPeriodId !== "string" || !receipt.closedPeriodId.trim()
    || typeof receipt.evidenceId !== "string" || !receipt.evidenceId.trim() || !HASH.test(receipt.evidenceFingerprintSha256)
    || !SHA1.test(receipt.sourceCommitSha) || !SHA1.test(receipt.runtimeSourceCommitSha)
    || (receipt.stage !== "CYCLE" && receipt.stage !== "FINALIZE") || !CODE.test(receipt.code)
    || !Number.isSafeInteger(receipt.recordedAt) || receipt.recordedAt < 0
    || Object.keys(item).sort().join(",") !== "closedPeriodId,code,evidenceFingerprintSha256,evidenceId,failureId,recordedAt,runtimeSourceCommitSha,sourceCommitSha,stage") {
    throw new Error("closed learning durable failure receipt is malformed");
  }
  const { failureId: _failureId, recordedAt: _recordedAt, ...identity } = receipt;
  if (failureIdentity(identity) !== receipt.failureId) throw new Error("closed learning durable failure identity is tampered");
  const expectedReferences = [`closed-learning-evidence:${receipt.evidenceId}`, `closed-learning-fingerprint:${receipt.evidenceFingerprintSha256}`, `paper-period:${receipt.closedPeriodId}`].sort();
  if (record.failureReason !== receipt.code || record.changeReference !== receipt.runtimeSourceCommitSha || Date.parse(record.recordedAt) !== receipt.recordedAt
    || record.evidenceReferences.join("\n") !== expectedReferences.join("\n")) throw new Error("closed learning durable failure metadata is tampered");
  return Object.freeze({ ...receipt });
}

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
    return this.build(cycleId, this.ledger.list());
  }

  /** Builds one cycle record from an already obtained ledger replay, so a caller that reads many cycles replays (and re-validates) the ledger once. */
  private build(cycleId: string, records: ReturnType<EvolutionLedgerPort["list"]>): ClosedLearningCycleRecord | undefined {
    const decisionRecord = records.find((record) => record.opportunityId === `${cycleId}:decision`);
    if (decisionRecord == null) return undefined;
    const identity = references(decisionRecord);
    const decision = parseDecision(decisionRecord.hypothesis);
    const paperRecord = records.find((record) => record.opportunityId === `${cycleId}:paper`);
    const paperDeployment = paperRecord == null ? undefined : parseDeployment(paperRecord.hypothesis);
    if (paperDeployment != null && (paperDeployment.candidateId !== decision.candidateId || paperDeployment.candidateVersion !== decision.candidateVersion)) throw new Error("closed learning durable candidate identity conflict");
    return Object.freeze({ cycleId, evidenceId: identity.evidenceId, evidenceFingerprintSha256: identity.fingerprint, decision, ...(paperDeployment ? { paperDeployment } : {}), recordedAt: Date.parse(decisionRecord.recordedAt) });
  }

  /**
   * Display-only read of the durable cycle history from ONE ledger replay: the number of valid recorded cycles and the most recent one.
   * An unreadable or namespace-shaped-but-invalid entry is neither counted nor allowed to hide the others. A failure of the ledger
   * itself (corruption, persistence error) is not swallowed here: it propagates so the caller can withdraw what it published.
   */
  public summary(): { readonly cyclesRecorded: number; readonly latest?: ClosedLearningCycleRecord } {
    const records = this.ledger.list();
    let cyclesRecorded = 0;
    let latest: ClosedLearningCycleRecord | undefined;
    for (const decision of records) {
      if (!decision.opportunityId.endsWith(":decision")) continue;
      const cycleId = decision.opportunityId.slice(0, -":decision".length);
      if (!CYCLE.test(cycleId)) continue;
      let record: ClosedLearningCycleRecord | undefined;
      try { record = this.build(cycleId, records); } catch { continue; }
      if (record == null) continue;
      cyclesRecorded += 1;
      if (latest == null || record.recordedAt >= latest.recordedAt) latest = record;
    }
    return Object.freeze({ cyclesRecorded, ...(latest == null ? {} : { latest }) });
  }

  /** Append-only, replay-idempotent failure evidence in the existing hash-chained learning ledger. */
  public appendFailure(input: Omit<ClosedLearningCycleFailureReceipt, "failureId" | "recordedAt">): ClosedLearningCycleFailureReceipt {
    if (!input.closedPeriodId.trim() || !input.evidenceId.trim() || !HASH.test(input.evidenceFingerprintSha256) || !SHA1.test(input.sourceCommitSha)
      || !SHA1.test(input.runtimeSourceCommitSha) || !CODE.test(input.code) || (input.stage !== "CYCLE" && input.stage !== "FINALIZE")) throw new Error("closed learning failure receipt input is invalid");
    const failureId = failureIdentity(input);
    const existing = this.failureSummary().receipts.find((item) => item.failureId === failureId);
    if (existing != null) return existing;
    const timestamp = this.now();
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error("closed learning durable clock is invalid");
    const receipt = Object.freeze({ failureId, ...input, recordedAt: timestamp });
    this.ledger.append({ opportunityId: failureId, problem: "NUSA production PAPER closed learning cycle failure", evidenceReferences: [`closed-learning-evidence:${input.evidenceId}`, `closed-learning-fingerprint:${input.evidenceFingerprintSha256}`, `paper-period:${input.closedPeriodId}`], hypothesis: canonicalResearchJson(receipt), changeReference: input.runtimeSourceCommitSha, validationStatus: "CYCLE_FAILURE", outcome: "FAILED", failureReason: input.code, rollbackReference: null, reusable: true, recordedAt: new Date(timestamp).toISOString() });
    return receipt;
  }

  /** Strict replay: any malformed/tampered receipt withdraws the projection by throwing. */
  public failureSummary(): { readonly failuresRecorded: number; readonly receipts: readonly ClosedLearningCycleFailureReceipt[]; readonly latest?: ClosedLearningCycleFailureReceipt } {
    const receipts = this.ledger.list().filter((record) => record.opportunityId.startsWith("closed-learning-failure:")).map(parseFailure);
    const latest = receipts.reduce<ClosedLearningCycleFailureReceipt | undefined>((value, item) => value == null || item.recordedAt >= value.recordedAt ? item : value, undefined);
    return Object.freeze({ failuresRecorded: receipts.length, receipts: Object.freeze(receipts), ...(latest == null ? {} : { latest }) });
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
