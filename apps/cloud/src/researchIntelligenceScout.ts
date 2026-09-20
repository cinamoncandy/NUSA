import { createHash } from "node:crypto";
import {
  classifyResearchIntelligenceRelation,
  createAxiomResearchIntelligenceHandoff,
  createResearchIntelligenceRecord,
  markResearchIntelligenceReadyForAxiom,
  reclassifyResearchIntelligenceRecord,
  type AxiomResearchIntelligenceHandoff,
  type ResearchIntelligenceRecord,
  type ResearchIntelligenceRelevance,
} from "../../../packages/contracts/src/researchIntelligence";

export interface ResearchIntelligenceCollector {
  readonly sourceId: string;
  collect(): Promise<readonly ResearchIntelligenceRecord[]>;
}

export interface ResearchIntelligenceScoutResult {
  readonly discovered: number;
  readonly accepted: number;
  readonly duplicatesSuppressed: number;
  readonly axiomHandoffs: readonly AxiomResearchIntelligenceHandoff[];
  readonly records: readonly ResearchIntelligenceRecord[];
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
  readonly fetchFn?: typeof fetch;
  readonly now?: () => Date;
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

function classifyTopics(text: string): readonly string[] {
  const normalized = text.toLowerCase();
  const rules: readonly [string, RegExp][] = [
    ["reinforcement-learning", /\breinforcement learning\b|\bppo\b|\bsac\b|\bddpg\b|\btd3\b|\ba2c\b/],
    ["market-microstructure", /market microstructure|limit order book|order book/],
    ["execution", /trade execution|order execution|execution algorithm|market impact|slippage|transaction cost|almgren|square-root law/],
    ["portfolio-risk", /portfolio optimization|portfolio allocation|risk management|drawdown/],
    ["time-series", /time[- ]series|forecasting|sequence model|transformer|state space/],
    ["statistical-arbitrage", /statistical arbitrage|mean reversion|pairs trading/],
    ["volatility", /volatility|variance|stochastic volatility/],
    ["crypto", /crypto|bitcoin|ethereum|digital asset/],
    ["llm-agents", /\bllm\b|large language model|multi-agent|agentic/],
  ];
  const topics = rules.filter(([, pattern]) => pattern.test(normalized)).map(([topic]) => topic);
  return Object.freeze(topics.length > 0 ? topics : ["quantitative-finance"]);
}

function classifyMethod(text: string): string {
  const normalized = text.toLowerCase();
  if (/\breinforcement learning\b|\bppo\b|\bsac\b|\bddpg\b|\btd3\b|\ba2c\b/.test(normalized)) {
    return "reinforcement-learning";
  }
  if (/limit order book|order book/.test(normalized)) return "order-book-modeling";
  if (/market impact|trade execution|order execution|execution algorithm|slippage|transaction cost/.test(normalized)) return "execution-cost-modeling";
  if (/transformer|state space|sequence model/.test(normalized)) return "sequence-modeling";
  if (/portfolio optimization|portfolio allocation/.test(normalized)) return "portfolio-optimization";
  if (/statistical arbitrage|mean reversion|pairs trading/.test(normalized)) return "statistical-arbitrage";
  return "quantitative-research";
}

function classifyRelevance(text: string): ResearchIntelligenceRelevance {
  const normalized = text.toLowerCase();
  const financialAnchor =
    /\btrading\b|quantitative finance|financial market|stock market|capital market|market microstructure|limit order book|order book|bid[- ]ask|portfolio optimization|asset allocation|market impact|transaction cost|slippage|liquidity|automated market mak|prediction market|\bclob\b|\bamm\b|\bstock\b|\bequity\b|asset pricing|\bcrypto(?:currency)?\b|\bbitcoin\b|\bethereum\b/;
  if (!financialAnchor.test(normalized)) return "LOW";

  const direct = [
    /algorithmic trading|quantitative trading|systematic trading/,
    /market microstructure|limit order book|order book|bid[- ]ask/,
    /market impact|slippage|transaction cost|trade execution|order execution/,
    /reinforcement learning.{0,100}(trad|market|portfolio)|(?:trad|market|portfolio).{0,100}reinforcement learning/,
    /portfolio optimization|asset allocation/,
    /statistical arbitrage|pairs trading|mean reversion/,
    /automated market mak|prediction market|\bclob\b|\bamm\b/,
  ].filter((pattern) => pattern.test(normalized)).length;

  if (direct >= 2) return "HIGH";
  if (direct === 1) return "MEDIUM";
  return "LOW";
}

function testableReplicationHypothesis(title: string): string {
  return (
    'Under NUSA canonical point-in-time, leakage-controlled, transaction-cost-aware OOS validation, ' +
    'an independent reproduction of the source methodology "' +
    title.replace(/\s+/g, " ").trim() +
    '" will preserve the claimed directional effect relative to the source-stated baseline; otherwise the claim is rejected or remains insufficient.'
  );
}

export class ArxivResearchIntelligenceCollector implements ResearchIntelligenceCollector {
  public readonly sourceId = "arxiv";
  private readonly fetchFn: typeof fetch;
  private readonly now: () => Date;
  private readonly maxResults: number;
  private readonly searchQuery: string;

