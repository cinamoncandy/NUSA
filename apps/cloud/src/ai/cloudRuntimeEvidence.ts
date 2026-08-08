import type { AgentEvidence } from "../../../../packages/contracts/src/multiAgentGovernance";
import { aiSha256, type AiEvidenceMaterialization } from "../../../../packages/contracts/src/aiInference";
import type { UpbitTicker } from "../upbitWebSocket";

export type CloudRuntimeAiP0State = "OPEN" | "CLOSED" | "UNVERIFIABLE" | "UNAVAILABLE";

export interface CloudRuntimeAiSafetyInput {
  readonly mode: "PAPER" | "STOPPED" | "FAULTED";
  readonly killSwitchActive: boolean;
  readonly tradingAllowed: boolean;
  readonly overallHealth: "HEALTHY" | "DEGRADED" | "DOWN";
  readonly p0State: CloudRuntimeAiP0State;
  readonly observedAt: number;
}

export interface CloudRuntimeAiEvidenceBundle {
  readonly evidence: readonly AgentEvidence[];
  readonly evidenceMaterializations: readonly AiEvidenceMaterialization[];
  readonly identityHash: string;
}

const TTL_MS = 120_000;

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  return value;
}

function validTimestamp(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer`);
  return value;
}

export function buildCloudRuntimeAiEvidence(ticker: UpbitTicker, safety: CloudRuntimeAiSafetyInput): CloudRuntimeAiEvidenceBundle {
  if (!ticker.code.trim()) throw new Error("AI market code is required");
  finite(ticker.trade_price, "AI market price");
  if (ticker.trade_price <= 0) throw new Error("AI market price must be positive");
  const marketObservedAt = validTimestamp(ticker.trade_timestamp, "AI market observedAt");
  const safetyObservedAt = validTimestamp(safety.observedAt, "AI safety observedAt");
  if (ticker.signed_change_rate != null) finite(ticker.signed_change_rate, "AI market changeRate");
  if (ticker.acc_trade_volume != null && finite(ticker.acc_trade_volume, "AI market volume") < 0) throw new Error("AI market volume must be non-negative");

  const marketPayload = Object.freeze({
    market: ticker.code,
    price: ticker.trade_price,
    changeRate: ticker.signed_change_rate ?? null,
    volume: ticker.acc_trade_volume ?? null,
    observedAt: new Date(marketObservedAt).toISOString(),
    source: "UPBIT_PUBLIC_TICKER" as const
  });
  const safetyPayload = Object.freeze({
    mode: safety.mode,
    killSwitchActive: safety.killSwitchActive,
    tradingAllowed: safety.tradingAllowed,
    overallHealth: safety.overallHealth,
    p0State: safety.p0State,
    observedAt: new Date(safetyObservedAt).toISOString(),
    source: "NUSA_DETERMINISTIC_SAFETY_STATE" as const
  });
  const marketDigest = aiSha256(marketPayload);
  const safetyDigest = aiSha256(safetyPayload);
  const marketEvidenceId = `market:${ticker.code}:${marketObservedAt}:${marketDigest.slice(0, 16)}`;
  const safetyEvidenceId = `safety:${safetyObservedAt}:${safetyDigest.slice(0, 16)}`;
  const evidence = Object.freeze([
    Object.freeze({ evidenceId: marketEvidenceId, evidenceType: "market-data" as const, sourceReference: "upbit-public-ticker", observedAt: marketObservedAt, validUntil: marketObservedAt + TTL_MS, quality: "verified" as const, contentDigest: marketDigest, lineageReferences: Object.freeze([]) }),
    Object.freeze({ evidenceId: safetyEvidenceId, evidenceType: "risk-state" as const, sourceReference: "nusa-deterministic-safety-state", observedAt: safetyObservedAt, validUntil: safetyObservedAt + TTL_MS, quality: "verified" as const, contentDigest: safetyDigest, lineageReferences: Object.freeze([]) })
  ] satisfies readonly AgentEvidence[]);
  const evidenceMaterializations = Object.freeze([
    Object.freeze({ evidenceId: marketEvidenceId, contentDigest: marketDigest, payload: marketPayload }),
    Object.freeze({ evidenceId: safetyEvidenceId, contentDigest: safetyDigest, payload: safetyPayload })
  ] satisfies readonly AiEvidenceMaterialization[]);
  const identityHash = aiSha256({ evidence, evidenceMaterializations });
  return Object.freeze({ evidence, evidenceMaterializations, identityHash });
}
