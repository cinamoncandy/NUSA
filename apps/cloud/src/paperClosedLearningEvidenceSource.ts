import { createHash } from "node:crypto";
import { canonicalResearchJson } from "../../../packages/contracts/src/researchRuntime";
import type { PersistedPaperPeriodEnvelope } from "../../../packages/contracts/src/persistedPaperPeriod";
import type { ClosedLearningEvidenceIdentity } from "./closedLearningLoopCoordinator";

export interface PaperClosedLearningEvidenceSourceOptions {
  readonly listPaperRealizedPeriods: () => readonly PersistedPaperPeriodEnvelope[];
  readonly champion: () => { readonly championId: string; readonly championVersion: string };
  readonly sourceCommitSha: string;
  readonly costModelVersion: string;
  readonly riskConfigHash: string;
  readonly minimumPeriods?: number;
}

const SHA256 = /^[a-f0-9]{64}$/;
const SHA40 = /^[a-f0-9]{40}$/;
const hash = (value: unknown): string => createHash("sha256").update(canonicalResearchJson(value), "utf8").digest("hex");
const text = (value: string, field: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
};

function ordered(envelopes: readonly PersistedPaperPeriodEnvelope[]): readonly PersistedPaperPeriodEnvelope[] {
  const result = [...envelopes].sort((left, right) => left.record.periodIndex - right.record.periodIndex || left.record.recordId.localeCompare(right.record.recordId));
  const indices = new Set<number>();
  const ids = new Set<string>();
  for (const envelope of result) {
    if (indices.has(envelope.record.periodIndex) || ids.has(envelope.record.recordId)) throw new Error("PAPER closed-learning evidence chronology is ambiguous");
    indices.add(envelope.record.periodIndex);
    ids.add(envelope.record.recordId);
  }
  return Object.freeze(result);
}

/**
 * Read-only deterministic projection of authoritative persisted PAPER periods into one closed-learning
 * evidence identity. It does not filter losing/rejected/halted periods and therefore cannot create
 * survivor bias. Replaying identical persisted evidence yields the same identity.
 */
export class PaperClosedLearningEvidenceSource {
  private readonly sourceCommitSha: string;
  private readonly costModelVersion: string;
  private readonly riskConfigHash: string;
  private readonly minimumPeriods: number;

  public constructor(private readonly options: PaperClosedLearningEvidenceSourceOptions) {
    this.sourceCommitSha = text(options.sourceCommitSha, "sourceCommitSha").toLowerCase();
    this.costModelVersion = text(options.costModelVersion, "costModelVersion");
    this.riskConfigHash = text(options.riskConfigHash, "riskConfigHash").toLowerCase();
    if (!SHA40.test(this.sourceCommitSha) || !SHA256.test(this.riskConfigHash)) throw new Error("PAPER closed-learning provenance hashes are invalid");
    this.minimumPeriods = options.minimumPeriods ?? 1;
    if (!Number.isSafeInteger(this.minimumPeriods) || this.minimumPeriods < 1 || this.minimumPeriods > 1_000) throw new Error("minimumPeriods is invalid");
  }

  public read(): ClosedLearningEvidenceIdentity | undefined {
    const periods = ordered(this.options.listPaperRealizedPeriods());
    if (periods.length < this.minimumPeriods) return undefined;
    const champion = this.options.champion();
    const championId = text(champion.championId, "championId");
    const championVersion = text(champion.championVersion, "championVersion");
    const evidenceFingerprintSha256 = hash({
      schemaVersion: 1,
      periods,
      championId,
      championVersion,
      sourceCommitSha: this.sourceCommitSha,
      costModelVersion: this.costModelVersion,
      riskConfigHash: this.riskConfigHash,
    });
    const recordIds = periods.map((period) => period.record.recordId);
    return Object.freeze({
      evidenceId: `paper-forward:${evidenceFingerprintSha256}`,
      evidenceFingerprintSha256,
      championId,
      championVersion,
      sourceCommitSha: this.sourceCommitSha,
      costModelVersion: this.costModelVersion,
      riskConfigHash: this.riskConfigHash,
      evidenceReferences: Object.freeze(recordIds.map((recordId) => `paper-period:${recordId}`)),
    });
  }
}
