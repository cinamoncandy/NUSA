/**
 * Multi-level AI Explanations: Simple → Technical → Expert
 *
 * Adapts explanation complexity based on user expertise level.
 * All levels backed by real-time evidence and confidence scores.
 */

export type ExplanationLevel = 'simple' | 'technical' | 'expert';

export interface Signal {
  market: string;
  direction: 'BUY' | 'SELL';
  strength: number;  // 0-1
  timestamp: number;
}

export interface TechnicalIndicators {
  ma20: number;
  ma50: number;
  ma200: number;
  rsi: number;
  macdLine: number;
  macdSignal: number;
  bollingerUpper: number;
  bollingerMiddle: number;
  bollingerLower: number;
}

export interface MarketContext {
  price: number;
  priceChange24h: number;
  volume24h: number;
  volumeChange: number;
  volatility: number;
}

export interface ExplanationResult {
  level: ExplanationLevel;
  text: string;
  confidence: number;  // 0-1
  evidence: string[];
  caveats: string[];
  timeframe: string;
  actionable: string;  // "뭘 해야 하는가"
}

export class MultiLevelExplainer {
  /**
   * Generate multi-level explanation for trading signal
   */
  async explain(
    signal: Signal,
    indicators: TechnicalIndicators,
    context: MarketContext,
    level: ExplanationLevel = 'technical'
  ): Promise<ExplanationResult> {
    const confidence = this.calculateConfidence(signal, indicators, context);
    const evidence = this.gatherEvidence(signal, indicators, context);
    const caveats = this.identifyCaveats(indicators, context);

    let text: string;
    let actionable: string;

    if (level === 'simple') {
      text = this.explainSimple(signal, indicators, context, evidence);
      actionable = this.actionableSimple(signal, confidence);
    } else if (level === 'technical') {
      text = this.explainTechnical(signal, indicators, context, evidence);
      actionable = this.actionableTechnical(signal, confidence, caveats);
    } else {
      text = this.explainExpert(signal, indicators, context, evidence);
      actionable = this.actionableExpert(signal, confidence, indicators);
    }

    return {
      level,
      text,
      confidence,
      evidence,
      caveats,
      timeframe: this.determineTimeframe(indicators),
      actionable
    };
  }

  /**
   * Simple explanation: Beginner-friendly
   */
  private explainSimple(
    signal: Signal,
    indicators: TechnicalIndicators,
    context: MarketContext,
    evidence: string[]
  ): string {
    const direction = signal.direction === 'BUY' ? '올라갈' : '내려갈';
    const strength = signal.strength > 0.75 ? '강한' : signal.strength > 0.5 ? '중간' : '약한';

    return `
📊 ${signal.market}: ${strength} ${direction === '올라갈' ? '매수' : '매도'} 신호

${direction} 것으로 예상됩니다.

근거:
${evidence.map(e => `• ${e}`).join('\n')}

신뢰도: ${(signal.strength * 100).toFixed(0)}%
    `.trim();
  }

  /**
   * Technical explanation: Intermediate traders
   */
  private explainTechnical(
    signal: Signal,
    indicators: TechnicalIndicators,
    context: MarketContext,
    evidence: string[]
  ): string {
    const isAboveMAs = indicators.ma20 > indicators.ma50 && indicators.ma50 > indicators.ma200;
    const maStatus = isAboveMAs ? '골든크로스 (강세)' : '데드크로스 (약세)';

    const rsiStatus =
      indicators.rsi > 70 ? '과매수' :
      indicators.rsi < 30 ? '과매도' :
      '중립';

    const volumeStatus = context.volumeChange > 1.2 ? '증가' : '정상';

    return `
📈 ${signal.market}: 기술적 분석

시그널: ${signal.direction === 'BUY' ? '매수' : '매도'} (강도: ${(signal.strength * 100).toFixed(0)}%)

기술 지표:
• 이동평균: ${macdStatus}
  - MA20: ${indicators.ma20.toFixed(0)}
  - MA50: ${indicators.ma50.toFixed(0)}
  - MA200: ${indicators.ma200.toFixed(0)}

• RSI: ${indicators.rsi.toFixed(1)} (${rsiStatus}) ${indicators.rsi > 70 ? '⚠️' : indicators.rsi < 30 ? '⚠️' : '✓'}
• MACD: ${(indicators.macdLine - indicators.macdSignal).toFixed(3)} (${indicators.macdLine > indicators.macdSignal ? '양봉' : '음봉'})

거래량:
• 24h: ${(context.volume24h / 1_000_000).toFixed(1)}M
• 변화: ${(context.volumeChange * 100).toFixed(1)}% ${volumeStatus}

근거:
${evidence.map(e => `• ${e}`).join('\n')}

시간대: 4시간~일간 추세
    `.trim();
  }

