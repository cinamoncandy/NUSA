/**
 * Real-Time Evidence Engine
 *
 * Collects and scores evidence from multiple sources to back up AI explanations.
 * Evidence is continuously updated and scored for reliability, recency, and importance.
 */

export interface Evidence {
  source: string;          // 증거 출처
  claim: string;           // 주장
  reliability: number;     // 0-1: 얼마나 신뢰할 수 있는가
  recency: number;         // 0-1: 얼마나 최신인가 (0=1h이상, 1=1초이내)
  importance: number;      // 0-1: 결정에 얼마나 중요한가
  timestamp: number;       // 증거 수집 시간
  value?: number;          // 수치 증거 (가격, RSI 등)
}

export interface EvidenceScore {
  evidence: Evidence;
  score: number;           // reliability × recency × importance
  reasoning: string;
}

export interface EvidenceBundle {
  market: string;
  timestamp: number;
  technicalEvidence: EvidenceScore[];
  marketEvidence: EvidenceScore[];
  sentimentEvidence: EvidenceScore[];
  totalScore: number;      // 평균 증거 점수
  topEvidence: EvidenceScore[];
}

export class EvidenceEngine {
  private evidenceCache: Map<string, Evidence[]> = new Map();
  private subscriptions: Map<string, (bundle: EvidenceBundle) => void> = new Map();

  /**
   * Collect all available evidence for a signal
   */
  async collectEvidence(
    market: string,
    price: number,
    indicators: any,
    marketData: any
  ): Promise<EvidenceBundle> {
    const now = Date.now();

    // Collect from different sources
    const technical = this.collectTechnicalEvidence(indicators, now);
    const market_ev = this.collectMarketEvidence(market, price, marketData, now);
    const sentiment = this.collectSentimentEvidence(market, now);

    // Score evidence
    const technicalScored = this.scoreEvidence(technical);
    const marketScored = this.scoreEvidence(market_ev);
    const sentimentScored = this.scoreEvidence(sentiment);

    const allEvidence = [...technicalScored, ...marketScored, ...sentimentScored];
    const topEvidence = allEvidence.sort((a, b) => b.score - a.score).slice(0, 5);
    const totalScore = allEvidence.length > 0
      ? allEvidence.reduce((sum, e) => sum + e.score, 0) / allEvidence.length
      : 0;

    return {
      market,
      timestamp: now,
      technicalEvidence: technicalScored,
      marketEvidence: marketScored,
      sentimentEvidence: sentimentScored,
      totalScore,
      topEvidence
    };
  }

  /**
   * Collect technical indicator evidence
   */
  private collectTechnicalEvidence(indicators: any, now: number): Evidence[] {
    const evidence: Evidence[] = [];

    // MA crossovers
    if (indicators.ma20 > indicators.ma50) {
      evidence.push({
        source: 'Technical Indicators',
        claim: `MA20 (${indicators.ma20.toFixed(0)}) > MA50 (${indicators.ma50.toFixed(0)})`,
        reliability: 0.95,
        recency: 0.9,
        importance: 0.8,
        timestamp: now,
        value: indicators.ma20
      });
    }

    if (indicators.ma50 > indicators.ma200) {
      evidence.push({
        source: 'Technical Indicators',
        claim: `MA50 (${indicators.ma50.toFixed(0)}) > MA200 (${indicators.ma200.toFixed(0)}) - 중기 강세`,
        reliability: 0.95,
        recency: 0.85,
        importance: 0.7,
        timestamp: now,
        value: indicators.ma50
      });
    }

    // RSI
    if (indicators.rsi > 65) {
      evidence.push({
        source: 'RSI Momentum',
        claim: `RSI ${indicators.rsi.toFixed(1)} - 강한 모멘텀`,
        reliability: 0.9,
        recency: 0.95,
        importance: 0.75,
        timestamp: now,
        value: indicators.rsi
      });
    }

    if (indicators.rsi > 70) {
      evidence.push({
        source: 'RSI Extreme',
        claim: `RSI ${indicators.rsi.toFixed(1)} - 과매수 경고`,
        reliability: 0.85,
        recency: 0.95,
        importance: 0.9,
        timestamp: now,
        value: indicators.rsi
      });
    }

    // MACD
    if (indicators.macdLine > indicators.macdSignal) {
      evidence.push({
        source: 'MACD Histogram',
        claim: `MACD 양봉 (Line: ${indicators.macdLine.toFixed(4)}, Signal: ${indicators.macdSignal.toFixed(4)})`,
        reliability: 0.85,
        recency: 0.9,
        importance: 0.65,
        timestamp: now,
        value: indicators.macdLine - indicators.macdSignal
      });
    }

    // Bollinger Bands
    if (indicators.price > indicators.bollingerUpper * 0.95) {
      evidence.push({
        source: 'Bollinger Bands',
        claim: `가격이 상단 밴드 근처 (${indicators.price.toFixed(0)} vs ${indicators.bollingerUpper.toFixed(0)})`,
        reliability: 0.8,
        recency: 0.95,
        importance: 0.6,
        timestamp: now,
        value: indicators.price
      });
    }

    return evidence;
  }

