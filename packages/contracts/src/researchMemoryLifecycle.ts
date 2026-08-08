import { createHash } from "node:crypto";
import { canonicalResearchJson } from "./researchRuntime";

export type ResearchHypothesisEventType = "CREATED" | "ACTIVATED" | "SUPPORTED" | "REJECTED" | "RETIRED";
export interface ResearchHypothesisEvent {
  readonly sequence: number;
  readonly hypothesisId: string;
  readonly type: ResearchHypothesisEventType;
  readonly title: string;
  readonly statement: string;
  readonly occurredAt: string;
  readonly previousHash: string;
  readonly hash: string;
}
export type ResearchHypothesisLifecycleState = "DRAFT" | "ACTIVE" | "SUPPORTED" | "REJECTED" | "RETIRED";
const genesis = "0".repeat(64);
const terminal = new Set<ResearchHypothesisLifecycleState>(["REJECTED", "RETIRED"]);
const allowed = (prior: ResearchHypothesisLifecycleState | undefined, next: ResearchHypothesisLifecycleState): boolean => {
  if (prior == null) return next === "DRAFT";
  if (terminal.has(prior)) return prior === next;
  if (prior === "DRAFT") return next === "ACTIVE" || next === "REJECTED";
  if (prior === "ACTIVE") return next === "SUPPORTED" || next === "REJECTED" || next === "RETIRED";
  if (prior === "SUPPORTED") return next === "RETIRED";
  return false;
};
const hashEvent = (sequence: number, previousHash: string, event: Omit<ResearchHypothesisEvent, "hash">): string => createHash("sha256").update(`${sequence}\n${previousHash}\n${canonicalResearchJson({ ...event, hash: undefined })}`, "utf8").digest("hex");

export function appendResearchHypothesisEvent(records: readonly ResearchHypothesisEvent[], input: Omit<ResearchHypothesisEvent, "sequence" | "previousHash" | "hash">): readonly ResearchHypothesisEvent[] {
  const state = replayResearchHypothesisEvents(records);
  const prior = state.get(input.hypothesisId);
  const next: ResearchHypothesisLifecycleState = input.type === "CREATED" ? "DRAFT" : input.type === "ACTIVATED" ? "ACTIVE" : input.type;
  if (input.type === "CREATED" && prior != null) throw new Error("hypothesis already exists");
  if (input.type !== "CREATED" && prior == null) throw new Error("hypothesis lifecycle has no CREATED event");
  if (!allowed(prior, next)) throw new Error("hypothesis lifecycle transition is not allowed");
  const sequence = records.length + 1;
  const previousHash = records.at(-1)?.hash ?? genesis;
  const event = { ...input, sequence, previousHash } as Omit<ResearchHypothesisEvent, "hash">;
  return Object.freeze([...records, Object.freeze({ ...event, hash: hashEvent(sequence, previousHash, event) })]);
}

export function replayResearchHypothesisEvents(records: readonly ResearchHypothesisEvent[]): ReadonlyMap<string, ResearchHypothesisLifecycleState> {
  const state = new Map<string, ResearchHypothesisLifecycleState>();
  let previous = genesis;
  records.forEach((record, index) => {
    if (record.sequence !== index + 1 || record.previousHash !== previous || record.hash !== hashEvent(record.sequence, record.previousHash, record)) throw new Error("research hypothesis lifecycle integrity violation");
    const prior = state.get(record.hypothesisId);
    const next: ResearchHypothesisLifecycleState = record.type === "CREATED" ? "DRAFT" : record.type === "ACTIVATED" ? "ACTIVE" : record.type;
    if (record.type === "CREATED" ? prior != null : prior == null) throw new Error("research hypothesis lifecycle transition invalid");
    if (!allowed(prior, next)) throw new Error("research hypothesis lifecycle transition is not allowed");
    state.set(record.hypothesisId, next);
    previous = record.hash;
  });
  return state;
}