  /**
   * Expert explanation: Professional traders
   */
  private explainExpert(
    signal: Signal,
    indicators: TechnicalIndicators,
    context: MarketContext,
    evidence: string[]
  ): string {
    const bbWidth = indicators.bollingerUpper - indicators.bollingerLower;
    const bbPercent = (context.price - indicators.bollingerLower) / bbWidth;

    return `
🎓 ${signal.market}: 전문가 기술 분석

거래 신호:
Direction: ${signal.direction}
Strength: ${(signal.strength * 100).toFixed(1)}%
Confidence: ${(this.calculateConfidence(signal, indicators, context) * 100).toFixed(1)}%

이동평균 분석:
• Short (MA20): ${indicators.ma20.toFixed(2)}
• Medium (MA50): ${indicators.ma50.toFixed(2)}
• Long (MA200): ${indicators.ma200.toFixed(2)}
• 순서: ${this.getMAsOrder(indicators)}

모멘텀 지표:
• RSI(14): ${indicators.rsi.toFixed(2)}
  - 극값 분석: ${indicators.rsi > 70 ? '과매수 권역' : indicators.rsi < 30 ? '과매도 권역' : '중립'}
• MACD:
  - Line: ${indicators.macdLine.toFixed(5)}
  - Signal: ${indicators.macdSignal.toFixed(5)}
  - Histogram: ${(indicators.macdLine - indicators.macdSignal).toFixed(5)}

볼린저 밴드:
• Upper: ${indicators.bollingerUpper.toFixed(2)}
• Middle: ${indicators.bollingerMiddle.toFixed(2)}
• Lower: ${indicators.bollingerLower.toFixed(2)}
• %B: ${(bbPercent * 100).toFixed(1)}% (${this.interpretBBPercent(bbPercent)})

시장 구조:
• Price: ${context.price.toFixed(2)}
• Change (24h): ${(context.priceChange24h * 100).toFixed(2)}%
• Volume (24h): ${(context.volume24h / 1_000_000).toFixed(2)}M
• Volume Δ: ${(context.volumeChange * 100).toFixed(1)}%
• Volatility: ${(context.volatility * 100).toFixed(2)}%

거래 근거:
${evidence.map((e, i) => `${i + 1}. ${e}`).join('\n')}

위험 고려사항:
${this.identifyCaveats(indicators, context).map(c => `• ${c}`).join('\n')}

권장:
${this.actionableExpert(signal, this.calculateConfidence(signal, indicators, context), indicators)}
    `.trim();
  }

  /**
   * Calculate overall confidence score
   */
  private calculateConfidence(
    signal: Signal,
    indicators: TechnicalIndicators,
    context: MarketContext
  ): number {
    let score = 0;
    let count = 0;

    // MA alignment
    if (indicators.ma20 > indicators.ma50 && indicators.ma50 > indicators.ma200) {
      score += 0.2;
      count++;
    }

    // RSI in extremes
    if (indicators.rsi > 70 || indicators.rsi < 30) {
      score += 0.2;
      count++;
    }

    // MACD alignment
    if ((indicators.macdLine > indicators.macdSignal && signal.direction === 'BUY') ||
        (indicators.macdLine < indicators.macdSignal && signal.direction === 'SELL')) {
      score += 0.2;
      count++;
    }

    // Volume increase
    if (context.volumeChange > 1.1) {
      score += 0.2;
      count++;
    }

    // Signal strength
    score += signal.strength * 0.2;
    count++;

    return count > 0 ? score / count : 0.5;
  }

