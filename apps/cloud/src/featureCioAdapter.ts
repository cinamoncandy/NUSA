import type { CioSignal, SignalSource } from "./cioDecisionEngine";
import type { FeaturePipelineResult, FeaturePoint } from "./dataFeaturePipeline";

const SOURCE_MAP: Readonly<Record<FeaturePoint["source"], SignalSource>> = Object.freeze({
  MARKET: "CHART",
  MACRO: "MACRO",
  NEWS: "NEWS",
  ONCHAIN: "ONCHAIN",
  ETF: "ETF",
  FUNDING: "FUNDING",
  OI: "OI",
  RISK: "RISK"
});

const clamp = (value: number): number => Math.min(1, Math.max(-1, value));
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

export function featuresToCioSignals(pipeline: FeaturePipelineResult, symbol: string): readonly CioSignal[] {
  const normalizedSymbol = symbol.trim().toUpperCase();
  if (!normalizedSymbol) throw new Error("symbol is required");
  const groups = new Map<SignalSource, FeaturePoint[]>();

  for (const feature of pipeline.features) {
    if (feature.symbol !== normalizedSymbol || feature.quality !== "GOOD") continue;
    const source = SOURCE_MAP[feature.source];
    const items = groups.get(source) ?? [];
    items.push(feature);
    groups.set(source, items);
  }

  const signals: CioSignal[] = [];
  for (const source of [...groups.keys()].sort()) {
    const features = groups.get(source)!;
    const score = round4(clamp(features.reduce((sum, item) => sum + item.value, 0) / features.length));
    const freshness = Math.max(...features.map((item) => item.observedAt));
    signals.push(Object.freeze({
      source,
      score,
      confidence: round4(Math.min(1, 0.5 + features.length * 0.1)),
      observedAt: freshness,
      reason: features.slice().sort((a, b) => a.feature.localeCompare(b.feature)).map((item) => `${item.feature}=${item.value}`).join("; ")
    }));
  }

  if (signals.length === 0) throw new Error(`no validated features for ${normalizedSymbol}`);
  return Object.freeze(signals);
}
