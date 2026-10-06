import type { ResearchComparisonEvidence, ResearchInputSnapshot } from "../../../packages/contracts/src/researchRuntime";
import type { GeneratedStrategy } from "../../../packages/core/src/optimizer/aiStrategyEngine";
import type { ResearchCandleSource } from "./backtestResearchEvaluator";
import { buildResearchProvenance, canonicalSha256, hashResearchInputCore, ResearchProvenanceError } from "./researchProvenanceBuilder";
import { buildWalkForwardWindows, type WalkForwardWindowConfig } from "./researchWalkForwardWindows";
import type { HoldoutKey } from "../../../packages/storage/src/researchHoldoutLedger";

/**
 * Runs one experiment for one challenger variant: VALIDATION window first; the HOLDOUT window is evaluated only when
 * validation favours the challenger AND the holdout was never used for that configuration (durable claim). Every
 * problem becomes a SKIPPED or ERROR outcome with a stable reason; nothing is retried, repaired or forced.
 * Ports are injected; this class owns no timer, storage or runtime.
 */
export interface ExperimentRunnerPorts {
  /** ResearchAutomationRuntime.runExperiment (or any equivalent) */
  readonly runExperiment: (input: ResearchInputSnapshot) => ResearchComparisonEvidence;
  readonly candles: ResearchCandleSource;
  readonly holdout: { claim(key: HoldoutKey, evaluationId: string, usedAtMs: number): "CLAIMED" | "ALREADY_USED"; overlapsUsedHoldout(hash: string, market: string, intervalMs: number, startMs: number, endMs: number): boolean };
  readonly now: () => number;
}

export interface ExperimentSpec {
  readonly sessionId: string;
  readonly market: string;
  readonly intervalMs: number;
  readonly endCloseMs: number;
  readonly windows: WalkForwardWindowConfig;
  readonly champion: { readonly strategy: GeneratedStrategy; readonly config: unknown };
  readonly challenger: { readonly strategy: GeneratedStrategy; readonly config: unknown };
  readonly featurePipeline: { readonly version: string; readonly config: Readonly<Record<string, unknown>> };
  readonly evaluator: { readonly version: string; readonly modelVersion: string };
  readonly models: { readonly fill: string; readonly fee: string; readonly slippage: string };
  readonly sourceCommitSha: string;
  readonly experimentFamilyId: string;
  readonly attempt: number;
  readonly hypothesisLineage: string;
  readonly split: { readonly identity: string };
  readonly walkForwardConfig: unknown;
}

export type ExperimentOutcome =
  | { readonly status: "SKIPPED"; readonly reason: string }
  | { readonly status: "ERROR"; readonly reason: string }
  | { readonly status: "COMPLETED"; readonly validation: ResearchComparisonEvidence; readonly holdout: ResearchComparisonEvidence | null; readonly holdoutNote?: "VALIDATION_NOT_FAVOURABLE" | "HOLDOUT_ALREADY_USED" | "HOLDOUT_OVERLAPS_USED" };

const skip = (reason: string): ExperimentOutcome => Object.freeze({ status: "SKIPPED", reason });