  /**
   * Gather evidence for explanation
   */
  private gatherEvidence(
    signal: Signal,
    indicators: TechnicalIndicators,
    context: MarketContext
  ): string[] {
    const evidence: string[] = [];

    // MA evidence
    if (indicators.ma20 > indicators.ma50 && signal.direction === 'BUY') {
      evidence.push('MA20이 MA50 위에 있음 (단기 강세)');
    }
    if (indicators.ma50 > indicators.ma200) {
      evidence.push('MA50이 MA200 위에 있음 (중기 강세)');
    }

    // RSI evidence
    if (indicators.rsi > 65 && signal.direction === 'BUY') {
      evidence.push(`RSI ${indicators.rsi.toFixed(1)} (강한 모멘텀)`);
    }
    if (indicators.rsi > 70) {
      evidence.push('RSI 과매수 경고');
    }

    // MACD evidence
    if (indicators.macdLine > indicators.macdSignal && signal.direction === 'BUY') {
      evidence.push('MACD 양봉 (상승 모멘텀)');
    }

    // Volume evidence
    if (context.volumeChange > 1.2) {
      evidence.push(`거래량 ${(context.volumeChange * 100).toFixed(0)}% 증가 (참여도 높음)`);
    }

    return evidence.length > 0 ? evidence : ['신호 강도: ' + (signal.strength * 100).toFixed(0) + '%'];
  }

  /**
   * Identify trading caveats
   */
  private identifyCaveats(
    indicators: TechnicalIndicators,
    context: MarketContext
  ): string[] {
    const caveats: string[] = [];

    if (indicators.rsi > 70) {
      caveats.push('과매수 상태 - 수익실현 가능성');
    }
    if (indicators.rsi < 30) {
      caveats.push('과매도 상태 - 반등 가능성');
    }
    if (context.volatility > 0.05) {
      caveats.push('변동성 높음 - 리스크 증가');
    }
    if (context.volumeChange < 0.8) {
      caveats.push('거래량 부족 - 신호 약함');
    }

    return caveats.length > 0 ? caveats : ['특이 주의사항 없음'];
  }

  /**
   * Determine relevant timeframe
   */
  private determineTimeframe(indicators: TechnicalIndicators): string {
    const isShort = Math.abs(indicators.ma20 - indicators.ma50) < Math.abs(indicators.ma50 - indicators.ma200);
    return isShort ? '1시간~4시간' : '4시간~일간';
  }

  /**
   * Simple actionable recommendation
   */
  private actionableSimple(signal: Signal, confidence: number): string {
    if (confidence > 0.75) {
      return signal.direction === 'BUY' ? '진입 추천' : '청산 추천';
    } else if (confidence > 0.5) {
      return '참고만 하세요';
    } else {
      return '불확실한 신호';
    }
  }

  /**
   * Technical actionable recommendation
   */
  private actionableTechnical(signal: Signal, confidence: number, caveats: string[]): string {
    let recommendation = signal.direction === 'BUY' ? '매수' : '매도';

    if (caveats.some(c => c.includes('과매수'))) {
      return `${recommendation} - 단, 수익실현 구간 주의`;
    }
    if (caveats.some(c => c.includes('변동성'))) {
      return `${recommendation} - 포지션 크기 축소 권장`;
    }

    return recommendation;
  }

  /**
   * Expert actionable recommendation
   */
  private actionableExpert(signal: Signal, confidence: number, indicators: TechnicalIndicators): string {
    const size = confidence > 0.75 ? '정규' : confidence > 0.5 ? '축소' : '아주 작게';
    const entry = signal.direction === 'BUY' ?
      `현가 또는 MA20 (${indicators.ma20.toFixed(2)})` :
      `현가 또는 MA20 (${indicators.ma20.toFixed(2)})`;

    return `
포지션 크기: ${size}
진입점: ${entry}
손절매: ${signal.direction === 'BUY' ? 'MA200 아래' : 'MA200 위'}
익절매: 다음 저항선 또는 MA50`;
  }

  private getMAsOrder(indicators: TechnicalIndicators): string {
    if (indicators.ma20 > indicators.ma50 && indicators.ma50 > indicators.ma200) {
      return 'MA20 > MA50 > MA200 (강세)';
    }
    if (indicators.ma20 < indicators.ma50 && indicators.ma50 < indicators.ma200) {
      return 'MA20 < MA50 < MA200 (약세)';
    }
    return '혼재 (중립)';
  }

  private interpretBBPercent(percent: number): string {
    if (percent > 0.8) return '상단 근처';
    if (percent < 0.2) return '하단 근처';
    return '중간';
  }
}
