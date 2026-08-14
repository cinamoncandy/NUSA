/**
 * Multi-LLM Consensus Engine
 *
 * Uses 3 LLMs (Claude, GPT-4, Gemini) to generate independent explanations,
 * then computes consensus and detects disagreements.
 *
 * Rationale:
 * - Claude: Logical depth and reasoning
 * - GPT-4: Practical, actionable insights
 * - Gemini: Risk-aware, conservative analysis
 */

export interface LLMResponse {
  model: 'claude' | 'gpt4' | 'gemini';
  signal: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;  // 0-1
  reasoning: string;
  riskWarnings: string[];
  targetPrice?: number;
  timeframe?: string;
}

export interface ConsensusResult {
  consensus: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  agreement: number;  // 0-1: how much LLMs agree
  breakdownByModel: Record<'claude' | 'gpt4' | 'gemini', LLMResponse>;
  disagreementAnalysis?: DisagreementAnalysis;
  recommendation: string;
}

export interface DisagreementAnalysis {
  level: 'agreement' | 'partial' | 'strong';
  disagreingModels: string[];
  reason: string;
  implications: string;
  userGuidance: string;
}

export class MultiLLMConsensusEngine {
  /**
   * Generate consensus from 3 independent LLM responses
   */
  async generateConsensus(
    claudeResponse: LLMResponse,
    gpt4Response: LLMResponse,
    geminiResponse: LLMResponse,
    evidenceContext: string
  ): Promise<ConsensusResult> {
    const responses = [claudeResponse, gpt4Response, geminiResponse];

    // Calculate consensus signal
    const signalVotes = this.countSignalVotes(responses);
    const consensus = this.getConsensusSignal(signalVotes);

    // Calculate agreement level
    const agreement = this.calculateAgreementLevel(responses);

    // Detect disagreements
    const hasDisagreement = agreement < 0.85;
    const disagreementAnalysis = hasDisagreement ?
      this.analyzeDisagreement(responses, evidenceContext) :
      undefined;

    // Build recommendation
    const recommendation = this.buildRecommendation(
      consensus,
      responses,
      agreement,
      disagreementAnalysis
    );

    return {
      consensus,
      confidence: this.calculateConfidence(responses),
      agreement,
      breakdownByModel: {
        claude: claudeResponse,
        gpt4: gpt4Response,
        gemini: geminiResponse
      },
      disagreementAnalysis,
      recommendation
    };
  }

  /**
   * Count signal votes from all LLMs
   */
  private countSignalVotes(responses: LLMResponse[]): Record<string, number> {
    const votes = { BUY: 0, SELL: 0, HOLD: 0 };

    for (const response of responses) {
      votes[response.signal]++;
    }

    return votes;
  }

