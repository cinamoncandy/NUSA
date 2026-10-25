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
  capturedAt: string,
): ResearchIntelligenceRecord {
  if (!capture || typeof capture !== "object" || !verifiedResponseCaptures.has(capture)) {
    throw new Error("RESEARCH_INTELLIGENCE_SOURCE_CAPTURE_INVALID");
  }
  if (!record || record.sourceVerification !== "UNVERIFIED" || record.validationStatus !== "DISCOVERED"
    || record.sourceVerificationReceipt !== undefined || rawSha256(rawContent) !== record.rawContentSha256.toLowerCase()
    || !capture.responseBody.includes(rawContent)
    || !validSha256(capture.responseBody.length > 0 ? rawSha256(capture.responseBody) : "")
    || !Number.isFinite(Date.parse(capturedAt))
    || Date.parse(capturedAt) !== Date.parse(record.discoveredAt)) {
    throw new Error("RESEARCH_INTELLIGENCE_SOURCE_CAPTURE_INVALID");
  }
  validateCaptureSource(record, capture.verifierId, capture.requestUrl, capture.responseUrl);
  const paperId = record.sourceId.slice("arxiv:".length).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (capture.verifierId === "ARXIV_API_V1"
    && !new RegExp(`<id>https?://arxiv\\.org/abs/${paperId}(?:v\\d+)?</id>`, "i").test(rawContent)) {
    throw new Error("ARXIV_SOURCE_CAPTURE_CONTENT_MISMATCH");
  }
  const core = Object.freeze({
    schemaVersion: 1 as const,
    verifierId: capture.verifierId,
    requestUrl: canonicalUrl(capture.requestUrl).toString(),
    responseUrl: canonicalUrl(capture.responseUrl).toString(),
    responseFingerprint: rawSha256(capture.responseBody),
    rawContentSha256: record.rawContentSha256.toLowerCase(),
    capturedAt: new Date(capturedAt).toISOString(),
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
  const capture = Object.freeze({
    verifierId,
    requestUrl: request.toString(),
    responseUrl: response.url || request.toString(),
    responseBody: await response.text(),
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
  if (isResearchIntelligenceSourceRecordAuthenticated(source)
    && derived.recordId === source.recordId
    && derived.contentFingerprint === source.contentFingerprint
    && derived.sourceVerificationReceipt?.receiptFingerprint === source.sourceVerificationReceipt?.receiptFingerprint) {
    issuedSourceRecords.add(derived);
  }
  return derived;
}
