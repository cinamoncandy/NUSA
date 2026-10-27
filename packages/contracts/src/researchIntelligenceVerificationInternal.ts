import { createHash } from "node:crypto";
import { canonicalResearchJson } from "./researchRuntime";
import type {
  ResearchIntelligenceRecord,
  ResearchIntelligenceSourceVerificationReceipt,
} from "./researchIntelligence";
import type { ResearchIntelligenceAvailability, ResearchIntelligenceEstimate, ResearchIntelligenceEvidenceQuality, ResearchIntelligenceRelevance, ResearchIntelligenceReproducibility } from "./researchIntelligence";

/**
 * Internal collector-to-store capability. This module is intentionally not re-exported from
 * the contracts package entry point. Public record factories cannot mint this capability.
 */
const issuedSourceRecords = new WeakSet<object>();
const verifiedResponseCaptures = new WeakSet<object>();
const sha256 = (value: unknown): string =>
  createHash("sha256").update(canonicalResearchJson(value), "utf8").digest("hex");
const rawSha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const validSha256 = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
const normalizedText = (value: string): string => value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function decodeXmlText(value: string): string {
  return normalizedText(value)
    .replace(/&(lt|gt|quot|apos|amp);/g, (_match, name: string) => ({ lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" })[name]!)
    .replace(/&#(\d+);/g, (_match, code: string) => {
      try { return String.fromCodePoint(Number(code)); } catch { throw new Error("ARXIV_SOURCE_CAPTURE_XML_INVALID"); }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => {
      try { return String.fromCodePoint(parseInt(code, 16)); } catch { throw new Error("ARXIV_SOURCE_CAPTURE_XML_INVALID"); }
    });
}

function tagValues(xml: string, tag: string): string[] {
  const expression = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, "gi");
  return [...xml.matchAll(expression)].map((match) => decodeXmlText(match[1] ?? ""));
}

function oneTag(xml: string, tag: string): string {
  const values = tagValues(xml, tag);
  if (values.length !== 1 || values[0] === "") throw new Error("ARXIV_SOURCE_CAPTURE_ENTRY_INVALID");
  return values[0]!;
}

function sourcePaperId(value: string): string | undefined {
  let url: URL;
  try { url = new URL(value); } catch { return undefined; }
  if (!["http:", "https:"].includes(url.protocol) || url.hostname.toLowerCase() !== "arxiv.org"
    || url.username || url.password || url.search || url.hash) return undefined;
  const match = /^\/abs\/([^/]+)$/.exec(url.pathname);
  return match?.[1]?.replace(/v\d+$/i, "");
}

function sourceEntryBinding(record: ResearchIntelligenceRecord): string {
  return sha256({
    sourceId: record.sourceId, sourceType: record.sourceType, sourceUrl: record.sourceUrl,
    title: record.title, authors: record.authors, publishedAt: record.publishedAt,
    discoveredAt: record.discoveredAt, rawContentSha256: record.rawContentSha256.toLowerCase(),
    claimedContribution: record.claimedContribution,
  });
}

const ARXIV_ASSUMPTIONS = Object.freeze([
  "Source claims remain unverified until canonical NUSA replication.",
  "Dataset, evaluator, benchmark, cost and execution semantics must be reconstructed from the source before protected validation.",
].sort((left, right) => left.localeCompare(right)));
const ARXIV_REQUIRED_DATA = Object.freeze([
  "Source-described dataset or a provenance-equivalent NUSA dataset.",
  "Canonical point-in-time market data and transaction-cost/execution evidence.",
].sort((left, right) => left.localeCompare(right)));

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
  return Object.freeze((topics.length > 0 ? topics : ["quantitative-finance"]).sort((left, right) => left.localeCompare(right)));
}

function classifyMethod(text: string): string {
  const normalized = text.toLowerCase();
  if (/\breinforcement learning\b|\bppo\b|\bsac\b|\bddpg\b|\btd3\b|\ba2c\b/.test(normalized)) return "reinforcement-learning";
  if (/limit order book|order book/.test(normalized)) return "order-book-modeling";
  if (/market impact|trade execution|order execution|execution algorithm|slippage|transaction cost/.test(normalized)) return "execution-cost-modeling";
  if (/transformer|state space|sequence model/.test(normalized)) return "sequence-modeling";
  if (/portfolio optimization|portfolio allocation/.test(normalized)) return "portfolio-optimization";
  if (/statistical arbitrage|mean reversion|pairs trading/.test(normalized)) return "statistical-arbitrage";
  return "quantitative-research";
}

function classifyRelevance(text: string): ResearchIntelligenceRelevance {
  const normalized = text.toLowerCase();
  const strongFinancialAnchor = /algorithmic trading|quantitative trading|systematic trading|\btrading\b|quantitative finance|financial market|stock market|capital market|market microstructure|limit order book|order book|bid[- ]ask|market impact|transaction cost|slippage|trade execution|order execution|liquidity|automated market mak|prediction market|\bclob\b|\bamm\b|\bstock\b|\bequity\b|asset pricing|\bcrypto(?:currency)?\b|\bbitcoin\b|\bethereum\b|order flow|sharpe|drawdown/;
  const portfolioFinancialContext = /(portfolio optimization|asset allocation)/.test(normalized) && /asset|investment|return|risk|financial|stock|equity|crypto|sharpe|drawdown|volatility/.test(normalized);
  if (!strongFinancialAnchor.test(normalized) && !portfolioFinancialContext) return "LOW";
  const highSignal = /algorithmic trading|quantitative trading|systematic trading|reinforcement learning.{0,120}trading|trading.{0,120}reinforcement learning|market microstructure|limit order book|order book|market impact|trade execution|order execution|statistical arbitrage|pairs trading|automated market mak|\bclob\b|\bamm\b|order flow|equity index forecasting|high[- ]frequency swapping/;
  return highSignal.test(normalized) ? "HIGH" : "MEDIUM";
}

function testableReplicationHypothesis(title: string): string {
  return 'Under NUSA canonical point-in-time, leakage-controlled, transaction-cost-aware OOS validation, an independent reproduction of the source methodology "'
    + title.replace(/\s+/g, " ").trim()
    + '" will preserve the claimed directional effect relative to the source-stated baseline; otherwise the claim is rejected or remains insufficient.';
}

export interface CanonicalArxivInterpretation {
  readonly topic: readonly string[];
  readonly market: "UNSPECIFIED";
  readonly timeframe: "UNSPECIFIED";
  readonly method: string;
  readonly testableHypothesis: string;
  readonly assumptions: readonly string[];
  readonly requiredData: readonly string[];
  readonly codeAvailable: ResearchIntelligenceAvailability;
  readonly datasetAvailable: ResearchIntelligenceAvailability;
  readonly reproducibilityStatus: ResearchIntelligenceReproducibility;
  readonly evidenceQuality: ResearchIntelligenceEvidenceQuality;
  readonly nusaRelevance: ResearchIntelligenceRelevance;
  readonly implementationCost: ResearchIntelligenceEstimate;
  readonly expectedEconomicValue: ResearchIntelligenceEstimate;
  readonly leakageRisk: ResearchIntelligenceEstimate;
  readonly overfittingRisk: ResearchIntelligenceEstimate;
  readonly regimeDependence: ResearchIntelligenceEstimate;
  readonly transactionCostSensitivity: ResearchIntelligenceEstimate;
}

export function deriveCanonicalArxivInterpretation(title: string, summary: string): CanonicalArxivInterpretation {
  const combined = `${title}\n${summary}`;
  const codeAvailable: ResearchIntelligenceAvailability = /github\.com|code (?:is )?available|open[- ]source/i.test(combined) ? "AVAILABLE" : "UNKNOWN";
  return Object.freeze({
    topic: classifyTopics(combined), market: "UNSPECIFIED", timeframe: "UNSPECIFIED", method: classifyMethod(combined),
    testableHypothesis: testableReplicationHypothesis(title), assumptions: ARXIV_ASSUMPTIONS, requiredData: ARXIV_REQUIRED_DATA,
    codeAvailable, datasetAvailable: "UNKNOWN", reproducibilityStatus: "NOT_ATTEMPTED",
    evidenceQuality: (codeAvailable === "AVAILABLE" ? "CODE_AVAILABLE_UNVERIFIED" : "PRIMARY_SOURCE_CLAIM_ONLY") as ResearchIntelligenceEvidenceQuality,
    nusaRelevance: classifyRelevance(combined), implementationCost: "UNKNOWN", expectedEconomicValue: "UNKNOWN",
    leakageRisk: "UNKNOWN", overfittingRisk: "UNKNOWN", regimeDependence: "UNKNOWN", transactionCostSensitivity: "UNKNOWN",
  });
}

function validateCompleteArxivEntry(
  record: ResearchIntelligenceRecord,
  capture: VerifiedResearchIntelligenceResponseCapture,
  rawContent: string,
  capturedAt: string,
): void {
  const entries = [...capture.responseBody.matchAll(/<entry\b[^>]*>[\s\S]*?<\/entry\s*>/gi)].map((match) => match[0]);
  if (!/^<entry\b[^>]*>[\s\S]*<\/entry\s*>$/i.test(rawContent.trim())
    || (rawContent.match(/<entry\b/gi) ?? []).length !== 1
    || (rawContent.match(/<\/entry\s*>/gi) ?? []).length !== 1) {
    throw new Error("ARXIV_SOURCE_CAPTURE_ENTRY_INVALID");
  }
  const matchingEntries = entries.filter((entry) => {
    try { return sourcePaperId(oneTag(entry, "id")) === record.sourceId.slice("arxiv:".length); }
    catch { return false; }
  });
  if (matchingEntries.length !== 1 || matchingEntries[0] !== rawContent) {
    throw new Error("ARXIV_SOURCE_CAPTURE_ENTRY_MISMATCH");
  }
  const id = oneTag(rawContent, "id");
  const publishedAt = oneTag(rawContent, "published");
  const title = oneTag(rawContent, "title");
  const summary = oneTag(rawContent, "summary");
  const authors = [...rawContent.matchAll(/<author\b[^>]*>([\s\S]*?)<\/author\s*>/gi)]
    .map((match) => oneTag(match[1] ?? "", "name"))
    .sort((a, b) => a.localeCompare(b));
  const paperId = sourcePaperId(id);
  const recordPaperId = sourcePaperId(record.sourceUrl);
  const publishedMs = Date.parse(publishedAt);
  const expectedInterpretation = deriveCanonicalArxivInterpretation(title, summary);
  const actualInterpretation = {
    topic: record.topic, market: record.market, timeframe: record.timeframe, method: record.method,
    testableHypothesis: record.testableHypothesis, assumptions: record.assumptions, requiredData: record.requiredData,
    codeAvailable: record.codeAvailable, datasetAvailable: record.datasetAvailable,
    reproducibilityStatus: record.reproducibilityStatus, evidenceQuality: record.evidenceQuality,
    nusaRelevance: record.nusaRelevance, implementationCost: record.implementationCost,
    expectedEconomicValue: record.expectedEconomicValue, leakageRisk: record.leakageRisk,
    overfittingRisk: record.overfittingRisk, regimeDependence: record.regimeDependence,
    transactionCostSensitivity: record.transactionCostSensitivity,
  };
  if (!paperId || paperId !== record.sourceId.slice("arxiv:".length) || recordPaperId !== paperId
    || record.sourceType !== "ARXIV" || record.title !== title
    || canonicalResearchJson(record.authors) !== canonicalResearchJson([...new Set(authors)])
    || !Number.isFinite(publishedMs) || new Date(publishedMs).toISOString() !== record.publishedAt
    || record.claimedContribution !== summary || Date.parse(record.discoveredAt) > Date.parse(capturedAt)
    || Date.parse(record.discoveredAt) < publishedMs || rawSha256(rawContent) !== record.rawContentSha256.toLowerCase()
    || canonicalResearchJson(actualInterpretation) !== canonicalResearchJson(expectedInterpretation)) {
    throw new Error("ARXIV_SOURCE_CAPTURE_RECORD_MISMATCH");
  }
}

function canonicalUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("source capture URL is invalid");
  return url;
}

