import { createHash } from "node:crypto";
import { canonicalResearchJson } from "./researchRuntime";

export type ResearchMemorySemanticClass =
  | "OBSERVATION" | "HYPOTHESIS" | "EVIDENCE" | "LESSON"
  | "STRATEGY_CANDIDATE" | "REJECTED" | "RETIRED";

export type ResearchMemoryValidity =
  | "CURRENT" | "SUPERSEDED" | "REVALIDATION_REQUIRED" | "INVALID_PROVENANCE";

export type ResearchMemoryAttribution =
  | "SIGNAL" | "REGIME" | "DATA" | "EXECUTION_RUNTIME" | "TRANSACTION_COST"
  | "RISK_SIZING" | "SAMPLE_STATISTICS" | "MULTIPLE_TESTING" | "MIXED_UNRESOLVED";

export type ResearchMemoryEvidenceLinkType = "SUPPORTS" | "CONTRADICTS" | "SUPERSEDES" | "REVALIDATES";

export type ResearchMemoryEvidenceOrigin =
  | "CANONICAL_RESEARCH" | "PAPER_FORWARD" | "AI_ADVISORY"
  | "HYPOTHESIS_PRIOR" | "UNKNOWN_UNTRUSTED";

export interface ResearchMemoryEvidenceLink {
  readonly type: ResearchMemoryEvidenceLinkType;
  readonly targetArtifactSha256: string;
}

export interface ResearchMemorySemanticInput {
  readonly artifactSha256: string;
  readonly semanticClass: ResearchMemorySemanticClass;
  readonly validity: ResearchMemoryValidity;
  readonly attribution: ResearchMemoryAttribution;
  readonly evidenceOrigin: ResearchMemoryEvidenceOrigin;
  readonly evaluatorSemanticsId: string;
  readonly semanticIdentity: string;
  readonly independenceGroupId: string;
  readonly actor: string;
  readonly source: string;
  readonly reason: string;
  readonly occurredAt: string;
  readonly links?: readonly ResearchMemoryEvidenceLink[];
}

export interface ResearchMemorySemanticEvent extends ResearchMemorySemanticInput {
  readonly sequence: number;
  readonly identity: string;
  readonly previousHash: string;
  readonly hash: string;
}

const genesis = "0".repeat(64);
const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const required = (value: string, field: string): void => { if (!value.trim()) throw new Error(`${field} is required`); };
const digest = (value: string, field: string): void => { if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error(`${field} must be a SHA-256 hex string`); };
const validTime = (value: string): void => { if (!Number.isFinite(Date.parse(value))) throw new Error("occurredAt must be an ISO timestamp"); };

const normalizeLinks = (links: readonly ResearchMemoryEvidenceLink[] = []): readonly ResearchMemoryEvidenceLink[] =>
  Object.freeze([...links].map((link) => {
    digest(link.targetArtifactSha256, "targetArtifactSha256");
    return Object.freeze({ ...link });
  }).sort((a, b) => `${a.type}:${a.targetArtifactSha256}`.localeCompare(`${b.type}:${b.targetArtifactSha256}`)));

const canonicalInput = (input: ResearchMemorySemanticInput): ResearchMemorySemanticInput => {
  digest(input.artifactSha256, "artifactSha256");
  for (const [field, value] of [["evaluatorSemanticsId", input.evaluatorSemanticsId], ["semanticIdentity", input.semanticIdentity], ["independenceGroupId", input.independenceGroupId], ["actor", input.actor], ["source", input.source], ["reason", input.reason]] as const) required(value, field);
  validTime(input.occurredAt);
  if (input.semanticClass === "LESSON" && input.validity !== "CURRENT") throw new Error("LESSON requires CURRENT validity");
  if (input.semanticClass === "LESSON" && !["CANONICAL_RESEARCH", "PAPER_FORWARD"].includes(input.evidenceOrigin)) throw new Error("LESSON requires canonical empirical evidence origin");
  return Object.freeze({ ...input, links: normalizeLinks(input.links) });
};

export const researchMemorySemanticIdentity = (input: ResearchMemorySemanticInput): string => {
  const canonical = canonicalInput(input);
  return sha256(canonicalResearchJson({
    artifactSha256: canonical.artifactSha256,
    semanticClass: canonical.semanticClass,
    validity: canonical.validity,
    attribution: canonical.attribution,
    evidenceOrigin: canonical.evidenceOrigin,
    evaluatorSemanticsId: canonical.evaluatorSemanticsId,
    semanticIdentity: canonical.semanticIdentity,
    independenceGroupId: canonical.independenceGroupId,
    actor: canonical.actor,
    source: canonical.source,
    reason: canonical.reason,
    occurredAt: canonical.occurredAt,
    links: canonical.links
  }));
};

const eventHash = (event: Omit<ResearchMemorySemanticEvent, "hash">): string =>
  sha256(`${event.sequence}\n${event.previousHash}\n${canonicalResearchJson({ ...event, hash: undefined })}`);

export function appendResearchMemorySemanticEvent(
  records: readonly ResearchMemorySemanticEvent[],
  input: ResearchMemorySemanticInput
): readonly ResearchMemorySemanticEvent[] {
  replayResearchMemorySemanticEvents(records);
  const canonical = canonicalInput(input);
  const identity = researchMemorySemanticIdentity(canonical);
  const existing = records.find((record) => record.identity === identity);
  if (existing) return records;
  if (records.some((record) => record.artifactSha256 === canonical.artifactSha256 && record.semanticIdentity === canonical.semanticIdentity && record.identity !== identity)) {
    throw new Error("research memory semantic identity conflict");
  }
  const sequence = records.length + 1;
  const previousHash = records.at(-1)?.hash ?? genesis;
  const event = Object.freeze({ ...canonical, sequence, identity, previousHash });
  return Object.freeze([...records, Object.freeze({ ...event, hash: eventHash(event) })]);
}

export function replayResearchMemorySemanticEvents(records: readonly ResearchMemorySemanticEvent[]): readonly ResearchMemorySemanticEvent[] {
  let previousHash = genesis;
  const identities = new Set<string>();
  records.forEach((record, index) => {
    canonicalInput(record);
    if (record.sequence !== index + 1 || record.previousHash !== previousHash) throw new Error("research memory semantic chain integrity violation");
    if (record.identity !== researchMemorySemanticIdentity(record)) throw new Error("research memory semantic identity integrity violation");
    if (record.hash !== eventHash(record)) throw new Error("research memory semantic hash integrity violation");
    if (identities.has(record.identity)) throw new Error("duplicate research memory semantic identity");
    identities.add(record.identity);
    previousHash = record.hash;
  });
  return Object.freeze([...records]);
}

export const isCanonicalEmpiricalResearchMemoryEvidence = (event: ResearchMemorySemanticEvent): boolean =>
  event.semanticClass === "EVIDENCE" &&
  event.validity === "CURRENT" &&
  (event.evidenceOrigin === "CANONICAL_RESEARCH" || event.evidenceOrigin === "PAPER_FORWARD");
