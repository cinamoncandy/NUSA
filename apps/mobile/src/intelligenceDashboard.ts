export type MarketDirection = "BULLISH" | "SIDEWAYS" | "BEARISH";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type NewsCategory = "MACRO" | "CRYPTO" | "REGULATION" | "SECURITY" | "EXCHANGE" | "PROJECT" | "GEOPOLITICS";
export type NewsSentiment = "POSITIVE" | "NEUTRAL" | "NEGATIVE";

export interface IntelligenceNewsItem {
  readonly id: string;
  readonly headline: string;
  readonly category: NewsCategory;
  readonly source: string;
  readonly publishedAt: number;
  readonly reliability: number;
  readonly impact: number;
  readonly sentiment: NewsSentiment;
  readonly relatedAssets: readonly string[];
  readonly summary: string;
}

export interface MarketScenario {
  readonly direction: MarketDirection;
  readonly probability: number;
  readonly plan: string;
}

export interface IntelligenceSignal {
  readonly id: string;
  readonly label: string;
  readonly score: number;
  readonly explanation: string;
}

export interface IntelligenceDashboardInput {
  readonly generatedAt: number;
  readonly confidence: number;
  readonly riskLevel: RiskLevel;
  readonly outlook: string;
  readonly news: readonly IntelligenceNewsItem[];
  readonly scenarios: readonly MarketScenario[];
  readonly signals: readonly IntelligenceSignal[];
}

export interface IntelligenceNewsCard extends IntelligenceNewsItem {
  readonly priorityScore: number;
}

export interface IntelligenceDashboard {
  readonly generatedAt: number;
  readonly confidence: number;
  readonly riskLevel: RiskLevel;
  readonly outlook: string;
  readonly topNews: readonly IntelligenceNewsCard[];
  readonly scenarios: readonly MarketScenario[];
  readonly signals: readonly IntelligenceSignal[];
  readonly primaryScenario: MarketScenario;
  readonly disclaimer: "SCENARIO_NOT_PREDICTION";
}

const assertFiniteRange = (value: number, minimum: number, maximum: number, field: string): void => {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${field} must be finite and between ${minimum} and ${maximum}`);
  }
};

const assertText = (value: string, field: string): void => {
  if (value.trim().length === 0) {
    throw new Error(`${field} must not be empty`);
  }
};

const uniqueSortedStrings = (values: readonly string[]): readonly string[] => {
  const normalized = values.map((value) => value.trim()).filter((value) => value.length > 0);
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("relatedAssets must not contain duplicates");
  }
  return Object.freeze([...normalized].sort((left, right) => left.localeCompare(right)));
};

const validateNews = (news: readonly IntelligenceNewsItem[]): readonly IntelligenceNewsCard[] => {
  const ids = new Set<string>();
  const cards = news.map((item) => {
    assertText(item.id, "news.id");
    assertText(item.headline, "news.headline");
    assertText(item.source, "news.source");
    assertText(item.summary, "news.summary");
    if (!Number.isSafeInteger(item.publishedAt) || item.publishedAt < 0) {
      throw new Error("news.publishedAt must be a non-negative safe integer");
    }
    assertFiniteRange(item.reliability, 0, 1, "news.reliability");
    assertFiniteRange(item.impact, 0, 100, "news.impact");
    if (ids.has(item.id)) {
      throw new Error(`duplicate news id: ${item.id}`);
    }
    ids.add(item.id);
    const relatedAssets = uniqueSortedStrings(item.relatedAssets);
    return Object.freeze({
      ...item,
      relatedAssets,
      priorityScore: Number((item.impact * item.reliability).toFixed(6))
    });
  });

  return Object.freeze(cards.sort((left, right) =>
    right.priorityScore - left.priorityScore ||
    right.publishedAt - left.publishedAt ||
    left.id.localeCompare(right.id)
  ));
};

const validateScenarios = (scenarios: readonly MarketScenario[]): readonly MarketScenario[] => {
  if (scenarios.length !== 3) {
    throw new Error("exactly three market scenarios are required");
  }
  const directions = new Set(scenarios.map((scenario) => scenario.direction));
  if (directions.size !== 3) {
    throw new Error("market scenarios must contain BULLISH, SIDEWAYS, and BEARISH exactly once");
  }
  let total = 0;
  for (const scenario of scenarios) {
    assertFiniteRange(scenario.probability, 0, 1, "scenario.probability");
    assertText(scenario.plan, "scenario.plan");
    total += scenario.probability;
  }
  if (Math.abs(total - 1) > 1e-9) {
    throw new Error("scenario probabilities must sum to 1");
  }
  return Object.freeze([...scenarios].sort((left, right) =>
    right.probability - left.probability || left.direction.localeCompare(right.direction)
  ).map((scenario) => Object.freeze({ ...scenario })));
};

const validateSignals = (signals: readonly IntelligenceSignal[]): readonly IntelligenceSignal[] => {
  const ids = new Set<string>();
  const normalized = signals.map((signal) => {
    assertText(signal.id, "signal.id");
    assertText(signal.label, "signal.label");
    assertText(signal.explanation, "signal.explanation");
    assertFiniteRange(signal.score, 0, 100, "signal.score");
    if (ids.has(signal.id)) {
      throw new Error(`duplicate signal id: ${signal.id}`);
    }
    ids.add(signal.id);
    return Object.freeze({ ...signal });
  });
  return Object.freeze(normalized.sort((left, right) =>
    right.score - left.score || left.id.localeCompare(right.id)
  ));
};

export const buildIntelligenceDashboard = (
  input: IntelligenceDashboardInput,
  maximumNewsItems = 5
): IntelligenceDashboard => {
  if (!Number.isSafeInteger(input.generatedAt) || input.generatedAt < 0) {
    throw new Error("generatedAt must be a non-negative safe integer");
  }
  assertFiniteRange(input.confidence, 0, 1, "confidence");
  assertText(input.outlook, "outlook");
  if (!Number.isSafeInteger(maximumNewsItems) || maximumNewsItems < 1) {
    throw new Error("maximumNewsItems must be a positive safe integer");
  }

  const scenarios = validateScenarios(input.scenarios);
  const topNews = Object.freeze(validateNews(input.news).slice(0, maximumNewsItems));
  const signals = validateSignals(input.signals);

  return Object.freeze({
    generatedAt: input.generatedAt,
    confidence: input.confidence,
    riskLevel: input.riskLevel,
    outlook: input.outlook.trim(),
    topNews,
    scenarios,
    signals,
    primaryScenario: scenarios[0],
    disclaimer: "SCENARIO_NOT_PREDICTION"
  });
};