export function runResearchExperiment(ports: ExperimentRunnerPorts, spec: ExperimentSpec): ExperimentOutcome {
  try {
    const now = ports.now();
    const intervalMs = spec.intervalMs;
    const total = spec.windows.trainMs + spec.windows.validationMs + spec.windows.holdoutMs;
    const rows = ports.candles.read(spec.market, intervalMs, spec.endCloseMs - total + intervalMs, spec.endCloseMs);
    const built = buildWalkForwardWindows({ candles: rows.map((r) => ({ timestamp: r.closeTimeMs, open: r.open, high: r.high, low: r.low, close: r.close, volume: 0 })), endCloseMs: spec.endCloseMs, config: spec.windows });
    if (built.status === "REFUSED") return skip(`WINDOWS_${built.reason}${built.window ? `_${built.window.toUpperCase()}` : ""}`);

    const challengerConfigHash = canonicalSha256(spec.challenger.config);
    const idBase = `${spec.sessionId}:${challengerConfigHash.slice(0, 12)}:${spec.endCloseMs}`;
    const windows = {
      train: { windowId: `${idBase}:train`, candles: built.train },
      validation: { windowId: `${idBase}:validation`, candles: built.validation },
      holdout: { windowId: `${idBase}:holdout`, candles: built.holdout },
    };

    const run = (role: "VALIDATION" | "HOLDOUT"): ResearchComparisonEvidence => {
      const roleWindow = role === "VALIDATION" ? windows.validation : windows.holdout;
      const points = roleWindow.candles.map((c) => ({ market: spec.market, price: c.close, observedAt: c.timestamp }));
      const lastClose = roleWindow.candles[roleWindow.candles.length - 1]!.timestamp;
      const firstClose = roleWindow.candles[0]!.timestamp;
      const evaluationId = `${idBase}:${role.toLowerCase()}`;
      const core = {
        researchRunId: spec.sessionId,
        evaluationId,
        strategyId: spec.challenger.strategy.strategyId,
        strategyVersion: spec.challenger.strategy.version,
        marketDataTimestamp: lastClose,
        evaluationTimestamp: lastClose,
        modelVersion: spec.evaluator.modelVersion,
        fillModelVersion: spec.models.fill,
        feeModelVersion: spec.models.fee,
        slippageModelVersion: spec.models.slippage,
        strategyState: "RESEARCHING",
        // Every point of the window must count as fresh relative to the evaluation time (historical replay).
        staleWindowMs: lastClose - firstClose + 2 * intervalMs,
        marketData: points,
        startingCash: 1,
        startingPositionQuantity: 0,
      } as unknown as ResearchInputSnapshot;
      const provenance = buildResearchProvenance({
        role,
        researchRunId: spec.sessionId,
        sessionId: spec.sessionId,
        experimentId: evaluationId,
        evaluationId,
        market: spec.market,
        intervalMs,
        windows,
        featurePipeline: spec.featurePipeline,
        strategy: { id: spec.challenger.strategy.strategyId, version: spec.challenger.strategy.version, artifact: spec.challenger.strategy.dsl, config: spec.challenger.config },
        evaluator: spec.evaluator,
        models: spec.models,
        sourceCommitSha: spec.sourceCommitSha,
        split: { identity: spec.split.identity, definition: { ...spec.windows } },
        walkForwardConfig: spec.walkForwardConfig,
        experimentFamilyId: spec.experimentFamilyId,
        attempt: spec.attempt,
        hypothesisLineage: spec.hypothesisLineage,
        finalHoldoutUntouched: true,
        canonicalInputHash: hashResearchInputCore(core),
      });
      return ports.runExperiment({ ...core, provenance } as ResearchInputSnapshot);
    };

    const validation = run("VALIDATION");
    if (validation.result !== "CHALLENGER_BETTER") return Object.freeze({ status: "COMPLETED", validation, holdout: null, holdoutNote: "VALIDATION_NOT_FAVOURABLE" });

    const key: HoldoutKey = { strategyConfigHash: challengerConfigHash, market: spec.market, intervalMs, holdoutStartMs: built.bounds.holdout.startCloseMs, holdoutEndMs: built.bounds.holdout.endCloseMs };
    if (ports.holdout.overlapsUsedHoldout(challengerConfigHash, spec.market, intervalMs, key.holdoutStartMs, key.holdoutEndMs)) return Object.freeze({ status: "COMPLETED", validation, holdout: null, holdoutNote: "HOLDOUT_OVERLAPS_USED" });
    if (ports.holdout.claim(key, `${idBase}:holdout`, now) === "ALREADY_USED") return Object.freeze({ status: "COMPLETED", validation, holdout: null, holdoutNote: "HOLDOUT_ALREADY_USED" });
    return Object.freeze({ status: "COMPLETED", validation, holdout: run("HOLDOUT") });
  } catch (error) {
    const reason = error instanceof ResearchProvenanceError ? `PROVENANCE_${error.code}` : typeof (error as { code?: unknown })?.code === "string" ? String((error as { code: string }).code) : "EXPERIMENT_FAILED";
    return Object.freeze({ status: "ERROR", reason });
  }
}
