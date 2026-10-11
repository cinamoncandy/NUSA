/**
 * Runner readiness (preflight). Pure and read-only: it names what the runner lacks to execute a coding
 * request, so an INTERFACE_READY result says exactly which configuration is missing instead of only
 * "not configured". It checks presence, never values, grants nothing and never reads a secret.
 */
export interface CodingRunnerReadinessInput {
  readonly hasWorkersAiBinding: boolean;
  readonly hasConfiguredEngine: boolean;
  readonly hasGithubToken: boolean;
  readonly zeroCreditMode: boolean;
}

export type CodingRunnerReadinessBlocker = "ZERO_CREDIT_PAID_ENGINE_DISABLED" | "CODING_ENGINE_NOT_CONFIGURED" | "GITHUB_TOKEN_MISSING";

export interface CodingRunnerReadiness {
  readonly ready: boolean;
  readonly blockers: readonly CodingRunnerReadinessBlocker[];
}

export function assessCodingRunnerReadiness(input: CodingRunnerReadinessInput): CodingRunnerReadiness {
  const blockers: CodingRunnerReadinessBlocker[] = [];
  if (!input.hasWorkersAiBinding) {
    if (input.zeroCreditMode) blockers.push("ZERO_CREDIT_PAID_ENGINE_DISABLED");
    else if (!input.hasConfiguredEngine) blockers.push("CODING_ENGINE_NOT_CONFIGURED");
  }
  if (!input.hasGithubToken) blockers.push("GITHUB_TOKEN_MISSING");
  return Object.freeze({ ready: blockers.length === 0, blockers: Object.freeze(blockers) });
}
