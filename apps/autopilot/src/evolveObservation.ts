export type EvolutionObservationStatus = "HEALTHY" | "DEGRADED" | "FAILED" | "UNKNOWN";

export interface EvolutionObservation {
  readonly revision: string;
  readonly status: EvolutionObservationStatus;
  readonly health: boolean;
  readonly errors: number;
  readonly latencyMs: number | null;
}

export function createEvolutionObservation(input: {
  revision: string;
  health: boolean;
  errors?: number;
  latencyMs?: number | null;
}): EvolutionObservation {
  const revision = input.revision.trim();
  const errors = input.errors ?? 0;
  const latencyMs = input.latencyMs ?? null;
  if (!revision || revision.length > 128) throw new Error("EVOLVE_OBSERVATION_REVISION_INVALID");
  if (!Number.isInteger(errors) || errors < 0) throw new Error("EVOLVE_OBSERVATION_ERRORS_INVALID");
  if (latencyMs !== null && (!Number.isFinite(latencyMs) || latencyMs < 0)) {
    throw new Error("EVOLVE_OBSERVATION_LATENCY_INVALID");
  }
  const status: EvolutionObservationStatus = !input.health ? "FAILED" : errors > 0 ? "DEGRADED" : "HEALTHY";
  return Object.freeze({ revision, status, health: input.health, errors, latencyMs });
}
