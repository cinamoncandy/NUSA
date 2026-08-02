export type HealthDimensionStatus = "HEALTHY" | "WARNING" | "FAILED" | "UNKNOWN";
export type OverallHealthStatus = "HEALTHY" | "WARNING" | "BLOCKED" | "UNKNOWN";

export interface HealthDimension {
  readonly name: string;
  readonly status: HealthDimensionStatus;
  readonly weight: number;
  readonly reason?: string;
}

export interface HealthScore {
  readonly score: number | null;
  readonly status: OverallHealthStatus;
  readonly dimensions: readonly HealthDimension[];
  readonly blockingReasons: readonly string[];
}

const dimensionScore: Readonly<Record<HealthDimensionStatus, number | null>> = Object.freeze({
  HEALTHY: 100,
  WARNING: 70,
  FAILED: 0,
  UNKNOWN: null
});

function requireDimension(dimension: HealthDimension): HealthDimension {
  if (typeof dimension.name !== "string" || dimension.name.trim() === "") throw new Error("health dimension name is required");
  if (!Number.isFinite(dimension.weight) || dimension.weight <= 0) throw new Error("health dimension weight must be positive");
  if (!(dimension.status in dimensionScore)) throw new Error("unknown health dimension status");
  return Object.freeze({ ...dimension, name: dimension.name.trim() });
}

export function calculateHealthScore(input: Readonly<{ dimensions: readonly HealthDimension[] }>): HealthScore {
  if (!Array.isArray(input.dimensions) || input.dimensions.length === 0) throw new Error("health dimensions are required");
  const dimensions = input.dimensions.map(requireDimension).sort((left, right) => left.name.localeCompare(right.name));
  const names = new Set<string>();
  for (const dimension of dimensions) {
    if (names.has(dimension.name)) throw new Error(`duplicate health dimension: ${dimension.name}`);
    names.add(dimension.name);
  }
  const blockingReasons = dimensions
    .filter((dimension) => dimension.status !== "HEALTHY")
    .map((dimension) => dimension.reason?.trim() || `${dimension.name}: ${dimension.status}`);
  if (dimensions.some((dimension) => dimension.status === "UNKNOWN")) {
    return Object.freeze({ score: null, status: "UNKNOWN", dimensions: Object.freeze(dimensions), blockingReasons: Object.freeze(blockingReasons) });
  }
  const totalWeight = dimensions.reduce((sum, dimension) => sum + dimension.weight, 0);
  const score = Math.round(dimensions.reduce((sum, dimension) => sum + (dimensionScore[dimension.status] as number) * dimension.weight, 0) / totalWeight * 100) / 100;
  const status: OverallHealthStatus = dimensions.some((dimension) => dimension.status === "FAILED")
    ? "BLOCKED"
    : score >= 90 && dimensions.every((dimension) => dimension.status === "HEALTHY")
      ? "HEALTHY"
      : "WARNING";
  return Object.freeze({ score, status, dimensions: Object.freeze(dimensions), blockingReasons: Object.freeze(blockingReasons) });
}
