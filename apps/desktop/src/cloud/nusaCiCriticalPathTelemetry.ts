export interface GithubCiJobTimingReceipt {
  readonly jobId: number;
  readonly runId: number;
  readonly runAttempt: number;
  readonly name: string;
  readonly headSha: string;
  readonly status: "completed";
  readonly conclusion: string;
  readonly startedAt: string;
  readonly completedAt: string;
  /** SHA-256 of the immutable GitHub job receipt from which these fields were parsed. */
  readonly sourceFingerprint: string;
}

export interface NusaCiJobTimingSummary {
  readonly name: string;
  readonly sampleCount: number;
  readonly p50DurationMs: number;
  readonly p95DurationMs: number;
  readonly maximumDurationMs: number;
}

export interface NusaCiRunTimingSummary {
  readonly runId: number;
  readonly runAttempt: number;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly wallClockDurationMs: number;
  readonly coreShardImbalanceRatio: number | null;
}

export interface NusaCiCriticalPathTelemetry {
  readonly schemaVersion: 1;
  readonly headSha: string;
  readonly jobSampleCount: number;
  readonly jobTimings: readonly NusaCiJobTimingSummary[];
  readonly runs: readonly NusaCiRunTimingSummary[];
  readonly workflowP50Ms: number;
  readonly workflowP95Ms: number;
  readonly retryObservationRate: number;
  readonly cacheEffectiveness: "INSUFFICIENT_EVIDENCE";
  readonly duplicateBuildTestWork: "INSUFFICIENT_EVIDENCE";
  readonly reasons: readonly string[];
}

export class NusaCiTelemetryError extends Error {
  public constructor(readonly code: string, message: string) {
    super(message);
    this.name = "NusaCiTelemetryError";
  }
}

const SHA_40 = /^[a-f0-9]{40}$/;
const SHA_64 = /^[a-f0-9]{64}$/;
const CORE_SHARD = /^coverage-core-(\d+)$/;
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function percentileNearestRank(values: readonly number[], percentile: number): number {
  if (values.length === 0) throw new NusaCiTelemetryError("EMPTY_PERCENTILE_SAMPLE", "cannot compute a percentile without observations");
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(percentile * sorted.length));
  return sorted[rank - 1]!;
}

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new NusaCiTelemetryError("INVALID_JOB_TIMESTAMP", `${label} must be a valid canonical timestamp`);
  return parsed;
}

function validateReceipt(receipt: GithubCiJobTimingReceipt, expectedHeadSha: string): Readonly<{ startedAt: number; completedAt: number; durationMs: number }> {
  if (!Number.isSafeInteger(receipt.jobId) || receipt.jobId <= 0) throw new NusaCiTelemetryError("INVALID_JOB_ID", "jobId must be a positive safe integer");
  if (!Number.isSafeInteger(receipt.runId) || receipt.runId <= 0) throw new NusaCiTelemetryError("INVALID_RUN_ID", "runId must be a positive safe integer");
  if (!Number.isSafeInteger(receipt.runAttempt) || receipt.runAttempt <= 0) throw new NusaCiTelemetryError("INVALID_RUN_ATTEMPT", "runAttempt must be a positive safe integer");
  if (!receipt.name.trim()) throw new NusaCiTelemetryError("EMPTY_JOB_NAME", "job name must be non-empty");
  if (!SHA_40.test(receipt.headSha) || receipt.headSha !== expectedHeadSha) throw new NusaCiTelemetryError("JOB_HEAD_MISMATCH", "every job timing receipt must belong to the exact assessed head");
  if (receipt.status !== "completed") throw new NusaCiTelemetryError("INCOMPLETE_JOB_RECEIPT", "timing telemetry accepts completed jobs only");
  if (!SHA_64.test(receipt.sourceFingerprint)) throw new NusaCiTelemetryError("INVALID_SOURCE_FINGERPRINT", "job receipt requires a lowercase SHA-256 fingerprint");
  const startedAt = timestamp(receipt.startedAt, `${receipt.name}.startedAt`);
  const completedAt = timestamp(receipt.completedAt, `${receipt.name}.completedAt`);
  if (completedAt < startedAt) throw new NusaCiTelemetryError("NEGATIVE_JOB_DURATION", `job ${receipt.name} completes before it starts`);
  return freeze({ startedAt, completedAt, durationMs: completedAt - startedAt });
}

