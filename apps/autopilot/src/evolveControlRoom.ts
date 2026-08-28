export interface EvolutionControlSnapshot {
  readonly generatedAt: string;
  readonly activeExecutions: number;
  readonly queuedOpportunities: number;
  readonly circuitOpen: boolean;
  readonly lastOutcome?: string;
  readonly authority: {
    readonly liveAuthority: "NONE";
    readonly productionMutationAllowed: false;
    readonly aiAuthority: "ZERO_AUTHORITY";
  };
}

export function createEvolutionControlSnapshot(input: Omit<EvolutionControlSnapshot, "authority">): EvolutionControlSnapshot {
  if (!Number.isInteger(input.activeExecutions) || input.activeExecutions < 0) throw new Error("EVOLVE_CONTROL_ACTIVE_EXECUTIONS_INVALID");
  if (!Number.isInteger(input.queuedOpportunities) || input.queuedOpportunities < 0) throw new Error("EVOLVE_CONTROL_QUEUE_INVALID");
  if (Number.isNaN(Date.parse(input.generatedAt))) throw new Error("EVOLVE_CONTROL_TIMESTAMP_INVALID");
  return Object.freeze({
    ...input,
    authority: Object.freeze({
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    }),
  });
}
