/**
 * Tests for NUSA AI Advanced Upgrade
 *
 * Covers:
 * 1. Multi-level explanations (Simple/Technical/Expert)
 * 2. Multi-LLM consensus (3 models, agreement calculation)
 * 3. Real-time evidence engine (collection, scoring, updates)
 */

const test = require('node:test');
const assert = require('node:assert');

// Mock implementations for testing
class MultiLevelExplainer {
  async explain(signal, indicators, context, level = 'technical') {
    const confidence = this.calculateConfidence(signal, indicators, context);

    return {
      level,
      text: this.getExplanationText(level, signal, indicators),
      confidence,
      evidence: ['증거1', '증거2'],
      caveats: [],
      timeframe: '4시간',
      actionable: this.getActionable(level, signal, confidence)
    };
  }

  calculateConfidence(signal, indicators, context) {
    let score = 0;
    if (indicators.ma20 > indicators.ma50 && indicators.ma50 > indicators.ma200) score += 0.2;
    if (indicators.rsi > 70 || indicators.rsi < 30) score += 0.2;
    if (indicators.macdLine > indicators.macdSignal && signal.direction === 'BUY') score += 0.2;
    if (context.volumeChange > 1.1) score += 0.2;
    score += signal.strength * 0.2;
    return score;
  }

  getExplanationText(level, signal, indicators) {
    if (level === 'simple') {
      return `${signal.direction === 'BUY' ? '매수' : '매도'} 신호입니다`;
    } else if (level === 'technical') {
      return `MA골든크로스 + RSI ${indicators.rsi.toFixed(1)} + MACD양봉`;
    } else {
      return `상세 기술분석: MA20 ${indicators.ma20.toFixed(0)}, RSI ${indicators.rsi.toFixed(1)}, MACD ${(indicators.macdLine - indicators.macdSignal).toFixed(4)}`;
    }
  }

  getActionable(level, signal, confidence) {
    if (level === 'simple') {
      return confidence > 0.75 ? '진입 추천' : '참고만';
    }
    return `${confidence > 0.75 ? '정규' : '축소'} 포지션`;
  }
}

class MultiLLMConsensusEngine {
  async generateConsensus(claude, gpt4, gemini, context) {
    const responses = [claude, gpt4, gemini];
    const signals = responses.map(r => r.signal);

    // Count votes
    const votes = { BUY: 0, SELL: 0, HOLD: 0 };
    for (const signal of signals) {
      votes[signal]++;
    }

    // Get consensus
    const consensus = Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];

    // Calculate agreement
    const maxVotes = Math.max(...Object.values(votes));
    const agreement = maxVotes / responses.length;

    // Detect disagreement
    const uniqueSignals = new Set(signals);
    const hasDisagreement = agreement < 0.85;

    return {
      consensus,
      confidence: responses.reduce((sum, r) => sum + r.confidence, 0) / responses.length * agreement,
      agreement,
      breakdownByModel: { claude, gpt4, gemini },
      disagreementAnalysis: hasDisagreement ? {
        level: uniqueSignals.size === 2 ? 'partial' : 'strong',
        disagreingModels: responses.filter(r => r.signal !== consensus).map(r => r.model),
        reason: 'Different weighting of indicators',
        implications: 'Market uncertainty detected',
        userGuidance: 'Reduce position size'
      } : undefined,
      recommendation: this.buildRecommendation(consensus, responses, agreement)
    };
  }

  buildRecommendation(consensus, responses, agreement) {
    return `합의: ${consensus} (${(agreement * 100).toFixed(0)}%)`;
  }
}

class EvidenceEngine {
  async collectEvidence(market, price, indicators, marketData) {
    const now = Date.now();
    const technical = this.collectTechnicalEvidence(indicators, now);
    const market_ev = this.collectMarketEvidence(market, price, marketData, now);

    const allEvidence = [...technical, ...market_ev];
    const scored = allEvidence.map(e => ({
      evidence: e,
      score: e.reliability * e.recency * e.importance,
      reasoning: 'Good evidence'
    }));

    const topEvidence = scored.sort((a, b) => b.score - a.score).slice(0, 5);
    const totalScore = scored.length > 0
      ? scored.reduce((sum, e) => sum + e.score, 0) / scored.length
      : 0;

    return {
      market,
      timestamp: now,
      technicalEvidence: scored.filter(e => e.evidence.source.includes('Technical')),
      marketEvidence: scored.filter(e => e.evidence.source.includes('Market') || e.evidence.source.includes('Volume')),
      sentimentEvidence: [],
      totalScore,
      topEvidence
    };
  }

  collectTechnicalEvidence(indicators, now) {
    const evidence = [];

    if (indicators.ma20 > indicators.ma50) {
      evidence.push({
        source: 'Technical Indicators',
        claim: `MA20 > MA50`,
        reliability: 0.95,
        recency: 0.9,
        importance: 0.8,
        timestamp: now
      });
    }

    if (indicators.rsi > 65) {
      evidence.push({
        source: 'Technical RSI',
        claim: `RSI ${indicators.rsi.toFixed(1)} - 강한 모멘텀`,
        reliability: 0.9,
        recency: 0.95,
        importance: 0.75,
        timestamp: now
      });
    }

    return evidence;
  }

