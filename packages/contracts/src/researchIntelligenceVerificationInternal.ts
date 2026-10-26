import { createHash } from "node:crypto";
import { canonicalResearchJson } from "./researchRuntime";
import type {
  ResearchIntelligenceRecord,
  ResearchIntelligenceSourceVerificationReceipt,
} from "./researchIntelligence";

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
  if (!paperId || paperId !== record.sourceId.slice("arxiv:".length) || recordPaperId !== paperId
    || record.sourceType !== "ARXIV" || record.title !== title
    || canonicalResearchJson(record.authors) !== canonicalResearchJson([...new Set(authors)])
    || !Number.isFinite(publishedMs) || new Date(publishedMs).toISOString() !== record.publishedAt
    || record.claimedContribution !== summary || record.discoveredAt !== new Date(capturedAt).toISOString()
    || Date.parse(record.discoveredAt) < publishedMs || rawSha256(rawContent) !== record.rawContentSha256.toLowerCase()) {
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
    || record.sourceVerificationReceipt !== undefined || rawSha256(rawContent) !== record.rawContentSha256.toLowerCase()
    || !validSha256(capture.responseBody.length > 0 ? rawSha256(capture.responseBody) : "")
    || !Number.isFinite(Date.parse(capture.capturedAt))
    || new Date(capture.capturedAt).toISOString() !== capture.capturedAt
    || Date.parse(capture.capturedAt) !== Date.parse(record.discoveredAt)) {
    throw new Error("RESEARCH_INTELLIGENCE_SOURCE_CAPTURE_INVALID");
  }
  validateCaptureSource(record, capture.verifierId, capture.requestUrl, capture.responseUrl);
  validateCompleteArxivEntry(record, capture, rawContent, capture.capturedAt);
  const core = Object.freeze({
    schemaVersion: 1 as const,
    verifierId: capture.verifierId,
    requestUrl: canonicalUrl(capture.requestUrl).toString(),
    responseUrl: canonicalUrl(capture.responseUrl).toString(),
    responseFingerprint: rawSha256(capture.responseBody),
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

export function verifyPersistedResearchIntelligenceSourceReceipt(record: ResearchIntelligenceRecord): boolean {
  if (!record || typeof record !== "object") return false;
  const receipt = record.sourceVerificationReceipt;
  if (record.sourceVerification !== "VERIFIED_PRIMARY_SOURCE") {
    return record.validationStatus !== "SOURCE_VERIFIED" && receipt === undefined;
  }
  if (record.validationStatus !== "SOURCE_VERIFIED" || !receipt || receipt.schemaVersion !== 1
    || !validSha256(receipt.responseFingerprint) || receipt.rawContentSha256 !== record.rawContentSha256.toLowerCase()
    || receipt.sourceEntryBindingFingerprint !== sourceEntryBinding(record)
    || !Number.isFinite(Date.parse(receipt.capturedAt)) || Date.parse(receipt.capturedAt) !== Date.parse(record.discoveredAt)
    || !validSha256(receipt.receiptFingerprint)) return false;
  try {
    validateCaptureSource(record, receipt.verifierId, receipt.requestUrl, receipt.responseUrl);
    const { receiptFingerprint, ...core } = receipt;
    return canonicalResearchJson({ ...receipt }) === canonicalResearchJson({ ...core, receiptFingerprint: sha256(core) })
      && receiptFingerprint === sha256(core);
  } catch {
    return false;
  }
}

export function isResearchIntelligenceSourceRecordAuthenticated(record: ResearchIntelligenceRecord): boolean {
  return issuedSourceRecords.has(record) && verifyPersistedResearchIntelligenceSourceReceipt(record);
}

export function carryResearchIntelligenceSourceAuthentication<T extends ResearchIntelligenceRecord>(
  source: ResearchIntelligenceRecord,
  derived: T,
): T {
  const sourceCore = { ...source } as Record<string, unknown>;
  const derivedCore = { ...derived } as Record<string, unknown>;
  for (const key of ["novelty", "relatedExistingResearch", "axiomHandoffStatus"]) {
    delete sourceCore[key];
    delete derivedCore[key];
  }
  const allowedNovelty = new Set(["NEW", "DUPLICATE", "INCREMENTAL", "REPLICATION"]);
  const allowedHandoffStatus = new Set(["NOT_READY", "READY_FOR_AXIOM_REVIEW", "DUPLICATE_SUPPRESSED"]);
  const relationsAreCanonical = Array.isArray(derived.relatedExistingResearch)
    && derived.relatedExistingResearch.every((value) => typeof value === "string" && value.length > 0)
    && canonicalResearchJson(derived.relatedExistingResearch) === canonicalResearchJson([...new Set(derived.relatedExistingResearch)].sort())
    && (derived.novelty !== "DUPLICATE" || derived.axiomHandoffStatus === "DUPLICATE_SUPPRESSED")
    && (derived.axiomHandoffStatus !== "DUPLICATE_SUPPRESSED" || derived.novelty === "DUPLICATE");
  if (isResearchIntelligenceSourceRecordAuthenticated(source)
    && canonicalResearchJson(sourceCore) === canonicalResearchJson(derivedCore)
    && allowedNovelty.has(derived.novelty)
    && allowedHandoffStatus.has(derived.axiomHandoffStatus)
    && relationsAreCanonical
    && derived.recordId === source.recordId
    && derived.contentFingerprint === source.contentFingerprint
    && derived.sourceVerificationReceipt?.receiptFingerprint === source.sourceVerificationReceipt?.receiptFingerprint) {
    issuedSourceRecords.add(derived);
  }
  return derived;
}