/**
 * Builds CI timing telemetry solely from immutable GitHub job receipts. It never estimates missing
 * timestamps, cache hits, or duplicate-work metrics. Unsupported metrics remain explicitly
 * INSUFFICIENT_EVIDENCE until a stronger receipt adapter exists.
 */
export function analyzeNusaCiCriticalPathTelemetry(
  receipts: readonly GithubCiJobTimingReceipt[],
  expectedHeadSha: string,
): NusaCiCriticalPathTelemetry {
  if (!SHA_40.test(expectedHeadSha)) throw new NusaCiTelemetryError("INVALID_EXPECTED_HEAD", "expectedHeadSha must be a lowercase 40-character Git SHA-1");
  if (receipts.length === 0) throw new NusaCiTelemetryError("EMPTY_JOB_RECEIPTS", "at least one completed GitHub job receipt is required");

  const seenJobs = new Set<number>();
  const normalized = receipts.map((receipt) => {
    if (seenJobs.has(receipt.jobId)) throw new NusaCiTelemetryError("DUPLICATE_JOB_RECEIPT", `job ${receipt.jobId} appears more than once`);
    seenJobs.add(receipt.jobId);
    return freeze({ receipt, ...validateReceipt(receipt, expectedHeadSha) });
  });

  const byName = new Map<string, number[]>();
  for (const entry of normalized) {
    const durations = byName.get(entry.receipt.name) ?? [];
    durations.push(entry.durationMs);
    byName.set(entry.receipt.name, durations);
  }
  const jobTimings = freeze([...byName.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, durations]) => freeze({
      name,
      sampleCount: durations.length,
      p50DurationMs: percentileNearestRank(durations, 0.5),
      p95DurationMs: percentileNearestRank(durations, 0.95),
      maximumDurationMs: Math.max(...durations),
    })));

  const runKeys = new Map<string, typeof normalized>();
  for (const entry of normalized) {
    const key = `${entry.receipt.runId}:${entry.receipt.runAttempt}`;
    const entries = runKeys.get(key) ?? [];
    runKeys.set(key, [...entries, entry]);
  }

  const runs = freeze([...runKeys.values()].map((entries) => {
    const first = entries[0]!;
    const startedAt = Math.min(...entries.map((entry) => entry.startedAt));
    const completedAt = Math.max(...entries.map((entry) => entry.completedAt));
    const shards = entries
      .filter((entry) => CORE_SHARD.test(entry.receipt.name))
      .map((entry) => entry.durationMs);
    const minimumShard = shards.length > 0 ? Math.min(...shards) : null;
    const maximumShard = shards.length > 0 ? Math.max(...shards) : null;
    const coreShardImbalanceRatio = minimumShard == null || maximumShard == null || minimumShard === 0
      ? null
      : maximumShard / minimumShard;
    return freeze({
      runId: first.receipt.runId,
      runAttempt: first.receipt.runAttempt,
      startedAt,
      completedAt,
      wallClockDurationMs: completedAt - startedAt,
      coreShardImbalanceRatio,
    });
  }).sort((left, right) => left.runId - right.runId || left.runAttempt - right.runAttempt));

  const workflowDurations = runs.map((run) => run.wallClockDurationMs);
  const retryObservations = normalized.filter((entry) => entry.receipt.runAttempt > 1).length;
  const reasons = ["GITHUB_JOB_TIMESTAMPS_ONLY", "CACHE_EFFECTIVENESS_REQUIRES_STRONGER_EVIDENCE", "DUPLICATE_WORK_REQUIRES_STEP_LEVEL_EVIDENCE"];

  return freeze({
    schemaVersion: 1,
    headSha: expectedHeadSha,
    jobSampleCount: normalized.length,
    jobTimings,
    runs,
    workflowP50Ms: percentileNearestRank(workflowDurations, 0.5),
    workflowP95Ms: percentileNearestRank(workflowDurations, 0.95),
    retryObservationRate: retryObservations / normalized.length,
    cacheEffectiveness: "INSUFFICIENT_EVIDENCE",
    duplicateBuildTestWork: "INSUFFICIENT_EVIDENCE",
    reasons: freeze(reasons),
  });
}
