import { createHash } from "node:crypto";
import type { ReadOnlyCredentialStatus } from "./upbitReadOnlyCredentialProvider";
import type { UpbitReadOnlyResult, UpbitReadOnlyResultCode } from "./upbitReadOnlyService";
import type { UpbitLiveReadOnlySnapshot } from "./upbitRestAdapter";

export type ExternalReadOnlyPreflightVerdict = "NOT_RUN" | "READY_FOR_HUMAN_REVIEW" | "SAFE_BLOCK" | "UNKNOWN";

export interface ExternalReadOnlyProbePort {
  status(): Promise<ReadOnlyCredentialStatus>;
  captureSnapshot(timeoutMs?: number): Promise<UpbitReadOnlyResult<UpbitLiveReadOnlySnapshot>>;
}

export interface ExternalReadOnlyPreflightRequest {
  readonly operatorAuthorizedExternalProbe: boolean;
  readonly operatorRequestId: string;
  readonly codeRevision: string;
  readonly configurationHash: string;
  readonly releaseSealFingerprint: string;
  readonly boundedEnvelopeFingerprint: string;
  readonly timeoutMs?: number;
}

export interface ExternalReadOnlyPreflightReceipt {
  readonly verdict: ExternalReadOnlyPreflightVerdict;
  readonly probePerformed: boolean;
  readonly credentialConfigured: boolean | null;
  readonly credentialProvider: "electron-safe-storage" | null;
  readonly resultCode: UpbitReadOnlyResultCode | "NOT_RUN" | "STATUS_ERROR";
  readonly observedAt: string | null;
  readonly accountCount: number | null;
  readonly openOrderCount: number | null;
  readonly snapshotDigest: string | null;
  readonly receiptFingerprint: string;
  readonly activationAuthority: false;
  readonly orderAuthorization: false;
  readonly executionAuthority: false;
  readonly authorizesLive: false;
  readonly mutationPerformed: false;
  readonly credentialExecutionUse: false;
  readonly realMoneyExecutionAllowed: false;
}

export const EXTERNAL_READ_ONLY_PREFLIGHT_DESCRIPTOR = Object.freeze({
  mode: "OPERATOR_GATED_READ_ONLY" as const,
  actualExternalProbeInCi: false,
  explicitOperatorAuthorizationRequired: true,
  activationAuthority: false,
  orderAuthorization: false,
  executionAuthority: false,
  authorizesLive: false,
  mutationPerformed: false,
  credentialExecutionUse: false,
  realMoneyExecutionAllowed: false,
});

const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 15_000;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown): string {
  const source = typeof value === "string" ? value : canonical(value);
  return createHash("sha256").update(source, "utf8").digest("hex");
}

function normalizeRequest(request: ExternalReadOnlyPreflightRequest): Required<ExternalReadOnlyPreflightRequest> {
  if (!REQUEST_ID.test(request.operatorRequestId)) throw new Error("INVALID_OPERATOR_REQUEST_ID");
  if (!HEX40.test(request.codeRevision)) throw new Error("INVALID_CODE_REVISION");
  if (!HEX64.test(request.configurationHash)) throw new Error("INVALID_CONFIGURATION_HASH");
  if (!HEX64.test(request.releaseSealFingerprint)) throw new Error("INVALID_RELEASE_SEAL_FINGERPRINT");
  if (!HEX64.test(request.boundedEnvelopeFingerprint)) throw new Error("INVALID_BOUNDED_ENVELOPE_FINGERPRINT");
  const timeoutMs = request.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) throw new Error("INVALID_TIMEOUT_MS");
  return Object.freeze({ ...request, timeoutMs });
}