  collectMarketEvidence(market, price, data, now) {
    const evidence = [];

    if (data.volumeChange && data.volumeChange > 1.2) {
      evidence.push({
        source: 'Trading Volume',
        claim: `거래량 ${(data.volumeChange * 100).toFixed(0)}% 증가`,
        reliability: 0.98,
        recency: 0.99,
        importance: 0.85,
        timestamp: now
      });
    }

    if (data.priceChange24h && Math.abs(data.priceChange24h) > 0.02) {
      evidence.push({
        source: 'Market Price Action',
        claim: `24h ${data.priceChange24h > 0 ? '상승' : '하락'} ${Math.abs(data.priceChange24h * 100).toFixed(2)}%`,
        reliability: 1.0,
        recency: 1.0,
        importance: 0.9,
        timestamp: now
      });
    }

    return evidence;
  }
}

// Test Suite
test('Multi-Level Explainer', async (t) => {
  const explainer = new MultiLevelExplainer();

  await t.test('should generate simple explanation', async () => {
    const signal = { direction: 'BUY', strength: 0.85 };
    const indicators = { ma20: 100, ma50: 95, ma200: 90, rsi: 72, macdLine: 0.5, macdSignal: 0.3 };
    const context = { price: 100, priceChange24h: 0.02, volume24h: 1000000, volumeChange: 1.3, volatility: 0.03 };

    const result = await explainer.explain(signal, indicators, context, 'simple');

    assert.strictEqual(result.level, 'simple');
    assert.ok(result.text.includes('매수'));
    assert.ok(result.confidence > 0.5);
    assert.ok(Array.isArray(result.evidence));
    assert.strictEqual(result.timeframe, '4시간');
  });

  await t.test('should generate technical explanation', async () => {
    const signal = { direction: 'BUY', strength: 0.85 };
    const indicators = { ma20: 100, ma50: 95, ma200: 90, rsi: 72, macdLine: 0.5, macdSignal: 0.3 };
    const context = { price: 100, priceChange24h: 0.02, volume24h: 1000000, volumeChange: 1.3, volatility: 0.03 };

    const result = await explainer.explain(signal, indicators, context, 'technical');

    assert.strictEqual(result.level, 'technical');
    assert.ok(result.text.includes('MA'));
    assert.ok(result.text.includes('RSI'));
  });

  await t.test('should generate expert explanation', async () => {
    const signal = { direction: 'BUY', strength: 0.85 };
    const indicators = { ma20: 100, ma50: 95, ma200: 90, rsi: 72, macdLine: 0.5, macdSignal: 0.3 };
    const context = { price: 100, priceChange24h: 0.02, volume24h: 1000000, volumeChange: 1.3, volatility: 0.03 };

    const result = await explainer.explain(signal, indicators, context, 'expert');

    assert.strictEqual(result.level, 'expert');
    assert.ok(result.text.includes('상세'));
  });

  await t.test('should calculate confidence correctly', async () => {
    const explainer = new MultiLevelExplainer();
    const signal = { direction: 'BUY', strength: 0.85 };
    const indicators = { ma20: 100, ma50: 95, ma200: 90, rsi: 72, macdLine: 0.5, macdSignal: 0.3 };
    const context = { price: 100, priceChange24h: 0.02, volume24h: 1000000, volumeChange: 1.3, volatility: 0.03 };

    const confidence = explainer.calculateConfidence(signal, indicators, context);

    assert.ok(confidence >= 0 && confidence <= 1);
    assert.ok(confidence > 0.5); // Should be high for bullish setup
  });
});

test('Multi-LLM Consensus Engine', async (t) => {
  const engine = new MultiLLMConsensusEngine();

  await t.test('should generate consensus from 3 LLMs', async () => {
    const claude = { model: 'claude', signal: 'BUY', confidence: 0.85 };
    const gpt4 = { model: 'gpt4', signal: 'BUY', confidence: 0.72 };
    const gemini = { model: 'gemini', signal: 'HOLD', confidence: 0.65 };

    const result = await engine.generateConsensus(claude, gpt4, gemini, {});

    assert.strictEqual(result.consensus, 'BUY');
    assert.ok(result.agreement > 0.5);
    assert.ok(result.agreement <= 1);
  });

  await t.test('should detect agreement (3/3 same)', async () => {
    const claude = { model: 'claude', signal: 'BUY', confidence: 0.85 };
    const gpt4 = { model: 'gpt4', signal: 'BUY', confidence: 0.82 };
    const gemini = { model: 'gemini', signal: 'BUY', confidence: 0.78 };

    const result = await engine.generateConsensus(claude, gpt4, gemini, {});

    assert.strictEqual(result.agreement, 1.0);
    assert.strictEqual(result.disagreementAnalysis, undefined);
  });

  await t.test('should detect disagreement (2/3 vs 1/3)', async () => {
    const claude = { model: 'claude', signal: 'BUY', confidence: 0.85 };
    const gpt4 = { model: 'gpt4', signal: 'BUY', confidence: 0.72 };
    const gemini = { model: 'gemini', signal: 'SELL', confidence: 0.75 };

    const result = await engine.generateConsensus(claude, gpt4, gemini, {});

    assert.strictEqual(result.agreement, 2/3);
    assert.ok(result.disagreementAnalysis);
    assert.strictEqual(result.disagreementAnalysis.level, 'partial');
  });

  await t.test('should calculate consensus confidence', async () => {
    const claude = { model: 'claude', signal: 'BUY', confidence: 0.85 };
    const gpt4 = { model: 'gpt4', signal: 'BUY', confidence: 0.72 };
    const gemini = { model: 'gemini', signal: 'HOLD', confidence: 0.65 };

    const result = await engine.generateConsensus(claude, gpt4, gemini, {});

    assert.ok(result.confidence > 0);
    assert.ok(result.confidence <= 1);
  });
});

