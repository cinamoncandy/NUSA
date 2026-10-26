import { createHash } from "node:crypto";
import {
  classifyResearchIntelligenceRelation,
  createAxiomResearchIntelligenceHandoff,
  createResearchIntelligenceRecord,
  markResearchIntelligenceReadyForAxiom,
  reclassifyResearchIntelligenceRecord,
  type AxiomResearchIntelligenceHandoff,
  type ResearchIntelligenceRecord,
} from "../../../packages/contracts/src/researchIntelligence";
import {
  carryResearchIntelligenceSourceAuthentication,
  deriveCanonicalArxivInterpretation,
  fetchResearchIntelligenceSourceCapture,
  issueResearchIntelligenceSourceVerificationReceipt,
  isResearchIntelligenceSourceRecordAuthenticated,
} from "../../../packages/contracts/src/researchIntelligenceVerificationInternal";

import {
  summarizeJevResearchAttentionShadows,
  type JevResearchAttentionAxiomOutcome,
  type JevResearchAttentionShadowReceipt,
} from "./ai/jevResearchAttentionShadow";
import { projectJevResearchAttentionDomainObservation } from "./ai/jevDomainObservationProjection";
import type { JevDomainObservation } from "./ai/jevDomainObservation";

export interface ResearchIntelligenceAttentionShadowObserver {
  observe(
    record: ResearchIntelligenceRecord,
    axiomHandoffOutcome: JevResearchAttentionAxiomOutcome,
  ): Promise<JevResearchAttentionShadowReceipt>;
}

export interface ResearchIntelligenceCollector {
  readonly sourceId: string;
  collect(): Promise<readonly ResearchIntelligenceRecord[]>;
}

export interface ResearchIntelligenceMemory {
  list(): readonly ResearchIntelligenceRecord[];
  get(recordId: string): ResearchIntelligenceRecord | null;
  append(record: ResearchIntelligenceRecord): ResearchIntelligenceRecord;
}

export interface ResearchIntelligenceScoutResult {
  readonly discovered: number;
  readonly accepted: number;
  readonly duplicatesSuppressed: number;
  readonly axiomHandoffs: readonly AxiomResearchIntelligenceHandoff[];
  readonly records: readonly ResearchIntelligenceRecord[];
  readonly jevAttentionShadows: readonly JevResearchAttentionShadowReceipt[];
  /** Canonical metadata-only Jev envelopes; never used for AXIOM routing. */
  readonly jevDomainObservations: readonly JevDomainObservation[];
  readonly jevAttentionMetrics: Readonly<{
    evaluated: number;
    reviewSoon: number;
    defer: number;
    escalateUncertain: number;
    fallbackApplied: number;
  }>;
  readonly sourceErrors: readonly Readonly<{
    sourceId: string;
    reason: string;
  }>[];
  readonly authority: "PAPER_ONLY";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

export interface ArxivResearchIntelligenceCollectorOptions {
  readonly maxResults?: number;
  readonly searchQuery?: string;
}

const DEFAULT_ARXIV_QUERY = [
  'all:"algorithmic trading"',
  'all:"market microstructure"',
  'all:"reinforcement learning trading"',
  'all:"portfolio optimization"',
  'all:"transaction cost"',
  'all:"limit order book"',
].join(" OR ");

const normalizeWhitespace = (value: string): string =>
  value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

function textTag(entry: string, tag: string): string {
  const match = entry.match(new RegExp("<" + tag + "\\b[^>]*>([\\s\\S]*?)<\\/" + tag + ">", "i"));
  return match == null ? "" : decodeXml(normalizeWhitespace(match[1] ?? ""));
}

function allTextTags(entry: string, tag: string): readonly string[] {
  const expression = new RegExp("<" + tag + "\\b[^>]*>([\\s\\S]*?)<\\/" + tag + ">", "gi");
  const values: string[] = [];
  for (const match of entry.matchAll(expression)) {
    const value = decodeXml(normalizeWhitespace(match[1] ?? ""));
    if (value) values.push(value);
  }
  return Object.freeze(values);
}

function normalizeArxivUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("http://arxiv.org/")) return "https://" + trimmed.slice("http://".length);
  if (trimmed.startsWith("http://export.arxiv.org/")) return "https://" + trimmed.slice("http://".length);
  return trimmed;
}