  public constructor(options: ArxivResearchIntelligenceCollectorOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? (() => new Date());
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

    const response = await this.fetchFn(url, {
      method: "GET",
      headers: Object.freeze({
        Accept: "application/atom+xml",
        "User-Agent": "NUSA-Research-Intelligence/1.0 (PAPER_ONLY; research provenance collector)",
      }),
      redirect: "follow",
    });
    if (!response.ok) throw new Error("arXiv request failed with HTTP " + response.status);
    const xml = await response.text();
    if (!xml.includes("<feed") || !xml.includes("<entry")) {
      throw new Error("arXiv response is not a usable Atom feed");
    }

    const discoveredAt = this.now().toISOString();
    const records: ResearchIntelligenceRecord[] = [];
    for (const match of xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)) {
      const entry = match[0];
      const entryId = normalizeArxivUrl(textTag(entry, "id"));
      const title = textTag(entry, "title");
      const summary = textTag(entry, "summary");
      const publishedAt = textTag(entry, "published");
      const authors = allTextTags(entry, "name");
      if (!entryId || !title || !summary || !publishedAt || authors.length === 0) continue;

      const combined = title + "\n" + summary;
      const rawContentSha256 = createHash("sha256").update(entry, "utf8").digest("hex");
      records.push(
        createResearchIntelligenceRecord({
          sourceId: arxivSourceId(entryId),
          sourceType: "ARXIV",
          sourceUrl: entryId,
          sourceVerification: "VERIFIED_PRIMARY_SOURCE",
          title,
          authors,
          publishedAt,
          discoveredAt,
          rawContentSha256,
          topic: classifyTopics(combined),
          market: "UNSPECIFIED",
          timeframe: "UNSPECIFIED",
          method: classifyMethod(combined),
          claimedContribution: summary,
          testableHypothesis: testableReplicationHypothesis(title),
          assumptions: [
            "Source claims remain unverified until canonical NUSA replication.",
            "Dataset, evaluator, benchmark, cost and execution semantics must be reconstructed from the source before protected validation.",
          ],
          requiredData: [
            "Source-described dataset or a provenance-equivalent NUSA dataset.",
            "Canonical point-in-time market data and transaction-cost/execution evidence.",
          ],
          codeAvailable: /github\.com|code (?:is )?available|open[- ]source/i.test(combined)
            ? "AVAILABLE"
            : "UNKNOWN",
          datasetAvailable: "UNKNOWN",
          reproducibilityStatus: "NOT_ATTEMPTED",
          evidenceQuality: /github\.com|code (?:is )?available|open[- ]source/i.test(combined)
            ? "CODE_AVAILABLE_UNVERIFIED"
            : "PRIMARY_SOURCE_CLAIM_ONLY",
          nusaRelevance: classifyRelevance(combined),
          implementationCost: "UNKNOWN",
          expectedEconomicValue: "UNKNOWN",
          leakageRisk: "UNKNOWN",
          overfittingRisk: "UNKNOWN",
          regimeDependence: "UNKNOWN",
          transactionCostSensitivity: "UNKNOWN",
          validationStatus: "SOURCE_VERIFIED",
        }),
      );
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
  ) {
    if (collectors.length === 0) throw new Error("at least one research intelligence collector is required");
    if (new Set(collectors.map((collector) => collector.sourceId)).size !== collectors.length) {
      throw new Error("research intelligence collector sourceId must be unique");
    }
  }

  public async run(
    existing: readonly ResearchIntelligenceRecord[] = [],
  ): Promise<ResearchIntelligenceScoutResult> {
    const records: ResearchIntelligenceRecord[] = [];
    const axiomHandoffs: AxiomResearchIntelligenceHandoff[] = [];
    const sourceErrors: Array<{ sourceId: string; reason: string }> = [];
    let discovered = 0;
    let duplicatesSuppressed = 0;

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
          Object.freeze([...existing, ...records]),
        );
        let record = reclassifyResearchIntelligenceRecord(candidate, classification);

        if (record.novelty === "DUPLICATE") {
          duplicatesSuppressed += 1;
          records.push(record);
          continue;
        }

        // Keep medium/low relevance discoveries observable without flooding AXIOM.
        // Until a canonical evidence-backed priority model exists, only HIGH relevance may hand off.
        if (record.nusaRelevance !== "HIGH") {
          records.push(record);
          continue;
        }

        try {
          const handoff = createAxiomResearchIntelligenceHandoff(record);
          record = markResearchIntelligenceReadyForAxiom(record);
          axiomHandoffs.push(handoff);
        } catch {
          // Fail closed. Source discovery remains observable, but no handoff is fabricated.
        }
        records.push(record);
      }
    }

    return Object.freeze({
      discovered,
      accepted: records.length - duplicatesSuppressed,
      duplicatesSuppressed,
      axiomHandoffs: Object.freeze(axiomHandoffs),
      records: Object.freeze(records),
      sourceErrors: Object.freeze(sourceErrors.map((error) => Object.freeze(error))),
      authority: "PAPER_ONLY" as const,
      liveAuthority: "NONE" as const,
      productionMutationAllowed: false as const,
      aiAuthority: "ZERO_AUTHORITY" as const,
    });
  }
}
