import type { StrategySignal } from "../../../desktop/src/strategyEngine";

/**
 * The "TradingIntent" pipeline stage: a directional decision from an indicator/strategy,
 * not yet risk-checked or sized. Structurally identical to StrategyEngine's StrategySignal
 * (apps/desktop/src/strategyEngine.ts) -- this alias gives the concept its own name at the
 * pipeline boundary without duplicating or modifying that type.
 */
export type TradingIntent = StrategySignal;
