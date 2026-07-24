import { createHash } from "node:crypto";

export type AlphaStatus = "IDEA" | "RESEARCH" | "PAPER" | "CHAMPION" | "SUSPENDED" | "RETIRED";
export type EvidenceRelation = "SUPPORTS" | "REJECTS" | "NEUTRAL";
export type EvidenceGrade = "A" | "B" | "C" | "D" | "UNRATED";

export interface AlphaRecord {
  readonly alphaId: string; readonly version: number; readonly name: string; readonly category: string;
  readonly status: AlphaStatus; readonly owner: string; readonly markets: readonly string[]; readonly horizon: string;
  readonly capacityUsd: number | null; readonly halfLifeDays: number | null; readonly evidenceGrade: EvidenceGrade;
  readonly riskClass: string; readonly dependencyAlphaIds: readonly string[]; readonly createdAt: string;
  readonly supersedesVersion: number | null; readonly contentHash: string;
}
export interface EvidenceRecord {
  readonly evidenceId: string; readonly source: string; readonly datasetSha256: string; readonly experimentId: string;
  readonly observedAt: string; readonly confidence: number; readonly summary: string; readonly contentHash: string;
}
export interface AlphaEvidenceLink {
  readonly linkId: string; readonly alphaId: string; readonly alphaVersion: number; readonly evidenceId: string;
  readonly relation: EvidenceRelation; readonly createdAt: string; readonly contentHash: string;
}
export interface AlphaEvidenceRegistrySnapshot {
  readonly alphas: readonly AlphaRecord[]; readonly evidence: readonly EvidenceRecord[];
  readonly links: readonly AlphaEvidenceLink[]; readonly generatedAt: string; readonly snapshotHash: string;
}