function validateCaptureSource(record: ResearchIntelligenceRecord, verifierId: string, requestUrl: string, responseUrl: string): void {
  const source = canonicalUrl(record.sourceUrl);
  const request = canonicalUrl(requestUrl);
  const response = canonicalUrl(responseUrl);
  if (verifierId === "ARXIV_API_V1") {
    const match = /^\/abs\/([^/]+)$/.exec(source.pathname);
    const paperId = match?.[1]?.replace(/v\d+$/i, "");
    if (record.sourceType !== "ARXIV"
      || !record.sourceId.startsWith("arxiv:")
      || record.sourceId !== `arxiv:${paperId}`
      || source.hostname !== "arxiv.org"
      || request.origin !== "https://export.arxiv.org"
      || request.pathname !== "/api/query"
      || response.origin !== "https://export.arxiv.org"
      || response.pathname !== "/api/query") {
      throw new Error("ARXIV_SOURCE_CAPTURE_MISMATCH");
    }
    return;
  }
  throw new Error("SOURCE_CAPTURE_VERIFIER_UNSUPPORTED");
}

export function issueResearchIntelligenceSourceVerificationReceipt(
  record: ResearchIntelligenceRecord,
  capture: VerifiedResearchIntelligenceResponseCapture,
  rawContent: string,
): ResearchIntelligenceRecord {
  if (!capture || typeof capture !== "object" || !verifiedResponseCaptures.has(capture)) {
    throw new Error("RESEARCH_INTELLIGENCE_SOURCE_CAPTURE_INVALID");
  }
  if (!record || record.sourceVerification !== "UNVERIFIED" || record.validationStatus !== "DISCOVERED"
    || record.sourceVerificationReceipt !== undefined || record.novelty !== "NEW" || record.relatedExistingResearch.length !== 0
    || record.axiomHandoffStatus !== "NOT_READY" || record.failureReason !== undefined
    || rawSha256(rawContent) !== record.rawContentSha256.toLowerCase()
    || !validSha256(capture.responseBody.length > 0 ? rawSha256(capture.responseBody) : "")
    || !Number.isFinite(Date.parse(capture.capturedAt))
    || new Date(capture.capturedAt).toISOString() !== capture.capturedAt
    || Date.parse(capture.capturedAt) !== Date.parse(record.discoveredAt)) {
    throw new Error("RESEARCH_INTELLIGENCE_SOURCE_CAPTURE_INVALID");
  }
  validateCaptureSource(record, capture.verifierId, capture.requestUrl, capture.responseUrl);
  validateCompleteArxivEntry(record, capture, rawContent, capture.capturedAt);
  const core = Object.freeze({
    schemaVersion: 2 as const,
    verifierId: capture.verifierId,
    requestUrl: canonicalUrl(capture.requestUrl).toString(),
    responseUrl: canonicalUrl(capture.responseUrl).toString(),
    sourceEntrySnapshot: rawContent,
    sourceEntryFingerprint: rawSha256(rawContent),
    rawContentSha256: record.rawContentSha256.toLowerCase(),
    sourceEntryBindingFingerprint: sourceEntryBinding(record),
    capturedAt: capture.capturedAt,
  });
  const receipt = Object.freeze({ ...core, receiptFingerprint: sha256(core) });
  const verified = Object.freeze({
    ...record,
    sourceVerification: "VERIFIED_PRIMARY_SOURCE" as const,
    validationStatus: "SOURCE_VERIFIED" as const,
    sourceVerificationReceipt: receipt,
  });
  issuedSourceRecords.add(verified);
  return verified;
}

