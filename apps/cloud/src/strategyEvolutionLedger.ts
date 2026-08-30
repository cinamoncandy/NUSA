import { createHash } from "node:crypto";

export type EvolutionDecision = "PROMOTE" | "HOLD" | "DEMOTE" | "RETIRE" | "ABSTAIN" | "REJECT" | "HALT";
export type EvolutionEvidenceStatus = "VERIFIED" | "INSUFFICIENT" | "UNKNOWN" | "CONFLICTING";

export interface StrategyEvolutionLedgerEntry {
  readonly entryId: string;
  readonly candidateId: string;
  readonly strategyFamilyId: string;
  readonly strategyVersion: string;
  readonly codeSha: string;
  readonly datasetProvenance: string;
  readonly parameterFingerprint: string;
  readonly parentEntryId: string | null;
  readonly regime: string;
  readonly costModelFingerprint: string;
  readonly evidenceId: string;
  readonly evidenceStatus: EvolutionEvidenceStatus;
  readonly evaluatedAt: string;
  readonly evidenceObservedAt: string;
  readonly decision: EvolutionDecision;
  readonly decisionReasons: readonly string[];
  readonly source: "PAPER" | "RESEARCH";
}

export interface EvolutionLedgerState {
  readonly entries: readonly StrategyEvolutionLedgerEntry[];
  readonly entryFingerprints: readonly string[];
  readonly stateFingerprintSha256: string;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

const finiteDate = (value: string, label: string): number => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid ISO timestamp`);
  return parsed;
};

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  throw new Error("unsupported evolution ledger value");
}

const digest = (value: unknown): string => createHash("sha256").update(canonical(value), "utf8").digest("hex");
const required = (value: string, label: string): void => { if (!value.trim()) throw new Error(`${label} is required`); };

function normalize(entry: StrategyEvolutionLedgerEntry): StrategyEvolutionLedgerEntry {
  required(entry.entryId, "entryId"); required(entry.candidateId, "candidateId"); required(entry.strategyFamilyId, "strategyFamilyId");
  required(entry.strategyVersion, "strategyVersion"); required(entry.codeSha, "codeSha"); required(entry.datasetProvenance, "datasetProvenance");
  required(entry.parameterFingerprint, "parameterFingerprint"); required(entry.regime, "regime"); required(entry.costModelFingerprint, "costModelFingerprint");
  required(entry.evidenceId, "evidenceId");
  const evaluatedAt = finiteDate(entry.evaluatedAt, "evaluatedAt");
  const observedAt = finiteDate(entry.evidenceObservedAt, "evidenceObservedAt");
  if (observedAt > evaluatedAt) throw new Error("future-derived evolution evidence is forbidden");
  if (entry.evidenceStatus !== "VERIFIED") throw new Error("only VERIFIED evidence may enter the canonical evolution ledger");
  if (entry.decisionReasons.length === 0 || entry.decisionReasons.some((reason) => !reason.trim())) throw new Error("decision reason provenance is required");
  return Object.freeze({ ...entry, decisionReasons: Object.freeze([...entry.decisionReasons].sort()) });
}

/** Reconstructs canonical EVOLVE state exclusively from immutable evidence entries. */
export function replayStrategyEvolutionLedger(input: readonly StrategyEvolutionLedgerEntry[]): EvolutionLedgerState {
  const normalized = input.map(normalize);
  const entryIds = new Set<string>();
  const evidenceIds = new Set<string>();
  for (const entry of normalized) {
    if (entryIds.has(entry.entryId)) throw new Error("duplicate/replayed evolution entry");
    if (evidenceIds.has(entry.evidenceId)) throw new Error("duplicate/replayed evolution evidence");
    entryIds.add(entry.entryId); evidenceIds.add(entry.evidenceId);
  }

  const ordered = [...normalized].sort((a, b) => a.evaluatedAt.localeCompare(b.evaluatedAt) || a.entryId.localeCompare(b.entryId));
  const seen = new Map<string, StrategyEvolutionLedgerEntry>();
  for (const entry of ordered) {
    if (entry.parentEntryId !== null) {
      const parent = seen.get(entry.parentEntryId);
      if (!parent) throw new Error("missing or out-of-order parent lineage");
      if (parent.candidateId !== entry.candidateId || parent.strategyFamilyId !== entry.strategyFamilyId) throw new Error("candidate or family lineage mismatch");
    }
    seen.set(entry.entryId, entry);
  }

  const entryFingerprints = ordered.map((entry) => digest(entry));
  return Object.freeze({
    entries: Object.freeze(ordered),
    entryFingerprints: Object.freeze(entryFingerprints),
    stateFingerprintSha256: digest(entryFingerprints),
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}