  /**
   * Collect market data evidence
   */
  private collectMarketEvidence(market: string, price: number, data: any, now: number): Evidence[] {
    const evidence: Evidence[] = [];

    // Volume analysis
    if (data.volumeChange && data.volumeChange > 1.2) {
      evidence.push({
        source: 'Trading Volume',
        claim: `거래량 ${(data.volumeChange * 100).toFixed(0)}% 증가 - 참여도 높음`,
        reliability: 0.98,
        recency: 0.99,
        importance: 0.85,
        timestamp: now,
        value: data.volumeChange
      });
    }

    // Price movement
    if (data.priceChange24h && Math.abs(data.priceChange24h) > 0.02) {
      const direction = data.priceChange24h > 0 ? '상승' : '하락';
      evidence.push({
        source: 'Price Action',
        claim: `24시간 ${direction} ${Math.abs(data.priceChange24h * 100).toFixed(2)}%`,
        reliability: 1.0,
        recency: 1.0,
        importance: 0.9,
        timestamp: now,
        value: data.priceChange24h
      });
    }

    // Volatility
    if (data.volatility) {
      const volatilityLevel = data.volatility > 0.05 ? '높음' : data.volatility > 0.02 ? '중간' : '낮음';
      evidence.push({
        source: 'Volatility Measure',
        claim: `변동성 ${volatilityLevel} (${(data.volatility * 100).toFixed(2)}%)`,
        reliability: 0.9,
        recency: 0.95,
        importance: 0.7,
        timestamp: now,
        value: data.volatility
      });
    }

    return evidence;
  }

  /**
   * Collect sentiment evidence
   */
  private collectSentimentEvidence(market: string, now: number): Evidence[] {
    const evidence: Evidence[] = [];

    // Fear & Greed Index (hardcoded for demo, would be real API in production)
    const fearGreedIndex = Math.random() * 100;
    if (fearGreedIndex > 60) {
      evidence.push({
        source: 'Sentiment (Fear & Greed)',
        claim: `공포/탐욕 지수 ${fearGreedIndex.toFixed(0)} - 탐욕 우세`,
        reliability: 0.7,
        recency: 0.6,  // Daily update
        importance: 0.5,
        timestamp: now,
        value: fearGreedIndex
      });
    }

    return evidence;
  }

  /**
   * Score evidence based on reliability, recency, and importance
   */
  private scoreEvidence(evidence: Evidence[]): EvidenceScore[] {
    return evidence.map(e => ({
      evidence: e,
      score: e.reliability * e.recency * e.importance,
      reasoning: `신뢰도 ${(e.reliability * 100).toFixed(0)}% × 최신도 ${(e.recency * 100).toFixed(0)}% × 중요도 ${(e.importance * 100).toFixed(0)}%`
    }));
  }

  /**
   * Subscribe to evidence updates for a market
   */
  subscribe(market: string, callback: (bundle: EvidenceBundle) => void): () => void {
    const callbackId = `${market}_${Math.random()}`;
    this.subscriptions.set(callbackId, callback);

    // Return unsubscribe function
    return () => this.subscriptions.delete(callbackId);
  }

  /**
   * Notify all subscribers with updated evidence
   */
  private notifySubscribers(market: string, bundle: EvidenceBundle): void {
    for (const [key, callback] of this.subscriptions) {
      if (key.startsWith(market)) {
        callback(bundle);
      }
    }
  }

  /**
   * Format evidence for display
   */
  formatEvidenceForDisplay(bundle: EvidenceBundle): string {
    let output = `📊 증거 분석 (${new Date(bundle.timestamp).toLocaleTimeString('ko-KR')})\n\n`;

    output += `전체 증거 점수: ${(bundle.totalScore * 100).toFixed(0)}/100\n\n`;

    output += '🥇 상위 증거:\n';
    for (const scored of bundle.topEvidence.slice(0, 3)) {
      output += `  • ${scored.evidence.source}: ${scored.evidence.claim}\n`;
      output += `    → 점수: ${(scored.score * 100).toFixed(0)}/100 (${scored.reasoning})\n`;
    }

    output += '\n📈 기술적 증거:\n';
    for (const scored of bundle.technicalEvidence.slice(0, 3)) {
      output += `  • ${scored.evidence.claim} [${(scored.score * 100).toFixed(0)}/100]\n`;
    }

    output += '\n💹 시장 증거:\n';
    for (const scored of bundle.marketEvidence.slice(0, 3)) {
      output += `  • ${scored.evidence.claim} [${(scored.score * 100).toFixed(0)}/100]\n`;
    }

    if (bundle.sentimentEvidence.length > 0) {
      output += '\n😊 감정 지수:\n';
      for (const scored of bundle.sentimentEvidence) {
        output += `  • ${scored.evidence.claim} [${(scored.score * 100).toFixed(0)}/100]\n`;
      }
    }

    return output;
  }
}