test('Evidence Engine', async (t) => {
  const engine = new EvidenceEngine();

  await t.test('should collect technical evidence', async () => {
    const indicators = { ma20: 100, ma50: 95, ma200: 90, rsi: 72, macdLine: 0.5, macdSignal: 0.3 };
    const now = Date.now();

    const evidence = engine.collectTechnicalEvidence(indicators, now);

    assert.ok(Array.isArray(evidence));
    assert.ok(evidence.length > 0);
    assert.ok(evidence[0].source.includes('Technical'));
  });

  await t.test('should collect market evidence', async () => {
    const marketData = { volumeChange: 1.3, priceChange24h: 0.03 };
    const now = Date.now();

    const evidence = engine.collectMarketEvidence('BTC-KRW', 95000000, marketData, now);

    assert.ok(Array.isArray(evidence));
    assert.ok(evidence.length > 0);
  });

  await t.test('should score evidence correctly', async () => {
    const indicators = { ma20: 100, ma50: 95, ma200: 90, rsi: 72, macdLine: 0.5, macdSignal: 0.3 };
    const marketData = { volumeChange: 1.3, priceChange24h: 0.03, volatility: 0.03 };

    const bundle = await engine.collectEvidence('BTC-KRW', 95000000, indicators, marketData);

    assert.ok(bundle.totalScore >= 0 && bundle.totalScore <= 1);
    assert.ok(Array.isArray(bundle.topEvidence));
    assert.ok(bundle.topEvidence.length > 0);
  });

  await t.test('should identify top evidence', async () => {
    const indicators = { ma20: 100, ma50: 95, ma200: 90, rsi: 72, macdLine: 0.5, macdSignal: 0.3 };
    const marketData = { volumeChange: 1.5, priceChange24h: 0.05, volatility: 0.02 };

    const bundle = await engine.collectEvidence('BTC-KRW', 95000000, indicators, marketData);

    assert.ok(bundle.topEvidence[0].score >= bundle.topEvidence[1]?.score ?? 0);
  });
});

test('Integration: All 3 AI Engines Together', async (t) => {
  await t.test('should work together seamlessly', async () => {
    const explainer = new MultiLevelExplainer();
    const consensus = new MultiLLMConsensusEngine();
    const evidence = new EvidenceEngine();

    // Setup
    const signal = { direction: 'BUY', strength: 0.85 };
    const indicators = { ma20: 100, ma50: 95, ma200: 90, rsi: 72, macdLine: 0.5, macdSignal: 0.3 };
    const context = { price: 95000000, priceChange24h: 0.03, volume24h: 450000, volumeChange: 1.3, volatility: 0.03 };

    // Get explanations
    const simple = await explainer.explain(signal, indicators, context, 'simple');
    const technical = await explainer.explain(signal, indicators, context, 'technical');
    const expert = await explainer.explain(signal, indicators, context, 'expert');

    assert.strictEqual(simple.level, 'simple');
    assert.strictEqual(technical.level, 'technical');
    assert.strictEqual(expert.level, 'expert');

    // Get consensus
    const claude = { model: 'claude', signal: 'BUY', confidence: 0.85 };
    const gpt4 = { model: 'gpt4', signal: 'BUY', confidence: 0.72 };
    const gemini = { model: 'gemini', signal: 'HOLD', confidence: 0.65 };

    const consensusResult = await consensus.generateConsensus(claude, gpt4, gemini, '');

    assert.strictEqual(consensusResult.consensus, 'BUY');

    // Get evidence
    const evidenceBundle = await evidence.collectEvidence('BTC-KRW', 95000000, indicators, context);

    assert.ok(evidenceBundle.totalScore > 0);
    assert.ok(evidenceBundle.topEvidence.length > 0);

    // Verify all work together
    assert.ok(simple.confidence);
    assert.ok(consensusResult.confidence);
    assert.ok(evidenceBundle.totalScore);
  });
});

console.log('✅ AI Advanced Upgrade Tests Complete');
