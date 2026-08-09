import { createHash } from "node:crypto";
import { CanonicalRiskSafetyGate } from "../../execution/src/risk-safety-integration";
import { SqliteDatabase } from "../../../packages/storage/src/index";
import { SqliteRiskSafetyPersistence } from "../../../packages/storage/src/risk-safety";
import { createCloudAiRuntime } from "./ai/runtime";
import { readCloudRuntimeConfig } from "./cloudRuntimeConfig";
import { SqliteP0AlertRepository } from "./p0AlertRepository";
import { SqliteCloudPaperAccountRepository } from "./paperTradingExecutionLoop";
import {
  OraclePaperTradingExecutionLoop,
  type OracleCanonicalRiskEvaluationInput
} from "./oraclePaperTradingExecutionLoop";
import { registerGracefulShutdown, startCloudRuntime } from "./runtime";

export const ORACLE_PAPER_STRATEGY_ID = "cloud-cio-paper-v1";
export const ORACLE_PAPER_ACCOUNT_ID = "paper-default";

export interface OraclePaperRiskConfig {
  readonly policyFingerprint: string;
  readonly maxDailyLossKrw: number;
  readonly maxOpenOrders: number;
  approvalIdForMarket(market: string): string | undefined;
}

const requireText = (env: NodeJS.ProcessEnv, key: string): string => {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required when Oracle PAPER execution is enabled`);
  return value;
};

const readPositiveNumber = (env: NodeJS.ProcessEnv, key: string): number => {
  const raw = requireText(env, key);
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${key} must be a positive number`);
  return value;
};

const readPositiveInteger = (env: NodeJS.ProcessEnv, key: string): number => {
  const value = readPositiveNumber(env, key);
  if (!Number.isSafeInteger(value)) throw new Error(`${key} must be a positive safe integer`);
  return value;
};

const marketApprovalKey = (market: string): string => `NUSA_CLOUD_PAPER_APPROVAL_ID_${market.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;

export function readOraclePaperRiskConfig(env: NodeJS.ProcessEnv): OraclePaperRiskConfig {
  const policyFingerprint = requireText(env, "NUSA_CLOUD_RISK_POLICY_FINGERPRINT");
  const maxDailyLossKrw = readPositiveNumber(env, "NUSA_CLOUD_PAPER_MAX_DAILY_LOSS_KRW");
  const maxOpenOrders = readPositiveInteger(env, "NUSA_CLOUD_PAPER_MAX_OPEN_ORDERS");
  return Object.freeze({
    policyFingerprint,
    maxDailyLossKrw,
    maxOpenOrders,
    approvalIdForMarket(market: string): string | undefined {
      const specific = env[marketApprovalKey(market)]?.trim();
      const fallback = env.NUSA_CLOUD_PAPER_APPROVAL_ID?.trim();
      return specific || fallback || undefined;
    }
  });
}

function canonicalId(prefix: string, value: string): string {
  return `${prefix}:${createHash("sha256").update(value, "utf8").digest("hex").slice(0, 24)}`;
}

export function createOracleCanonicalRiskAdapter(
  gate: CanonicalRiskSafetyGate,
  config: OraclePaperRiskConfig
): Readonly<{ evaluate(input: OracleCanonicalRiskEvaluationInput): ReturnType<CanonicalRiskSafetyGate["evaluate"]> }> {
  return Object.freeze({
    evaluate(input: OracleCanonicalRiskEvaluationInput) {
      const signalId = `cio:${input.market}:${input.strategyDecisionAt}`;
      return gate.evaluate(Object.freeze({
        accountId: ORACLE_PAPER_ACCOUNT_ID,
        requestId: input.idempotencyKey,
        boundary: "STRATEGY" as const,
        mode: "PAPER" as const,
        symbol: input.market,
        side: input.side,
        strategyId: ORACLE_PAPER_STRATEGY_ID,
        policyFingerprint: config.policyFingerprint,
        ...(config.approvalIdForMarket(input.market) ? { approvalId: config.approvalIdForMarket(input.market) } : {}),
        nowMs: input.nowMs,
        currentEquity: input.currentEquity,
        marketDataFresh: input.marketDataFresh,
        marketHealthy: input.marketHealthy,
        killSwitchActive: input.killSwitchActive,
        liveMutationAllowed: false as const,
        recoveryReady: true,
        persistenceHealthy: true,
        maxDailyLoss: config.maxDailyLossKrw,
        maxOpenOrders: config.maxOpenOrders,
        idempotency: Object.freeze({
          accountId: ORACLE_PAPER_ACCOUNT_ID,
          commandId: input.idempotencyKey,
          signalId,
          clientOrderId: canonicalId("paper", input.idempotencyKey),
          payloadFingerprint: input.idempotencyKey,
          createdAtMs: input.nowMs
        })
      }));
    }
  });
}

export function startOracleRuntime(env: NodeJS.ProcessEnv = process.env): ReturnType<typeof startCloudRuntime> {
  const cloudConfig = readCloudRuntimeConfig(env);
  if (cloudConfig.paperInitialCapitalKrw === undefined) {
    return startCloudRuntime(env, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, createCloudAiRuntime(env));
  }
  if (!env.NUSA_CLOUD_STATE_DB_PATH?.trim()) {
    throw new Error("NUSA_CLOUD_STATE_DB_PATH is required when Oracle PAPER execution is enabled");
  }

  const riskConfig = readOraclePaperRiskConfig(env);
  const database = new SqliteDatabase(cloudConfig.cloudStateDbPath);
  const paperRepository = new SqliteCloudPaperAccountRepository(database);
  const p0Repository = new SqliteP0AlertRepository(database);
  const riskGate = new CanonicalRiskSafetyGate(new SqliteRiskSafetyPersistence(database));
  const paperLoop = new OraclePaperTradingExecutionLoop({
    initialCapital: cloudConfig.paperInitialCapitalKrw,
    repository: paperRepository,
    readP0State: () => p0Repository.readState(),
    canonicalRiskGate: createOracleCanonicalRiskAdapter(riskGate, riskConfig)
  });

  let runtime: ReturnType<typeof startCloudRuntime>;
  try {
    runtime = startCloudRuntime(env, undefined, undefined, undefined, undefined, paperRepository, paperLoop, undefined, undefined, undefined, createCloudAiRuntime(env));
  } catch (error) {
    database.close();
    throw error;
  }
  let stopping: Promise<void> | undefined;
  return Object.freeze({
    ...runtime,
    stop(): Promise<void> {
      if (stopping) return stopping;
      stopping = runtime.stop().finally(() => database.close());
      return stopping;
    }
  });
}

function main(): void {
  const handle = startOracleRuntime(process.env);
  registerGracefulShutdown(handle);
}

if (require.main === module) main();
