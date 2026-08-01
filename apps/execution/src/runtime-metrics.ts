export interface RuntimeMetricSample {
  readonly observedAtMs: number;
  readonly rssBytes: number;
  readonly heapUsedBytes: number;
  readonly cpuUserMicros: number;
  readonly cpuSystemMicros: number;
}

export interface RuntimeMetricHealth {
  readonly status: "HEALTHY" | "WARNING" | "UNKNOWN";
  readonly sampleCount: number;
  readonly memoryGrowthBytes: number | null;
  readonly cpuDeltaMicros: number | null;
}

const nonNegative = (value: number, field: string): number => {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be non-negative`);
  return value;
};

export class RuntimeMetricsCollector {
  private readonly samples: RuntimeMetricSample[] = [];
  public constructor(private readonly maximumSamples = 120) {
    if (!Number.isSafeInteger(maximumSamples) || maximumSamples < 3) throw new Error("maximumSamples must be at least 3");
  }

  public record(sample: RuntimeMetricSample): RuntimeMetricSample {
    const normalized = Object.freeze({
      observedAtMs: nonNegative(sample.observedAtMs, "observedAtMs"),
      rssBytes: nonNegative(sample.rssBytes, "rssBytes"),
      heapUsedBytes: nonNegative(sample.heapUsedBytes, "heapUsedBytes"),
      cpuUserMicros: nonNegative(sample.cpuUserMicros, "cpuUserMicros"),
      cpuSystemMicros: nonNegative(sample.cpuSystemMicros, "cpuSystemMicros")
    });
    const previous = this.samples.at(-1);
    if (previous && normalized.observedAtMs < previous.observedAtMs) throw new Error("metric time is non-monotonic");
    this.samples.push(normalized);
    while (this.samples.length > this.maximumSamples) this.samples.shift();
    return normalized;
  }

  public list(): readonly RuntimeMetricSample[] { return Object.freeze([...this.samples]); }

  public health(): RuntimeMetricHealth {
    if (this.samples.length < 3) return Object.freeze({ status: "UNKNOWN", sampleCount: this.samples.length, memoryGrowthBytes: null, cpuDeltaMicros: null });
    const first = this.samples[0]!;
    const latest = this.samples.at(-1)!;
    const memoryGrowthBytes = latest.heapUsedBytes - first.heapUsedBytes;
    const cpuDeltaMicros = latest.cpuUserMicros + latest.cpuSystemMicros - first.cpuUserMicros - first.cpuSystemMicros;
    return Object.freeze({ status: memoryGrowthBytes > 0 && this.samples.every((sample, index) => index === 0 || sample.heapUsedBytes >= this.samples[index - 1]!.heapUsedBytes) ? "WARNING" : "HEALTHY", sampleCount: this.samples.length, memoryGrowthBytes, cpuDeltaMicros });
  }
}
