import type { ResearchRecoveryResult } from "../../../packages/contracts/src/researchRecovery";
import type { ResearchStatusProjection } from "../../../packages/contracts/src/researchAutomation";
import type { ResearchRuntimeMarketDataTick } from "./researchRuntimeCoordinator";
import type { CloudRuntimeResearchAutomationLike, CloudRuntimeResearchRecoveryLike, CloudRuntimeResearchRuntimeLike } from "./runtime";

const FAIL_CLOSED_REASON = "RESEARCH_PRODUCTION_COMPOSITION_UNAVAILABLE";

const recoveryResult = (): ResearchRecoveryResult => Object.freeze({
  status: "FAIL_CLOSED",
  snapshot: null,
  reasons: Object.freeze([FAIL_CLOSED_REASON]),
});

export interface ProductionResearchComposition {
  readonly researchRuntime: CloudRuntimeResearchRuntimeLike;
  readonly researchRecoveryCoordinator: CloudRuntimeResearchRecoveryLike;
  readonly researchAutomation: CloudRuntimeResearchAutomationLike;
}

/**
 * Explicit production composition boundary.
 *
 * Research must never be silently omitted from the Cloud runtime. Until the
 * durable Research dependency graph is constructed by its canonical owner,
 * the boundary is explicit and fail-closed rather than positional omission.
 *
 * This object owns no Research state, strategy evaluation, promotion, broker,
 * LIVE authority, or capital mutation.
 */
export function createProductionResearchComposition(): ProductionResearchComposition {
  const onMarketData = (_tick: ResearchRuntimeMarketDataTick): void => {
    throw new Error(FAIL_CLOSED_REASON);
  };

  const researchRuntime: CloudRuntimeResearchRuntimeLike = Object.freeze({ onMarketData });
  const researchRecoveryCoordinator: CloudRuntimeResearchRecoveryLike = Object.freeze({
    recover: recoveryResult,
  });
  const researchAutomation: CloudRuntimeResearchAutomationLike = Object.freeze({
    recover: recoveryResult,
    onMarketData,
    statusProjection: (): ResearchStatusProjection | null => null,
  });

  return Object.freeze({
    researchRuntime,
    researchRecoveryCoordinator,
    researchAutomation,
  });
}
