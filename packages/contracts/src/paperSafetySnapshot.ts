export interface PaperTradingApproval {
  readonly approvalId: string; readonly mode: "PAPER_MANUAL" | "SHADOW" | "CANARY";
  readonly approvedBy: string; readonly approvedAt: number; readonly expiresAt: number; readonly allowedSymbol: string;
  readonly strategyFingerprint: string; readonly configFingerprint: string; readonly runtimeFingerprint: string; readonly riskPolicyFingerprint: string;
  readonly maximumOrders: number; readonly maximumCompletedTrades: number; readonly maximumSessionLoss: number; readonly maximumSessionDuration: number;
}

/** Durable Paper-only safety state. It never grants production authority. */
export interface PersistedTradingAlert {
  readonly alertId: string;
  readonly severity: "P0" | "P1" | "P2";
  readonly status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
  readonly reasonCode: string;
  readonly createdAt: number;
  readonly acknowledgedBy?: string;
  readonly resolutionEvidence?: string;
}

export interface PaperSafetySnapshot {
  readonly schemaVersion: 1;
  readonly snapshotId: string;
  readonly createdAt: number;
  readonly automaticTrading: false;
  readonly tradingMode: "SHADOW" | "PAPER_MANUAL" | "PAPER_CANARY" | "PAPER_EXTENDED";
  readonly killSwitch: { readonly active: boolean; readonly activatedAt: number | null; readonly reason: string | null };
  readonly approval: PaperTradingApproval | null;
  readonly fingerprints: { readonly strategy: string; readonly config: string; readonly runtime: string; readonly riskPolicy: string };
  readonly deploymentIntegrity: { readonly status: "PASS" | "FAIL" | "UNKNOWN"; readonly checkedAt: number | null; readonly reasonCodes: readonly string[] };
  readonly reconciliation: { readonly status: "PASS" | "FAIL" | "REQUIRED" | "UNKNOWN"; readonly checkedAt: number | null; readonly ledgerSha256: string | null; readonly reasonCodes: readonly string[] };
  readonly idempotency: { readonly signalIds: readonly string[]; readonly commandIds: readonly string[]; readonly clientOrderIds: readonly string[]; readonly orderIds: readonly string[]; readonly fillIds: readonly string[] };
  readonly openAlerts: readonly PersistedTradingAlert[];
  readonly lossState: { readonly tradingDay: string; readonly dayStartEquity: number; readonly realizedDailyPnl: number; readonly unrealizedDailyPnl: number; readonly consecutiveLossCount: number; readonly sessionPeakEquity: number; readonly sessionDrawdown: number };
  readonly marketDataRecovery: { readonly status: "WARMING_UP"; readonly consecutiveHealthyClosedCandles: 0; readonly reconnectCount: number };
  readonly sourceCommitSha: string;
  readonly snapshotSha256: string;
  readonly productionMutationAllowed: false;
}
