export interface EvolutionExecutionRequest {
  readonly executionId: string;
  readonly dedupeKey: string;
  readonly repository: string;
  readonly headSha: string;
  readonly authority: "ZERO_AUTHORITY";
}

export interface EvolutionExecutionEnvelope {
  readonly executionId: string;
  readonly dedupeKey: string;
  readonly repository: string;
  readonly headSha: string;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

const SHA = /^[0-9a-f]{40}$/i;

export function createEvolutionExecutionEnvelope(request: EvolutionExecutionRequest): EvolutionExecutionEnvelope {
  if (!request.executionId || !request.dedupeKey || !request.repository) throw new Error("EVOLVE_EXECUTION_IDENTITY_REQUIRED");
  if (!SHA.test(request.headSha)) throw new Error("EVOLVE_EXECUTION_HEAD_SHA_INVALID");
  if (request.authority !== "ZERO_AUTHORITY") throw new Error("EVOLVE_EXECUTION_AUTHORITY_INVALID");
  return Object.freeze({
    executionId: request.executionId,
    dedupeKey: request.dedupeKey,
    repository: request.repository,
    headSha: request.headSha,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}