  /**
   * Determine consensus signal by majority vote
   */
  private getConsensusSignal(votes: Record<string, number>): 'BUY' | 'SELL' | 'HOLD' {
    const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1]);
    return sorted[0][0] as 'BUY' | 'SELL' | 'HOLD';
  }

  /**
   * Calculate agreement level (0-1)
   * 1.0 = all LLMs agree
   * 0.33 = random votes
   * 0 = perfect disagreement
   */
  private calculateAgreementLevel(responses: LLMResponse[]): number {
    const votes = this.countSignalVotes(responses);
    const maxVotes = Math.max(...Object.values(votes));

    // 3/3 unanimous: 1.0
    // 2/3 majority: 0.67
    // 1/3 split: 0.33
    return maxVotes / responses.length;
  }

  /**
   * Calculate overall confidence as average of all LLM confidences
   */
  private calculateConfidence(responses: LLMResponse[]): number {
    const average = responses.reduce((sum, r) => sum + r.confidence, 0) / responses.length;

    // Penalize disagreement
    const agreement = this.calculateAgreementLevel(responses);
    return average * agreement;
  }

  /**
   * Analyze disagreement between LLMs
   */
  private analyzeDisagreement(
    responses: LLMResponse[],
    evidenceContext: string
  ): DisagreementAnalysis {
    const signals = responses.map(r => r.signal);
    const uniqueSignals = new Set(signals);

    if (uniqueSignals.size === 1) {
      return {
        level: 'agreement',
        disagreingModels: [],
        reason: 'All LLMs unanimously agree',
        implications: 'High confidence signal',
        userGuidance: 'Strong bias detected - proceed with standard position sizing'
      };
    }

    const disagreingModels = responses
      .filter(r => r.signal !== this.getMostCommonSignal(signals))
      .map(r => r.model);

    // Analyze why they disagree
    const riskWarnings = this.extractRiskWarnings(responses);
    const hasRiskDisagreement = riskWarnings.length > 0;

    return {
      level: uniqueSignals.size === 2 ? 'partial' : 'strong',
      disagreingModels,
      reason: hasRiskDisagreement
        ? 'Some LLMs see higher risk in this trade'
        : 'Different weighting of technical indicators',
      implications: this.interpretDisagreement(disagreingModels, responses),
      userGuidance: this.generateDisagreementGuidance(responses)
    };
  }

  /**
   * Extract risk warnings from all LLM responses
   */
  private extractRiskWarnings(responses: LLMResponse[]): string[] {
    const warnings = new Set<string>();

    for (const response of responses) {
      for (const warning of response.riskWarnings) {
        warnings.add(warning);
      }
    }

    return Array.from(warnings);
  }

  /**
   * Get most common signal among LLMs
   */
  private getMostCommonSignal(signals: string[]): string {
    const counts = { BUY: 0, SELL: 0, HOLD: 0 };
    for (const signal of signals) {
      counts[signal]++;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  /**
   * Interpret what the disagreement means
   */
  private interpretDisagreement(disagreingModels: string[], responses: LLMResponse[]): string {
    if (disagreingModels.includes('gemini')) {
      return 'Conservative model sees higher risk. Reduce position size.';
    }
    if (disagreingModels.includes('gpt4')) {
      return 'Practical model sees lower action value. Consider waiting.';
    }
    if (disagreingModels.includes('claude')) {
      return 'Analytical model finds weak logical foundation. Verify signal manually.';
    }
    return 'Mixed signals detected. Exercise caution.';
  }

  /**
   * Generate user guidance based on disagreement
   */
  private generateDisagreementGuidance(responses: LLMResponse[]): string {
    const buyCount = responses.filter(r => r.signal === 'BUY').length;
    const sellCount = responses.filter(r => r.signal === 'SELL').length;
    const holdCount = responses.filter(r => r.signal === 'HOLD').length;

    if (buyCount === 3) {
      return '3/3 LLM 매수 합의. 정규 포지션 크기 추천.';
    }
    if (buyCount === 2 && sellCount === 1) {
      return '2/3 LLM 매수, 1/3 매도. 축소된 포지션 추천 (50%).';
    }
    if (buyCount === 1 && sellCount === 2) {
      return '1/3 LLM 매수, 2/3 매도. 매우 작은 포지션 또는 대기 추천.';
    }
    if (sellCount === 3) {
      return '3/3 LLM 매도 합의. 강한 약세 신호.';
    }
    return '불확실한 신호. 대기하거나 매우 작은 포지션만 진입.';
  }

  /**
   * Build human-readable recommendation
   */
  private buildRecommendation(
    consensus: string,
    responses: LLMResponse[],
    agreement: number,
    disagreement?: DisagreementAnalysis
  ): string {
    const agreementPercent = (agreement * 100).toFixed(0);

    let recommendation = `
📊 LLM 앙상블 결론

합의 신호: ${consensus}
LLM 합의도: ${agreementPercent}%

분석:`;

    for (const response of responses) {
      const icon = response.signal === 'BUY' ? '📈' : response.signal === 'SELL' ? '📉' : '➡️';
      recommendation += `
  ${icon} ${response.model.toUpperCase()}: ${response.signal} (신뢰도 ${(response.confidence * 100).toFixed(0)}%)
     → ${response.reasoning}`;
    }

    if (disagreement && disagreement.level !== 'agreement') {
      recommendation += `

⚠️ 불일치 분석:
  • 수준: ${disagreement.level === 'partial' ? '부분 불일치' : '강한 불일치'}
  • 의견이 다른 모델: ${disagreement.disagreingModels.join(', ')}
  • 이유: ${disagreement.reason}
  • 영향: ${disagreement.implications}
  • 권장: ${disagreement.userGuidance}`;
    }

    return recommendation;
  }
}

/**
 * Example LLM Response for testing
 */
export function createExampleResponses(): { claude: LLMResponse; gpt4: LLMResponse; gemini: LLMResponse } {
  return {
    claude: {
      model: 'claude',
      signal: 'BUY',
      confidence: 0.85,
      reasoning: '4시간 차트에서 MA20/MA50 골든크로스 + MACD 양봉. 논리적으로 강한 매수 신호.',
      riskWarnings: ['RSI 72 - 과매수 경고'],
      targetPrice: 97_000_000,
      timeframe: '4시간~1일'
    },
    gpt4: {
      model: 'gpt4',
      signal: 'BUY',
      confidence: 0.72,
      reasoning: '실용적으로 보면 매수 가능. 거래량 증가 + 가격 상승. 하지만 기술적 한계 주의.',
      riskWarnings: ['변동성 높음', '익절매 타이밍 중요'],
      targetPrice: 96_500_000,
      timeframe: '1일~3일'
    },
    gemini: {
      model: 'gemini',
      signal: 'HOLD',
      confidence: 0.65,
      reasoning: '보수적으로 분석하면 아직 기다려야 함. 과매수 경고가 크다.',
      riskWarnings: ['RSI 71 - 과매수', '급락 위험 30%'],
      targetPrice: undefined,
      timeframe: undefined
    }
  };
}
