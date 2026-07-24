import { createHash } from "node:crypto";

export type ResearchPriority = "S" | "A" | "B" | "C";
export type ResearchBacklogStatus = "QUEUED" | "RUNNING" | "BLOCKED" | "COMPLETED" | "REJECTED";

export interface ResearchBacklogItem {
  readonly researchId: string;
  readonly title: string;
  readonly priority: ResearchPriority;
  readonly status: ResearchBacklogStatus;
  readonly owner: string;
  readonly question: string;
  readonly hypothesis: string;
  readonly linkedAlphaIds: readonly string[];
  readonly dependencyResearchIds: readonly string[];
  readonly evidenceCount: number;
  readonly experimentCount: number;
  readonly createdAt: string;
  readonly dueAt: string | null;
  readonly contentHash: string;
}

export interface ResearchBacklogSnapshot {
  readonly items: readonly ResearchBacklogItem[];
  readonly rankedResearchIds: readonly string[];
  readonly generatedAt: string;
  readonly snapshotHash: string;
}

const PRIORITIES = new Set<ResearchPriority>(["S", "A", "B", "C"]);
const STATUSES = new Set<ResearchBacklogStatus>(["QUEUED", "RUNNING", "BLOCKED", "COMPLETED", "REJECTED"]);
const PRIORITY_RANK: Readonly<Record<ResearchPriority, number>> = Object.freeze({ S: 0, A: 1, B: 2, C: 3 });
const STATUS_RANK: Readonly<Record<ResearchBacklogStatus, number>> = Object.freeze({ RUNNING: 0, QUEUED: 1, BLOCKED: 2, COMPLETED: 3, REJECTED: 4 });

const parseTime = (value: string, label: string): number => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} must be a valid ISO timestamp`);
  return timestamp;
};
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

export const createResearchBacklogItem = (input: Omit<ResearchBacklogItem, "contentHash">): ResearchBacklogItem => {
  if (!input.researchId.trim() || !input.title.trim() || !input.owner.trim() || !input.question.trim() || !input.hypothesis.trim()) {
    throw new Error("research identity and thesis fields are required");
  }
  if (!PRIORITIES.has(input.priority) || !STATUSES.has(input.status)) throw new Error("invalid backlog enum value");
  if (!Number.isInteger(input.evidenceCount) || input.evidenceCount < 0) throw new Error("evidenceCount must be a non-negative integer");
  if (!Number.isInteger(input.experimentCount) || input.experimentCount < 0) throw new Error("experimentCount must be a non-negative integer");
  const createdAt = parseTime(input.createdAt, "createdAt");
  if (input.dueAt !== null && parseTime(input.dueAt, "dueAt") < createdAt) throw new Error("dueAt cannot precede createdAt");
  const payload = {
    ...input,
    researchId: input.researchId.trim(),
    title: input.title.trim(),
    owner: input.owner.trim(),
    question: input.question.trim(),
    hypothesis: input.hypothesis.trim(),
    linkedAlphaIds: unique(input.linkedAlphaIds, "linkedAlphaIds"),
    dependencyResearchIds: unique(input.dependencyResearchIds, "dependencyResearchIds")
  };
  if (payload.dependencyResearchIds.includes(payload.researchId)) throw new Error("research item cannot depend on itself");
  return Object.freeze({ ...payload, contentHash: hash(payload) });
};

const assertAcyclic = (items: readonly ResearchBacklogItem[]): void => {
  const graph = new Map(items.map((item) => [item.researchId, item.dependencyResearchIds]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`research dependency cycle detected at ${id}`);
    visiting.add(id);
    for (const dependency of graph.get(id) ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of graph.keys()) visit(id);
};

export const buildResearchBacklog = (input: Omit<ResearchBacklogSnapshot, "rankedResearchIds" | "snapshotHash">): ResearchBacklogSnapshot => {
  const generatedAt = parseTime(input.generatedAt, "generatedAt");
  const ids = new Set<string>();
  for (const item of input.items) {
    if (ids.has(item.researchId)) throw new Error(`duplicate research item ${item.researchId}`);
    ids.add(item.researchId);
    if (parseTime(item.createdAt, `${item.researchId}.createdAt`) > generatedAt) throw new Error(`${item.researchId} cannot be created in the future`);
    const { contentHash, ...payload } = item;
    if (contentHash !== hash(payload)) throw new Error(`${item.researchId} content hash mismatch`);
  }
  for (const item of input.items) {
    for (const dependency of item.dependencyResearchIds) if (!ids.has(dependency)) throw new Error(`missing research dependency ${dependency}`);
  }
  assertAcyclic(input.items);
  const items = Object.freeze([...input.items]);
  const rankedResearchIds = Object.freeze([...items]
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
      || STATUS_RANK[a.status] - STATUS_RANK[b.status]
      || Date.parse(a.createdAt) - Date.parse(b.createdAt)
      || a.researchId.localeCompare(b.researchId))
    .map((item) => item.researchId));
  const payload = { items, rankedResearchIds, generatedAt: input.generatedAt };
  return Object.freeze({ ...payload, snapshotHash: hash(payload) });
};