function arxivSourceId(entryId: string): string {
  const match = entryId.match(/arxiv\.org\/abs\/([^?#]+)/i);
  if (match?.[1]) return "arxiv:" + match[1].replace(/v\d+$/i, "");
  throw new Error("arXiv entry id is missing a canonical identifier");
}

export class ArxivResearchIntelligenceCollector implements ResearchIntelligenceCollector {
  public readonly sourceId = "arxiv";
  private readonly maxResults: number;
  private readonly searchQuery: string;

  public constructor(options: ArxivResearchIntelligenceCollectorOptions = {}) {
    this.maxResults = options.maxResults ?? 20;
    this.searchQuery = options.searchQuery ?? DEFAULT_ARXIV_QUERY;
    if (!Number.isSafeInteger(this.maxResults) || this.maxResults < 1 || this.maxResults > 100) {
      throw new Error("arXiv maxResults must be between 1 and 100");
    }
  }

  public async collect(): Promise<readonly ResearchIntelligenceRecord[]> {
    const url = new URL("https://export.arxiv.org/api/query");
    url.searchParams.set("search_query", "(" + this.searchQuery + ")");
    url.searchParams.set("start", "0");
    url.searchParams.set("max_results", String(this.maxResults));
    url.searchParams.set("sortBy", "submittedDate");
    url.searchParams.set("sortOrder", "descending");

    const capture = await fetchResearchIntelligenceSourceCapture(url.toString(), "ARXIV_API_V1");
    const xml = capture.responseBody;
    if (!xml.includes("<feed") || !xml.includes("<entry")) {
      throw new Error("arXiv response is not a usable Atom feed");
    }

    const discoveredAt = capture.capturedAt;
    const records: ResearchIntelligenceRecord[] = [];
    for (const match of xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)) {
      const entry = match[0];
      const entryId = normalizeArxivUrl(textTag(entry, "id"));
      const title = textTag(entry, "title");
      const summary = textTag(entry, "summary");
      const publishedAt = textTag(entry, "published");
      const authors = allTextTags(entry, "name");
      if (!entryId || !title || !summary || !publishedAt || authors.length === 0) continue;

      const interpretation = deriveCanonicalArxivInterpretation(title, summary);
      const rawContentSha256 = createHash("sha256").update(entry, "utf8").digest("hex");
      const unverifiedRecord = createResearchIntelligenceRecord({
          sourceId: arxivSourceId(entryId),
          sourceType: "ARXIV",
          sourceUrl: entryId,
          sourceVerification: "UNVERIFIED",
          title,
          authors,
          publishedAt,
          discoveredAt,
          rawContentSha256,
          ...interpretation,
          claimedContribution: summary,
          validationStatus: "DISCOVERED",
        });
      records.push(issueResearchIntelligenceSourceVerificationReceipt(unverifiedRecord, capture, entry));
    }

    return Object.freeze(records.sort((left, right) => {
      const published = Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
      return published !== 0 ? published : left.recordId.localeCompare(right.recordId);
    }));
  }
}

export class ResearchIntelligenceScout {
  public constructor(
    private readonly collectors: readonly ResearchIntelligenceCollector[],
    private readonly memory?: ResearchIntelligenceMemory,
    private readonly attentionObserver?: ResearchIntelligenceAttentionShadowObserver,
  ) {
    if (collectors.length === 0) throw new Error("at least one research intelligence collector is required");
    if (new Set(collectors.map((collector) => collector.sourceId)).size !== collectors.length) {
      throw new Error("research intelligence collector sourceId must be unique");
    }
  }

  public async run(
    existing: readonly ResearchIntelligenceRecord[] = [],
  ): Promise<ResearchIntelligenceScoutResult> {
    const historical = Object.freeze([
      ...(this.memory?.list() ?? []),
      ...existing,
    ]);
    const records: ResearchIntelligenceRecord[] = [];
    const axiomHandoffs: AxiomResearchIntelligenceHandoff[] = [];
    const jevAttentionShadows: JevResearchAttentionShadowReceipt[] = [];
    const jevDomainObservations: JevDomainObservation[] = [];
    const sourceErrors: Array<{ sourceId: string; reason: string }> = [];
    let discovered = 0;
    let duplicatesSuppressed = 0;

    const observeAttention = async (
      record: ResearchIntelligenceRecord,
      axiomHandoffOutcome: JevResearchAttentionAxiomOutcome,
    ): Promise<void> => {
      if (this.attentionObserver == null) return;
      try {
        const receipt = await this.attentionObserver.observe(record, axiomHandoffOutcome);
        jevAttentionShadows.push(receipt);
        jevDomainObservations.push(projectJevResearchAttentionDomainObservation(receipt));
      } catch {
        // Shadow must never interrupt the canonical deterministic path.
      }
    };

    for (const collector of this.collectors) {
      let collected: readonly ResearchIntelligenceRecord[];
      try {
        collected = await collector.collect();
      } catch (error) {
        sourceErrors.push({
          sourceId: collector.sourceId,
          reason: error instanceof Error ? error.message : "UNKNOWN_COLLECTOR_FAILURE",
        });
        continue;
      }

      discovered += collected.length;
      for (const candidate of collected) {
        const classification = classifyResearchIntelligenceRelation(
          candidate,
          Object.freeze([...historical, ...records]),
        );
        let record = carryResearchIntelligenceSourceAuthentication(
          candidate,
          reclassifyResearchIntelligenceRecord(candidate, classification),
        );

        if (record.novelty === "DUPLICATE") {
          duplicatesSuppressed += 1;
          record = this.memory?.append(record) ?? record;
          records.push(record);
          continue;
        }

        // Keep medium/low relevance discoveries observable without flooding AXIOM.
        // Until a canonical evidence-backed priority model exists, only HIGH relevance may hand off.
        if (record.nusaRelevance !== "HIGH") {
          record = this.memory?.append(record) ?? record;
          records.push(record);
          await observeAttention(record, "NOT_HANDOFF");
          continue;
        }

        let handoffOutcome: JevResearchAttentionAxiomOutcome = "HANDOFF_FAILED_CLOSED";
        try {
          if (!isResearchIntelligenceSourceRecordAuthenticated(record)) {
            throw new Error("canonical source capture receipt is required before AXIOM handoff");
          }
          const handoff = createAxiomResearchIntelligenceHandoff(record);
          record = carryResearchIntelligenceSourceAuthentication(record, markResearchIntelligenceReadyForAxiom(record));
          axiomHandoffs.push(handoff);
          handoffOutcome = "HANDOFF";
        } catch {
          // Fail closed. Source discovery remains observable, but no handoff is fabricated.
        }
        record = this.memory?.append(record) ?? record;
        records.push(record);
        await observeAttention(record, handoffOutcome);
      }
    }

    return Object.freeze({
      discovered,
      accepted: records.length - duplicatesSuppressed,
      duplicatesSuppressed,
      axiomHandoffs: Object.freeze(axiomHandoffs),
      records: Object.freeze(records),
      jevAttentionShadows: Object.freeze(jevAttentionShadows),
      jevDomainObservations: Object.freeze(jevDomainObservations),
      jevAttentionMetrics: summarizeJevResearchAttentionShadows(
        Object.freeze(jevAttentionShadows),
      ),
      sourceErrors: Object.freeze(sourceErrors.map((error) => Object.freeze(error))),
      authority: "PAPER_ONLY" as const,
      liveAuthority: "NONE" as const,
      productionMutationAllowed: false as const,
      aiAuthority: "ZERO_AUTHORITY" as const,
    });
  }
}
