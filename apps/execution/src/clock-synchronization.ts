export enum ClockSynchronizationStatus {
  SYNCHRONIZED = "SYNCHRONIZED",
  DEGRADED = "DEGRADED",
  UNSAFE = "UNSAFE",
  INVALID = "INVALID"
}

export interface ClockSynchronizationPolicy {
  readonly degradedOffsetMs: number;
  readonly unsafeOffsetMs: number;
  readonly maximumSampleAgeMs: number;
  readonly recvWindowMs: number;
}

export interface ClockSample {
  readonly sampleId: string;
  readonly localSendMs: number;
  readonly providerTimeMs: number;
  readonly localReceiveMs: number;
}

export interface ClockSynchronizationAssessment {
  readonly sampleId: string;
  readonly status: ClockSynchronizationStatus;
  readonly offsetMs: number;
  readonly roundTripMs: number;
  readonly adjustedNowMs: number;
  readonly validUntilMs: number;
  readonly reason?: string;
}

function assertSafeTime(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`);
}

export function assessClockSynchronization(sample: ClockSample, policy: ClockSynchronizationPolicy): ClockSynchronizationAssessment {
  if (sample.sampleId.trim() === "") throw new Error("sampleId is required");
  assertSafeTime(sample.localSendMs, "localSendMs");
  assertSafeTime(sample.providerTimeMs, "providerTimeMs");
  assertSafeTime(sample.localReceiveMs, "localReceiveMs");
  if (sample.localReceiveMs < sample.localSendMs) throw new Error("clock sample receive time precedes send time");
  for (const [name, value] of Object.entries(policy)) assertSafeTime(value, name);
  if (policy.degradedOffsetMs > policy.unsafeOffsetMs) throw new Error("degradedOffsetMs must not exceed unsafeOffsetMs");
  if (policy.recvWindowMs === 0) throw new Error("recvWindowMs must be positive");

  const roundTripMs = sample.localReceiveMs - sample.localSendMs;
  const localMidpointMs = sample.localSendMs + Math.floor(roundTripMs / 2);
  const offsetMs = sample.providerTimeMs - localMidpointMs;
  const absoluteOffsetMs = Math.abs(offsetMs);
  let status = ClockSynchronizationStatus.SYNCHRONIZED;
  let reason: string | undefined;

  if (roundTripMs > policy.recvWindowMs) {
    status = ClockSynchronizationStatus.INVALID;
    reason = "clock sample round trip exceeds recvWindow";
  } else if (absoluteOffsetMs > policy.unsafeOffsetMs) {
    status = ClockSynchronizationStatus.UNSAFE;
    reason = "clock offset exceeds unsafe threshold";
  } else if (absoluteOffsetMs > policy.degradedOffsetMs) {
    status = ClockSynchronizationStatus.DEGRADED;
    reason = "clock offset exceeds degraded threshold";
  }

  return Object.freeze({
    sampleId: sample.sampleId,
    status,
    offsetMs,
    roundTripMs,
    adjustedNowMs: sample.localReceiveMs + offsetMs,
    validUntilMs: sample.localReceiveMs + policy.maximumSampleAgeMs,
    ...(reason == null ? {} : { reason })
  });
}

export function assertClockSafeForSignedRequest(assessment: ClockSynchronizationAssessment, nowMs: number): void {
  assertSafeTime(nowMs, "nowMs");
  if (nowMs > assessment.validUntilMs) throw new Error("clock synchronization evidence is stale");
  if (assessment.status === ClockSynchronizationStatus.UNSAFE || assessment.status === ClockSynchronizationStatus.INVALID) throw new Error("clock synchronization is unsafe for signed requests");
}