function receipt(
  request: Required<ExternalReadOnlyPreflightRequest>,
  fields: Omit<ExternalReadOnlyPreflightReceipt, "receiptFingerprint" | keyof typeof EXTERNAL_READ_ONLY_PREFLIGHT_DESCRIPTOR>,
): ExternalReadOnlyPreflightReceipt {
  const fingerprintInput = {
    operatorRequestId: request.operatorRequestId,
    codeRevision: request.codeRevision,
    configurationHash: request.configurationHash,
    releaseSealFingerprint: request.releaseSealFingerprint,
    boundedEnvelopeFingerprint: request.boundedEnvelopeFingerprint,
    timeoutMs: request.timeoutMs,
    verdict: fields.verdict,
    probePerformed: fields.probePerformed,
    credentialConfigured: fields.credentialConfigured,
    credentialProvider: fields.credentialProvider,
    resultCode: fields.resultCode,
    observedAt: fields.observedAt,
    accountCount: fields.accountCount,
    openOrderCount: fields.openOrderCount,
    snapshotDigest: fields.snapshotDigest,
  };
  return Object.freeze({
    ...fields,
    receiptFingerprint: sha256(fingerprintInput),
    activationAuthority: false,
    orderAuthorization: false,
    executionAuthority: false,
    authorizesLive: false,
    mutationPerformed: false,
    credentialExecutionUse: false,
    realMoneyExecutionAllowed: false,
  });
}

function emptyFields(
  verdict: ExternalReadOnlyPreflightVerdict,
  resultCode: ExternalReadOnlyPreflightReceipt["resultCode"],
  probePerformed: boolean,
  credentialConfigured: boolean | null,
  credentialProvider: "electron-safe-storage" | null,
): Omit<ExternalReadOnlyPreflightReceipt, "receiptFingerprint" | keyof typeof EXTERNAL_READ_ONLY_PREFLIGHT_DESCRIPTOR> {
  return {
    verdict,
    probePerformed,
    credentialConfigured,
    credentialProvider,
    resultCode,
    observedAt: null,
    accountCount: null,
    openOrderCount: null,
    snapshotDigest: null,
  };
}

export async function runExternalReadOnlyEnvironmentPreflight(
  requestInput: ExternalReadOnlyPreflightRequest,
  port: ExternalReadOnlyProbePort,
): Promise<ExternalReadOnlyPreflightReceipt> {
  const request = normalizeRequest(requestInput);
  if (!request.operatorAuthorizedExternalProbe) {
    return receipt(request, emptyFields("NOT_RUN", "NOT_RUN", false, null, null));
  }

  let status: ReadOnlyCredentialStatus;
  try {
    status = await port.status();
  } catch {
    return receipt(request, emptyFields("UNKNOWN", "STATUS_ERROR", false, null, null));
  }

  if (!status.configured) {
    return receipt(request, emptyFields("SAFE_BLOCK", "NOT_CONFIGURED", false, false, status.provider));
  }

  let result: UpbitReadOnlyResult<UpbitLiveReadOnlySnapshot>;
  try {
    result = await port.captureSnapshot(request.timeoutMs);
  } catch {
    return receipt(request, emptyFields("UNKNOWN", "PROVIDER_ERROR", true, true, status.provider));
  }

  if (!result.ok || !result.data || result.code !== "CONNECTED") {
    const verdict: ExternalReadOnlyPreflightVerdict =
      result.code === "NOT_CONFIGURED" || result.code === "INVALID_CREDENTIALS" || result.code === "IP_NOT_ALLOWED"
        ? "SAFE_BLOCK"
        : "UNKNOWN";
    return receipt(request, emptyFields(verdict, result.code, true, true, status.provider));
  }

  const snapshotDigest = sha256(result.data);
  return receipt(request, {
    verdict: "READY_FOR_HUMAN_REVIEW",
    probePerformed: true,
    credentialConfigured: true,
    credentialProvider: status.provider,
    resultCode: "CONNECTED",
    observedAt: result.data.observedAt,
    accountCount: result.data.accounts.length,
    openOrderCount: result.data.openOrders.length,
    snapshotDigest,
  });
}
