import { createHash } from "node:crypto";

export type ResearchStage = "QUESTION" | "HYPOTHESIS" | "EXPERIMENT" | "EVIDENCE" | "DECISION" | "OUTCOME" | "LESSON";
export type EvidenceDirection = "SUPPORTS" | "REJECTS" | "NEUTRAL";

export interface ResearchMemoryRecord {
  readonly recordId: string;
  readonly researchId: string;
  readonly stage: ResearchStage;
  readonly createdAt: string;
  readonly author: string;
  readonly summary: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly parentRecordIds: readonly string[];
  readonly evidenceDirection?: EvidenceDirection;
  readonly contentHash: string;
}

export interface ResearchMemoryInput {
  readonly recordId: string;
  readonly researchId: string;
  readonly stage: ResearchStage;
  readonly createdAt: string;
  readonly author: string;
  readonly summary: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly parentRecordIds?: readonly string[];
  readonly evidenceDirection?: EvidenceDirection;
}

const stable = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
    .join(",")}}`;
};

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  }
  return value;
};

const validTime = (value: string): void => {
  if (!Number.isFinite(Date.parse(value))) throw new Error("createdAt must be a valid ISO timestamp");
};

export const createResearchMemoryRecord = (input: ResearchMemoryInput): ResearchMemoryRecord => {
  if (!input.recordId.trim()) throw new Error("recordId is required");
  if (!input.researchId.trim()) throw new Error("researchId is required");
  if (!input.author.trim()) throw new Error("author is required");
  if (!input.summary.trim()) throw new Error("summary is required");
  validTime(input.createdAt);

  const parents = [...(input.parentRecordIds ?? [])];
  if (new Set(parents).size !== parents.length) throw new Error("parentRecordIds must be unique");
  if (parents.includes(input.recordId)) throw new Error("record cannot reference itself");
  if ((input.stage === "EVIDENCE") !== Boolean(input.evidenceDirection)) {
    throw new Error("evidenceDirection is required only for EVIDENCE records");
  }

  const canonical = {
    recordId: input.recordId,
    researchId: input.researchId,
    stage: input.stage,
    createdAt: input.createdAt,
    author: input.author,
    summary: input.summary,
    payload: input.payload,
    parentRecordIds: [...parents].sort(),
    evidenceDirection: input.evidenceDirection ?? null
  };
  const contentHash = createHash("sha256").update(stable(canonical)).digest("hex");

  return deepFreeze({
    ...canonical,
    evidenceDirection: input.evidenceDirection,
    contentHash
  });
};

export const validateResearchTimeline = (records: readonly ResearchMemoryRecord[]): readonly ResearchMemoryRecord[] => {
  const byId = new Map<string, ResearchMemoryRecord>();
  for (const record of records) {
    if (byId.has(record.recordId)) throw new Error(`duplicate recordId ${record.recordId}`);
    byId.set(record.recordId, record);
  }
  for (const record of records) {
    for (const parentId of record.parentRecordIds) {
      const parent = byId.get(parentId);
      if (!parent) throw new Error(`missing parent record ${parentId}`);
      if (parent.researchId !== record.researchId) throw new Error("cross-research parent references are forbidden");
      if (Date.parse(parent.createdAt) > Date.parse(record.createdAt)) throw new Error("parent record cannot be newer than child");
    }
  }
  return Object.freeze([...records].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)));
};
