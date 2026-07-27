/** Paper-only pre-trade risk decision contract. This contract cannot grant production authority. */
export type RiskGatewayStatus = "ALLOW" | "REJECT" | "HALT";

/**
 * Every reason code declared here MUST be reachable by the evaluator. A gateway that
 * advertises a limit it never enforces reads as coverage that does not exist, which is
 * worse than not declaring the limit at all. `tests/independent-risk-gateway-coverage.test.js`
 * asserts that each code below is emitted by at least one crafted request.
 */
export type RiskReasonCode =
  | "LIVE_CAPABILITY_DETECTED"
  | "PRIVATE_API_CAPABILITY_DETECTED"
  | "KILL_SWITCH_ACTIVE"
  | "DEPLOYMENT_INTEGRITY_FAILED"
  | "STRATEGY_FINGERPRINT_MISMATCH"
  | "CONFIG_FINGERPRINT_MISMATCH"
  | "RUNTIME_FINGERPRINT_MISMATCH"
  | "RISK_POLICY_FINGERPRINT_MISMATCH"
  | "APPROVAL_MISSING"
  | "APPROVAL_EXPIRED"
  | "APPROVAL_SCOPE_MISMATCH"
  | "PERSISTENCE_UNHEALTHY"
  | "RECONCILIATION_FAILED"
  | "OPEN_P0_ALERT"
  | "MARKET_DATA_STALE"
  | "MARKET_DATA_RECONNECTING"
  | "MARKET_DATA_WARMING_UP"
  | "MARKET_DATA_GAP"
  | "MARKET_DATA_OUT_OF_ORDER"
  | "MARKET_DATA_INVALID"
  | "PRICE_DEVIATION_LIMIT"
  | "DUPLICATE_SIGNAL"
  | "DUPLICATE_COMMAND"
  | "DUPLICATE_CLIENT_ORDER_ID"
  | "ORDER_RATE_LIMIT_PER_SECOND"
  | "ORDER_RATE_LIMIT_PER_MINUTE"
  | "SAME_SIDE_BURST_LIMIT"
  | "OPEN_ORDER_LIMIT"
  | "MAX_ORDER_NOTIONAL"
  | "MAX_POSITION_NOTIONAL"
  | "MAX_SYMBOL_EXPOSURE"
  | "MAX_PORTFOLIO_EXPOSURE"
  | "MAX_DAILY_BUY_NOTIONAL"
  | "MAX_DAILY_SELL_NOTIONAL"
  | "INSUFFICIENT_CASH"
  | "INSUFFICIENT_POSITION"
  | "DAILY_LOSS_LIMIT"
  | "CONSECUTIVE_LOSS_LIMIT"
  | "SESSION_DRAWDOWN_LIMIT"
  | "INVALID_REQUEST";

export type MarketDataStatus =
  | "HEALTHY"
  | "STALE"
  | "RECONNECTING"
  | "WARMING_UP"
  | "GAP_DETECTED"
  | "OUT_OF_ORDER"
  | "INVALID";

export interface PreTradeRiskRequest {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly signalId: string;
  readonly commandId: string;
  readonly clientOrderId: string;
  readonly strategyFingerprint: string;
  readonly configFingerprint: string;
  readonly runtimeFingerprint: string;
  readonly riskPolicyFingerprint: string;
  readonly symbol: string;
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
  readonly referencePrice: number;
  readonly requestedAt: number;
  readonly marketDataState: { readonly status: MarketDataStatus; readonly price: number | null };
  readonly accountState: { readonly cash: number; readonly positionQuantity: number; readonly openOrderCount: number };
  readonly controlState: { readonly killSwitchActive: boolean; readonly liveCapabilityDetected: boolean; readonly privateApiCapabilityDetected: boolean };
  readonly approvalState: { readonly approved: boolean; readonly expiresAt: number; readonly symbols: readonly string[] };
  readonly persistenceState: { readonly healthy: boolean };
  readonly reconciliationState: { readonly healthy: boolean; readonly openP0: boolean };
  /** Verified integrity of the running deployment. Missing or false halts every order. */
  readonly deploymentState: { readonly integrityVerified: boolean };
  /** Order flow leading up to this request, counted by the caller. */
  readonly rateState: { readonly ordersInLastSecond: number; readonly ordersInLastMinute: number; readonly sameSideStreak: number };
  /** Exposure and traded notional the caller has already accounted for. */
  readonly exposureState: {
    readonly symbolExposureNotional: number;
    readonly portfolioExposureNotional: number;
    readonly dailyBuyNotional: number;
    readonly dailySellNotional: number;
  };
  /** Session outcome state, used by the loss and drawdown circuit breakers. */
  readonly sessionState: {
    readonly dailyRealizedPnL: number;
    readonly consecutiveLossCount: number;
    readonly sessionPeakEquity: number;
    readonly sessionEquity: number;
  };
}

export interface PreTradeRiskDecision {
  readonly status: RiskGatewayStatus;
  readonly reasonCodes: readonly RiskReasonCode[];
  readonly evaluatedAt: number;
  readonly requestSha256: string;
  readonly decisionSha256: string;
  readonly productionMutationAllowed: false;
}

/** Deployment-level safety gate, evaluated before any Paper automation may run. */
export type DeploymentSafetyStatus = "ALLOW" | "HALT";

export type DeploymentReasonCode =
  | "LIVE_TRADING_CAPABILITY_PRESENT"
  | "PRIVATE_API_CAPABILITY_PRESENT"
  | "CREDENTIAL_STORAGE_PRESENT"
  | "ARTIFACT_HASH_MISMATCH"
  | "SOURCE_COMMIT_MISMATCH"
  | "KILL_SWITCH_UNREACHABLE"
  | "PERSISTENCE_SCHEMA_MISMATCH"
  | "AUTO_TRADE_DEFAULT_ON"
  | "RISK_GATEWAY_ABSENT"
  | "INVALID_DESCRIPTOR";

export interface DeploymentSafetyDescriptor {
  readonly schemaVersion: 1;
  readonly deploymentId: string;
  readonly sourceCommitSha: string;
  readonly expectedSourceCommitSha: string;
  readonly artifactSha256: string;
  readonly expectedArtifactSha256: string;
  readonly persistenceSchemaVersion: number;
  readonly expectedPersistenceSchemaVersion: number;
  readonly liveTradingCapabilityPresent: boolean;
  readonly privateApiCapabilityPresent: boolean;
  readonly credentialStoragePresent: boolean;
  readonly killSwitchReachable: boolean;
  readonly autoTradeDefaultEnabled: boolean;
  readonly riskGatewayPresent: boolean;
}

export interface DeploymentSafetyDecision {
  readonly status: DeploymentSafetyStatus;
  readonly reasonCodes: readonly DeploymentReasonCode[];
  readonly descriptorSha256: string;
  readonly decisionSha256: string;
  readonly productionMutationAllowed: false;
}