const ALPHA_STATUSES = new Set<AlphaStatus>(["IDEA", "RESEARCH", "PAPER", "CHAMPION", "SUSPENDED", "RETIRED"]);
const EVIDENCE_GRADES = new Set<EvidenceGrade>(["A", "B", "C", "D", "UNRATED"]);
const RELATIONS = new Set<EvidenceRelation>(["SUPPORTS", "REJECTS", "NEUTRAL"]);
const SHA256 = /^[a-f0-9]{64}$/;
const parseTime = (value: string, label: string): number => { const time = Date.parse(value); if (!Number.isFinite(time)) throw new Error(`${label} must be a valid ISO timestamp`); return time; };
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
};
const hash = (value: unknown): string => createHash("sha256").update(canonical(value)).digest("hex");
const unique = (values: readonly string[], label: string): readonly string[] => {
  const normalized = values.map((value) => value.trim());
  if (normalized.some((value) => !value)) throw new Error(`${label} cannot contain empty values`);
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} must be unique`);
  return Object.freeze(normalized);
};

export const createAlphaRecord = (input: Omit<AlphaRecord, "contentHash">): AlphaRecord => {
  if (!input.alphaId.trim() || !input.name.trim() || !input.category.trim() || !input.owner.trim()) throw new Error("alpha identity fields are required");
  if (!Number.isInteger(input.version) || input.version < 1) throw new Error("alpha version must be a positive integer");
  if (!ALPHA_STATUSES.has(input.status) || !EVIDENCE_GRADES.has(input.evidenceGrade)) throw new Error("invalid alpha enum value");
  if (!input.horizon.trim() || !input.riskClass.trim()) throw new Error("alpha horizon and riskClass are required");
  if (input.capacityUsd !== null && (!Number.isFinite(input.capacityUsd) || input.capacityUsd < 0)) throw new Error("capacityUsd must be non-negative or null");
  if (input.halfLifeDays !== null && (!Number.isFinite(input.halfLifeDays) || input.halfLifeDays <= 0)) throw new Error("halfLifeDays must be positive or null");
  if (input.supersedesVersion !== null && (!Number.isInteger(input.supersedesVersion) || input.supersedesVersion < 1 || input.supersedesVersion >= input.version)) throw new Error("supersedesVersion must precede version");
  parseTime(input.createdAt, "createdAt");
  const payload = { ...input, alphaId: input.alphaId.trim(), name: input.name.trim(), category: input.category.trim(), owner: input.owner.trim(), horizon: input.horizon.trim(), riskClass: input.riskClass.trim(), markets: unique(input.markets, "markets"), dependencyAlphaIds: unique(input.dependencyAlphaIds, "dependencyAlphaIds") };
  if (payload.dependencyAlphaIds.includes(payload.alphaId)) throw new Error("alpha cannot depend on itself");
  return Object.freeze({ ...payload, contentHash: hash(payload) });
};
export const createEvidenceRecord = (input: Omit<EvidenceRecord, "contentHash">): EvidenceRecord => {
  if (!input.evidenceId.trim() || !input.source.trim() || !input.experimentId.trim() || !input.summary.trim()) throw new Error("evidence fields are required");
  if (!SHA256.test(input.datasetSha256)) throw new Error("datasetSha256 must be lowercase SHA-256");
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) throw new Error("confidence must be between 0 and 1");
  parseTime(input.observedAt, "observedAt");
  const payload = { ...input, evidenceId: input.evidenceId.trim(), source: input.source.trim(), experimentId: input.experimentId.trim(), summary: input.summary.trim() };
  return Object.freeze({ ...payload, contentHash: hash(payload) });
};
export const createAlphaEvidenceLink = (input: Omit<AlphaEvidenceLink, "contentHash">): AlphaEvidenceLink => {
  if (!input.linkId.trim() || !input.alphaId.trim() || !input.evidenceId.trim()) throw new Error("link identity fields are required");
  if (!Number.isInteger(input.alphaVersion) || input.alphaVersion < 1) throw new Error("alphaVersion must be positive");
  if (!RELATIONS.has(input.relation)) throw new Error("invalid evidence relation");
  parseTime(input.createdAt, "createdAt");
  const payload = { ...input, linkId: input.linkId.trim(), alphaId: input.alphaId.trim(), evidenceId: input.evidenceId.trim() };
  return Object.freeze({ ...payload, contentHash: hash(payload) });
};

export const buildAlphaEvidenceRegistry = (input: Omit<AlphaEvidenceRegistrySnapshot, "snapshotHash">): AlphaEvidenceRegistrySnapshot => {
  const generatedAt = parseTime(input.generatedAt, "generatedAt");
  const alphaKeys = new Set<string>(); const alphaIds = new Set<string>();
  for (const alpha of input.alphas) {
    const key = `${alpha.alphaId}@${alpha.version}`; if (alphaKeys.has(key)) throw new Error(`duplicate alpha ${key}`);
    alphaKeys.add(key); alphaIds.add(alpha.alphaId);
    if (parseTime(alpha.createdAt, `${key}.createdAt`) > generatedAt) throw new Error(`${key} cannot be created in the future`);
    const { contentHash, ...payload } = alpha; if (contentHash !== hash(payload)) throw new Error(`${key} content hash mismatch`);
  }
  for (const alpha of input.alphas) {
    if (alpha.supersedesVersion !== null && !alphaKeys.has(`${alpha.alphaId}@${alpha.supersedesVersion}`)) throw new Error(`missing superseded alpha ${alpha.alphaId}@${alpha.supersedesVersion}`);
    for (const dependency of alpha.dependencyAlphaIds) if (!alphaIds.has(dependency)) throw new Error(`missing dependency alpha ${dependency}`);
  }
  const evidenceIds = new Set<string>();
  for (const item of input.evidence) {
    if (evidenceIds.has(item.evidenceId)) throw new Error(`duplicate evidence ${item.evidenceId}`); evidenceIds.add(item.evidenceId);
    if (parseTime(item.observedAt, `${item.evidenceId}.observedAt`) > generatedAt) throw new Error(`${item.evidenceId} cannot be observed in the future`);
    const { contentHash, ...payload } = item; if (contentHash !== hash(payload)) throw new Error(`${item.evidenceId} content hash mismatch`);
  }
  const linkIds = new Set<string>();
  for (const link of input.links) {
    if (linkIds.has(link.linkId)) throw new Error(`duplicate link ${link.linkId}`); linkIds.add(link.linkId);
    if (!alphaKeys.has(`${link.alphaId}@${link.alphaVersion}`)) throw new Error(`link references missing alpha ${link.alphaId}@${link.alphaVersion}`);
    if (!evidenceIds.has(link.evidenceId)) throw new Error(`link references missing evidence ${link.evidenceId}`);
    if (parseTime(link.createdAt, `${link.linkId}.createdAt`) > generatedAt) throw new Error(`${link.linkId} cannot be created in the future`);
    const { contentHash, ...payload } = link; if (contentHash !== hash(payload)) throw new Error(`${link.linkId} content hash mismatch`);
  }
  const payload = { alphas: Object.freeze([...input.alphas]), evidence: Object.freeze([...input.evidence]), links: Object.freeze([...input.links]), generatedAt: input.generatedAt };
  return Object.freeze({ ...payload, snapshotHash: hash(payload) });
};
