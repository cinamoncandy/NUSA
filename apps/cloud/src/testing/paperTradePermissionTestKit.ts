import type { ProbabilityEstimate } from "../probabilityEngine";
import { evaluateTradePermission, type TradePermissionInput, type TradePermissionPolicy, type TradePermissionResult } from "../tradePermissionEngine";
import type { PaperTradePermissionAuthority, PaperTradePermissionQuery, PaperTradePermissionRecord } from "../paperTradePermissionGuard";

/**
 * TEST ONLY. Never imported by the runtime (a source test pins that). Builds permits with the real canonical engine
 * (no hand-made result objects), valid for any clock value >= 0, so execution-boundary tests that are not about
 * permission keep exercising the real order path. The runtime itself uses NO_PAPER_TRADE_PERMISSION_AUTHORITY.
 */
export const TEST_POLICY_VERSION = "test-policy-v1";
export const TEST_MODEL_VERSION = "test-model-v1";
const EPOCH = "1970-01-01T00:00:00.000Z";

export const testPermissionPolicy = (overrides: Partial<TradePermissionPolicy> = {}): TradePermissionPolicy => Object.freeze({
  policyVersion: TEST_POLICY_VERSION, minimumDataQuality: 0.5, maximumAgeMs: 4_000_000_000_000, compatibleRegimes: Object.freeze(["TEST"]),
  minimumCalibratedProbability: 0.5, minimumNetExpectedValue: 0, minimumRewardToRisk: 1, minimumLiquidityScore: 0.5, minimumCapacityUsd: 0,
  maximumSlippageBps: 100, maximumUncertainty: 0.5, maximumModelDispersion: 0.5, maximumRiskBudgetUsage: 1, permissionTtlMs: 4_000_000_000_000, ...overrides
});

export const testProbability = (market: string, overrides: Partial<ProbabilityEstimate> = {}): ProbabilityEstimate => ({
  market, outcomeDefinition: "test", rawProbability: 0.7, calibratedProbability: 0.7, confidence: 0.7, uncertainty: 0.1, abstain: false,
  abstainReasons: [], evidence: [], metrics: { sampleSize: 0, brierScore: null, logLoss: null, expectedCalibrationError: null, sharpness: null, reliability: [] },
  modelVersion: TEST_MODEL_VERSION, generatedAt: EPOCH, ...overrides
});

export interface TestPermitOverrides {
  readonly governanceApproved?: boolean;
  readonly killSwitchActive?: boolean;
  readonly riskBudgetUsage?: number;
  readonly policy?: Partial<TradePermissionPolicy>;
  readonly probability?: Partial<ProbabilityEstimate>;
  readonly decisionId?: string;
  readonly strategyId?: string;
  readonly market?: string;
  readonly generatedAt?: string;
  readonly evidenceReferences?: readonly string[];
}

export const testPermitInput = (query: PaperTradePermissionQuery, overrides: TestPermitOverrides = {}): TradePermissionInput => {
  const market = overrides.market ?? query.market;
  return {
    decisionId: overrides.decisionId ?? query.decisionId, strategyId: overrides.strategyId ?? query.strategyId, market,
    generatedAt: overrides.generatedAt ?? EPOCH, probability: testProbability(market, overrides.probability), dataQuality: 0.9, sourceGeneratedAt: overrides.generatedAt ?? EPOCH, regime: "TEST",
    netExpectedValue: 1, expectedReward: 2, expectedLoss: 1, liquidityScore: 0.9, capacityUsd: 1_000_000, estimatedSlippageBps: 1,
    modelProbabilities: [0.7, 0.7], riskBudgetUsage: overrides.riskBudgetUsage ?? 0.1, killSwitchActive: overrides.killSwitchActive ?? false,
    governanceApproved: overrides.governanceApproved ?? true, evidenceReferences: overrides.evidenceReferences ?? ["test-evidence-1"]
  };
};

export const testPermit = (query: PaperTradePermissionQuery, overrides: TestPermitOverrides = {}): TradePermissionResult =>
  evaluateTradePermission(testPermitInput(query, overrides), testPermissionPolicy(overrides.policy));

/** A record = the evidence input plus the permit the real engine computed from it. */
export const testRecord = (query: PaperTradePermissionQuery, overrides: TestPermitOverrides = {}): PaperTradePermissionRecord => ({
  input: testPermitInput(query, overrides), permit: testPermit(query, overrides)
});

export const acceptingPaperTradePermissionAuthority = (): PaperTradePermissionAuthority => ({
  policy: testPermissionPolicy(), probabilityModelVersion: TEST_MODEL_VERSION,
  latestPermit: (query) => testRecord(query), evidenceExists: () => true
});
