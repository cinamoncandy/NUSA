export type PrivateRequestClockState = "SAFE" | "UNSAFE" | "UNKNOWN";

export interface PrivateRequestClockEvidence {
  readonly state: PrivateRequestClockState;
  readonly offsetMs: number | null;
  readonly maxAbsoluteOffsetMs: number;
}

export interface PrivateRequestClockEligibility {
  readonly eligible: boolean;
  readonly reasonCodes: readonly string[];
}

export function evaluatePrivateRequestClockEligibility(
  evidence: PrivateRequestClockEvidence,
): PrivateRequestClockEligibility {
  const reasons: string[] = [];

  if (evidence.state === "UNSAFE") reasons.push("CLOCK_STATE_UNSAFE");
  if (evidence.state === "UNKNOWN") reasons.push("CLOCK_STATE_UNKNOWN");
  if (!Number.isFinite(evidence.maxAbsoluteOffsetMs) || evidence.maxAbsoluteOffsetMs < 0) {
    reasons.push("CLOCK_OFFSET_LIMIT_INVALID");
  }
  if (evidence.offsetMs === null || !Number.isFinite(evidence.offsetMs)) {
    reasons.push("CLOCK_OFFSET_UNKNOWN");
  } else if (
    Number.isFinite(evidence.maxAbsoluteOffsetMs)
    && evidence.maxAbsoluteOffsetMs >= 0
    && Math.abs(evidence.offsetMs) > evidence.maxAbsoluteOffsetMs
  ) {
    reasons.push("CLOCK_OFFSET_EXCEEDED");
  }

  return Object.freeze({
    eligible: reasons.length === 0,
    reasonCodes: Object.freeze(reasons),
  });
}