export interface VerifiedResearchIntelligenceResponseCapture {
  readonly verifierId: ResearchIntelligenceSourceVerificationReceipt["verifierId"];
  readonly requestUrl: string;
  readonly responseUrl: string;
  readonly responseBody: string;
  /** Stamped by the canonical fetch after the full response body is read; callers cannot supply it. */
  readonly capturedAt: string;
}

/** Fetches a public source itself; callers cannot mint a verified capture from supplied bytes. */
export async function fetchResearchIntelligenceSourceCapture(
  requestUrl: string,
  verifierId: ResearchIntelligenceSourceVerificationReceipt["verifierId"],
): Promise<VerifiedResearchIntelligenceResponseCapture> {
  const request = canonicalUrl(requestUrl);
  if (verifierId !== "ARXIV_API_V1" || request.origin !== "https://export.arxiv.org" || request.pathname !== "/api/query") {
    throw new Error("SOURCE_CAPTURE_VERIFIER_UNSUPPORTED");
  }
  const response = await fetch(request.toString(), {
    method: "GET",
    headers: {
      accept: "application/atom+xml, application/xml;q=0.9, text/xml;q=0.8",
      "user-agent": "NUSA-Research-Intelligence/1.0 (PAPER_ONLY; research provenance collector)",
    },
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`arXiv API returned HTTP ${response.status}`);
  const responseBody = await response.text();
  const capture = Object.freeze({
    verifierId,
    requestUrl: request.toString(),
    responseUrl: response.url || request.toString(),
    responseBody,
    capturedAt: new Date().toISOString(),
  });
  if (capture.responseBody.length === 0) throw new Error("SOURCE_CAPTURE_RESPONSE_EMPTY");
  verifiedResponseCaptures.add(capture);
  return capture;
}

/** Checks that durable receipt bytes are internally consistent; this is not an authenticator. */
export function validatePersistedResearchIntelligenceSourceReceiptIntegrity(record: ResearchIntelligenceRecord): boolean {
  if (!record || typeof record !== "object") return false;
  const receipt = record.sourceVerificationReceipt as (Omit<ResearchIntelligenceSourceVerificationReceipt, "schemaVersion"> & {
    readonly schemaVersion: number;
    readonly responseFingerprint?: string;
  }) | undefined;
  if (record.sourceVerification !== "VERIFIED_PRIMARY_SOURCE") {
    return record.validationStatus !== "SOURCE_VERIFIED" && receipt === undefined;
  }
  if (record.validationStatus !== "SOURCE_VERIFIED" || !receipt || receipt.schemaVersion !== 2
    && receipt.schemaVersion !== 1) return false;
  if (receipt.schemaVersion === 1) {
    if (!validSha256(receipt.responseFingerprint) || receipt.rawContentSha256 !== record.rawContentSha256.toLowerCase()
      || receipt.sourceEntryBindingFingerprint !== sourceEntryBinding(record)
      || !Number.isFinite(Date.parse(receipt.capturedAt)) || Date.parse(receipt.capturedAt) !== Date.parse(record.discoveredAt)
      || !validSha256(receipt.receiptFingerprint)) return false;
    try {
      validateCaptureSource(record, receipt.verifierId, receipt.requestUrl, receipt.responseUrl);
      const { receiptFingerprint, ...core } = receipt;
      return receiptFingerprint === sha256(core);
    } catch {
      return false;
    }
  }
  if (receipt.schemaVersion !== 2
    || typeof receipt.sourceEntrySnapshot !== "string" || receipt.sourceEntrySnapshot.trim() === ""
    || !validSha256(receipt.sourceEntryFingerprint) || rawSha256(receipt.sourceEntrySnapshot) !== receipt.sourceEntryFingerprint.toLowerCase()
    || receipt.rawContentSha256 !== record.rawContentSha256.toLowerCase()
    || receipt.sourceEntryFingerprint !== receipt.rawContentSha256
    || receipt.sourceEntryBindingFingerprint !== sourceEntryBinding(record)
    || !Number.isFinite(Date.parse(receipt.capturedAt)) || Date.parse(receipt.capturedAt) < Date.parse(record.discoveredAt)
    || !["NEW", "INCREMENTAL", "DUPLICATE", "CONTRADICTORY", "REPLICATION", "SUPERSEDED"].includes(record.novelty)
    || !["NOT_READY", "READY_FOR_AXIOM_REVIEW", "ROUTED_TO_AXIOM_REVIEW", "DUPLICATE_SUPPRESSED"].includes(record.axiomHandoffStatus)
    || !Array.isArray(record.relatedExistingResearch)
    || record.relatedExistingResearch.some((value) => typeof value !== "string" || value.trim() === "")
    || canonicalResearchJson(record.relatedExistingResearch) !== canonicalResearchJson([...new Set(record.relatedExistingResearch)].sort((left, right) => left.localeCompare(right)))
    || !validSha256(receipt.receiptFingerprint)) return false;
  try {
    validateCaptureSource(record, receipt.verifierId, receipt.requestUrl, receipt.responseUrl);
    const snapshotCapture: VerifiedResearchIntelligenceResponseCapture = Object.freeze({
      verifierId: receipt.verifierId,
      requestUrl: receipt.requestUrl,
      responseUrl: receipt.responseUrl,
      responseBody: `<feed>${receipt.sourceEntrySnapshot}</feed>`,
      capturedAt: receipt.capturedAt,
    });
    validateCompleteArxivEntry(record, snapshotCapture, receipt.sourceEntrySnapshot, receipt.capturedAt);
    const { receiptFingerprint, ...core } = receipt;
    return canonicalResearchJson({ ...receipt }) === canonicalResearchJson({ ...core, receiptFingerprint: sha256(core) })
      && receiptFingerprint === sha256(core);
  } catch {
    return false;
  }
}

/** True only for a source capture authenticated in this process; persisted hashes alone never suffice. */
export function verifyPersistedResearchIntelligenceSourceReceipt(record: ResearchIntelligenceRecord): boolean {
  return isResearchIntelligenceSourceRecordAuthenticated(record);
}

export function isResearchIntelligenceSourceRecordAuthenticated(record: ResearchIntelligenceRecord): boolean {
  return issuedSourceRecords.has(record) && validatePersistedResearchIntelligenceSourceReceiptIntegrity(record);
}

export function carryResearchIntelligenceSourceAuthentication<T extends ResearchIntelligenceRecord>(
  source: ResearchIntelligenceRecord,
  derived: T,
): T {
  return carrySourceAuthentication(source, derived, false);
}

/** Re-authenticates a fresh capture while retaining the first persisted discovery time. */
export function carryResearchIntelligenceSourceAuthenticationWithDurableChronology<T extends ResearchIntelligenceRecord>(
  source: ResearchIntelligenceRecord,
  derived: T,
): T {
  return carrySourceAuthentication(source, derived, true);
}

function carrySourceAuthentication<T extends ResearchIntelligenceRecord>(
  source: ResearchIntelligenceRecord,
  derived: T,
  preserveFirstDiscovery: boolean,
): T {
  const sourceCore = { ...source } as Record<string, unknown>;
  const derivedCore = { ...derived } as Record<string, unknown>;
  for (const key of ["novelty", "relatedExistingResearch", "axiomHandoffStatus"]) {
    delete sourceCore[key];
    delete derivedCore[key];
  }
  if (preserveFirstDiscovery) {
    delete sourceCore.discoveredAt;
    delete derivedCore.discoveredAt;
    delete sourceCore.sourceVerificationReceipt;
    delete derivedCore.sourceVerificationReceipt;
  }
  const allowedNovelty = new Set(["NEW", "DUPLICATE", "INCREMENTAL", "REPLICATION"]);
  const allowedHandoffStatus = new Set(["NOT_READY", "READY_FOR_AXIOM_REVIEW", "DUPLICATE_SUPPRESSED"]);
  const relationsAreCanonical = Array.isArray(derived.relatedExistingResearch)
    && derived.relatedExistingResearch.every((value) => typeof value === "string" && value.length > 0)
    && canonicalResearchJson(derived.relatedExistingResearch) === canonicalResearchJson([...new Set(derived.relatedExistingResearch)].sort())
    && (derived.novelty !== "DUPLICATE" || derived.axiomHandoffStatus === "DUPLICATE_SUPPRESSED")
    && (derived.axiomHandoffStatus !== "DUPLICATE_SUPPRESSED" || derived.novelty === "DUPLICATE");
  let authenticatedDerived = derived;
  if (isResearchIntelligenceSourceRecordAuthenticated(source)
    && canonicalResearchJson(sourceCore) === canonicalResearchJson(derivedCore)
    && (!preserveFirstDiscovery || Date.parse(derived.discoveredAt) <= Date.parse(source.discoveredAt))
    && allowedNovelty.has(derived.novelty)
    && allowedHandoffStatus.has(derived.axiomHandoffStatus)
    && relationsAreCanonical
    && derived.recordId === source.recordId
    && derived.contentFingerprint === source.contentFingerprint
    && (!preserveFirstDiscovery
      ? derived.sourceVerificationReceipt?.receiptFingerprint === source.sourceVerificationReceipt?.receiptFingerprint
      : source.sourceVerificationReceipt?.schemaVersion === 2)) {
    if (preserveFirstDiscovery) {
      const receipt = source.sourceVerificationReceipt!;
      const { receiptFingerprint: _receiptFingerprint, ...receiptCore } = receipt;
      const reboundCore = Object.freeze({ ...receiptCore, sourceEntryBindingFingerprint: sourceEntryBinding(derived) });
      const reboundReceipt = Object.freeze({ ...reboundCore, receiptFingerprint: sha256(reboundCore) });
      authenticatedDerived = Object.freeze({ ...derived, sourceVerificationReceipt: reboundReceipt }) as T;
    }
    issuedSourceRecords.add(authenticatedDerived);
  }
  return authenticatedDerived;
}
