# 연구 노트 2026-10-13: 알려진 전략 97가지 사전등록 일괄 검증 (authority_impact: none)

읽기 전용 오프라인 연구입니다. 주문, 설정, 위험 한도, 승격 결정에 영향이 없습니다.
재현: `node scripts/offline-strategy-catalog-screen.js` (작업지시 `WO-RESEARCH-20261013-STRATEGY-CATALOG`, 사전등록 커밋 `321605fba`).

## 방법 (결과를 보기 전에 커밋)
- 계열: SMA/EMA 교차, 이동평균 위 보유, 돈치안, 터틀, 장세 필터 돈치안, 볼린저 돌파·회귀, z-점수 회귀, RSI 회귀, Connors RSI2, RSI 모멘텀, MACD, 시계열 모멘텀, 변화율 임계, 변동성 압축, 상승추세 눌림목, 이중 추세, 시간대(60분봉), 주말·평일 보유, 시장 간 순환, 이중 모멘텀.
- 데이터: 60분봉 약 633일(두 고정 파일을 이어 붙임), 일봉 1824일. 5개 시장.
- **마지막 시험 구간은 따로 떼어 둠**: 60분봉 최근 120일, 일봉 최근 365일. 1차 선별에는 전혀 쓰지 않았습니다(일봉 돈치안 20만 앞선 확인에서 이 구간을 본 적이 있어 공개합니다).
- 1차 선별: 이전 노트와 같은 6구간 규칙.
- 최종 시험: 1차 통과한 것만, 거래당 평균 수익 > 0, 거래 30회 이상, 한쪽 검정 p < 0.05/97(시험 개수만큼 엄격하게 하는 Bonferroni 보정), 비용 2배에서도 평균 > 0.

## 결과: 97가지 중 1차 통과 9가지, 최종 통과 0가지
| 1차 통과 설정 (일봉) | 최종 시험 거래 수 | 거래당 평균 | 비용 2배 | p |
|---|---|---|---|---|
| 볼린저 돌파 20/2 | 32 | −1.58% | −1.77% | 0.91 |
| 볼린저 돌파 20/2.5 | 24 | −1.71% | −1.90% | 0.87 |
| 볼린저 회귀 20/2 | 34 | −4.76% | −4.95% | 0.99 |
| 볼린저 회귀 20/2.5 | 16 | −2.28% | −2.48% | 0.76 |
| z-점수 회귀 20/2 | 34 | −4.76% | −4.95% | 0.99 |
| z-점수 회귀 50/2 | 15 | −11.55% | −11.73% | 1.00 |
| RSI 회귀 14/30 | 16 | −9.79% | −9.97% | 1.00 |
| RSI 회귀 7/20 | 23 | −5.26% | −5.45% | 0.99 |
| 변동성 압축 | 23 | +0.99% | +0.79% | 0.27 |

60분봉에서는 1차 통과가 하나도 없었습니다.

## 읽는 법
- **1차에서 좋아 보인 9가지 중 8가지가 따로 떼어 둔 최근 구간에서 손해였습니다.** 과거에 맞춰진 결과(과적합)가 새 데이터에서 무너지는 전형적인 모습입니다.
- 유일하게 플러스였던 변동성 압축도 거래 23회, p=0.27로 우연과 구별되지 않고, Research 기준 50회에도 못 미칩니다.
- 학습 루프에 넣을 후보는 없습니다. 기준·한도는 바꾸지 않았습니다.

## 한계
- 종가만 있어서 고가·저가·거래량·호가를 쓰는 전략은 시험하지 못했습니다.
- 5개 시장, Upbit 원화 시장, 롱 온리, 종가 체결. 시장 간 순환은 시장별 시각이 몇 초 다른 것을 같은 봉으로 맞췄습니다.
- "전 세계 모든 전략"이 아니라 널리 알려진 계열 97가지입니다.

## 전체 출력
```
catalog: 97 configurations; holdout p-value bar 5.15e-4

60m: 15199 bars; discovery windows W1 2025-02-15..2025-05-06 DOWN; W2 2025-05-06..2025-07-26 UP; W3 2025-07-26..2025-10-15 UP; W4 2025-10-15..2026-01-04 DOWN; W5 2026-01-04..2026-03-25 DOWN; W6 2026-03-25..2026-06-14 DOWN; holdout 2026-06-14..2026-10-12

1d: 1824 bars; discovery windows W1 2023-10-06..2024-02-05 UP; W2 2024-02-06..2024-06-07 UP; W3 2024-06-08..2024-10-08 DOWN; W4 2024-10-09..2025-02-08 UP; W5 2025-02-09..2025-06-11 DOWN; W6 2025-06-12..2025-10-12 UP; holdout 2025-10-13..2026-10-12

configuration | +windows | UP mean | DOWN mean | discovery | holdout trades | holdout mean/trade | 2x mean/trade | p | holdout pass
60m SMA_CROSS 5/20 | 1/6 | +15.90% | -19.43% | fail
60m SMA_CROSS 10/50 | 2/6 | +21.98% | -17.07% | fail
60m SMA_CROSS 20/100 | 2/6 | +18.85% | -14.15% | fail
60m SMA_CROSS 50/200 | 2/6 | +14.58% | -12.33% | fail
60m EMA_CROSS 12/26 | 2/6 | +22.10% | -18.18% | fail
60m EMA_CROSS 20/50 | 2/6 | +20.36% | -14.73% | fail
60m EMA_CROSS 50/200 | 2/6 | +15.94% | -11.70% | fail
60m PRICE_ABOVE_SMA 50 | 1/6 | +11.71% | -24.74% | fail
60m PRICE_ABOVE_SMA 100 | 1/6 | +7.99% | -21.18% | fail
60m PRICE_ABOVE_SMA 200 | 2/6 | +10.75% | -20.64% | fail
60m DONCHIAN 20/10 | 2/6 | +9.91% | -13.28% | fail
60m DONCHIAN 50/25 | 2/6 | +19.72% | -9.64% | fail
60m DONCHIAN 100/50 | 2/6 | +18.24% | -9.69% | fail
60m TURTLE 55/20 | 2/6 | +17.83% | -9.68% | fail
60m REGIME_DONCHIAN 20/10 | 3/6 | +11.59% | -7.38% | fail
60m REGIME_DONCHIAN 50/25 | 2/6 | +19.68% | -8.48% | fail
60m REGIME_DONCHIAN 100/50 | 2/6 | +19.51% | -9.66% | fail
60m BOLLINGER_BREAKOUT 20/2 | 1/6 | +12.79% | -14.52% | fail
60m BOLLINGER_BREAKOUT 20/2.5 | 2/6 | +9.40% | -6.78% | fail
60m BOLLINGER_REVERSION 20/2 | 0/6 | -7.29% | -16.37% | fail
60m BOLLINGER_REVERSION 20/2.5 | 0/6 | -5.17% | -10.50% | fail
60m ZSCORE_REVERSION 20/2 | 0/6 | -7.29% | -16.37% | fail
60m ZSCORE_REVERSION 50/2 | 0/6 | -5.86% | -14.00% | fail
60m RSI_REVERSION 14/30 | 1/6 | -4.27% | -10.44% | fail
60m RSI_REVERSION 14/25 | 2/6 | -0.51% | -7.18% | fail
60m RSI_REVERSION 7/20 | 2/6 | -1.46% | -6.99% | fail
60m CONNORS_RSI2 trend200 | 1/6 | -0.53% | -4.60% | fail
60m RSI_MOMENTUM 14/60 | 1/6 | +11.94% | -16.20% | fail
60m RSI_MOMENTUM 14/70 | 3/6 | +6.99% | -5.48% | fail
60m MACD 12/26/9 | 1/6 | -1.05% | -24.69% | fail
60m MACD_ZERO 12/26 | 2/6 | +22.10% | -18.18% | fail
60m TSMOM 24 | 1/6 | -3.84% | -29.22% | fail
60m TSMOM 72 | 1/6 | +7.68% | -24.14% | fail
60m TSMOM 168 | 2/6 | +11.53% | -18.44% | fail
60m TSMOM 720 | 1/6 | +15.40% | -11.38% | fail
60m ROC_THRESHOLD 24/0.03 | 2/6 | +16.76% | -11.62% | fail
60m ROC_THRESHOLD 168/0.1 | 1/6 | +7.44% | -8.98% | fail
60m SQUEEZE 20/120/0.2 | 1/6 | +1.79% | -6.38% | fail
60m DIP_IN_UPTREND 200/5% | 3/6 | -1.61% | -3.64% | fail
60m DUAL_TREND 50>200 & tsmom | 2/6 | +13.04% | -13.79% | fail
60m HOUR_SESSION UTC0-8 | 0/6 | -7.16% | -29.89% | fail
60m HOUR_SESSION UTC8-16 | 0/6 | -11.91% | -19.76% | fail
60m HOUR_SESSION UTC16-24 | 0/6 | -5.25% | -17.13% | fail
60m WEEKEND_HOLD | 3/6 | +5.81% | -7.20% | fail
60m WEEKDAY_HOLD | 1/6 | +11.88% | -22.59% | fail
60m ROTATION_BEST lb24 | 1/6 | +15.95% | -41.18% | fail
60m ROTATION_BEST lb168 | 2/6 | +16.15% | -38.21% | fail
60m ROTATION_BEST lb720 | 2/6 | +27.59% | -34.66% | fail
60m DUAL_MOMENTUM lb168 | 2/6 | +24.60% | -21.15% | fail
60m DUAL_MOMENTUM lb720 | 2/6 | +26.04% | -18.63% | fail
1d SMA_CROSS 5/20 | 4/6 | +67.01% | -8.43% | fail
1d SMA_CROSS 10/50 | 5/6 | +68.28% | -6.47% | fail
1d SMA_CROSS 20/100 | 4/6 | +59.89% | -11.36% | fail
1d SMA_CROSS 50/200 | 4/6 | +53.27% | -20.96% | fail
1d EMA_CROSS 12/26 | 5/6 | +63.80% | -3.06% | fail
1d EMA_CROSS 20/50 | 4/6 | +67.88% | -12.68% | fail
1d EMA_CROSS 50/200 | 4/6 | +61.68% | -21.13% | fail
1d PRICE_ABOVE_SMA 50 | 5/6 | +72.22% | -8.45% | fail
1d PRICE_ABOVE_SMA 100 | 4/6 | +71.48% | -11.96% | fail
1d PRICE_ABOVE_SMA 200 | 4/6 | +69.66% | -24.92% | fail
1d DONCHIAN 20/10 | 4/6 | +67.34% | -3.71% | fail
1d DONCHIAN 50/25 | 4/6 | +59.72% | -8.08% | fail
1d DONCHIAN 100/50 | 4/6 | +45.00% | -4.98% | fail
1d TURTLE 55/20 | 4/6 | +57.15% | -4.15% | fail
1d REGIME_DONCHIAN 20/10 | 4/6 | +61.62% | -6.01% | fail
1d REGIME_DONCHIAN 50/25 | 4/6 | +56.50% | -6.13% | fail
1d REGIME_DONCHIAN 100/50 | 4/6 | +45.00% | -4.88% | fail
1d BOLLINGER_BREAKOUT 20/2 | 5/6 | +59.28% | +1.64% | PASS | 32 | -1.58% | -1.77% | 9.07e-1 | fail
1d BOLLINGER_BREAKOUT 20/2.5 | 5/6 | +52.13% | +1.33% | PASS | 24 | -1.71% | -1.90% | 8.67e-1 | fail
1d BOLLINGER_REVERSION 20/2 | 4/6 | +4.67% | +8.11% | PASS | 34 | -4.76% | -4.95% | 9.94e-1 | fail
1d BOLLINGER_REVERSION 20/2.5 | 4/6 | +0.67% | +12.60% | PASS | 16 | -2.28% | -2.48% | 7.59e-1 | fail
1d ZSCORE_REVERSION 20/2 | 4/6 | +4.67% | +8.11% | PASS | 34 | -4.76% | -4.95% | 9.94e-1 | fail
1d ZSCORE_REVERSION 50/2 | 4/6 | +3.22% | +1.05% | PASS | 15 | -11.55% | -11.73% | 1.00e+0 | fail
1d RSI_REVERSION 14/30 | 4/6 | +1.61% | +1.14% | PASS | 16 | -9.79% | -9.97% | 1.00e+0 | fail
1d RSI_REVERSION 14/25 | 2/6 | +0.00% | +2.09% | fail
1d RSI_REVERSION 7/20 | 5/6 | +3.83% | +9.33% | PASS | 23 | -5.26% | -5.45% | 9.90e-1 | fail
1d CONNORS_RSI2 trend200 | 4/6 | +8.12% | -3.00% | fail
1d RSI_MOMENTUM 14/60 | 5/6 | +61.37% | -2.96% | fail
1d RSI_MOMENTUM 14/70 | 4/6 | +48.89% | -3.34% | fail
1d MACD 12/26/9 | 4/6 | +63.61% | -13.31% | fail
1d MACD_ZERO 12/26 | 5/6 | +63.80% | -3.06% | fail
1d TSMOM 24 | 5/6 | +77.05% | -5.53% | fail
1d TSMOM 72 | 4/6 | +70.51% | -5.94% | fail
1d TSMOM 168 | 4/6 | +61.78% | -21.63% | fail
1d TSMOM 720 | 3/6 | +55.79% | -16.60% | fail
1d ROC_THRESHOLD 24/0.03 | 5/6 | +78.82% | -6.84% | fail
1d ROC_THRESHOLD 168/0.1 | 4/6 | +53.14% | -21.72% | fail
1d SQUEEZE 20/120/0.2 | 5/6 | +36.28% | +0.21% | PASS | 23 | +0.99% | +0.79% | 2.74e-1 | fail
1d DIP_IN_UPTREND 200/5% | 4/6 | +7.71% | -20.44% | fail
1d DUAL_TREND 50>200 & tsmom | 4/6 | +50.51% | -19.58% | fail
1d WEEKEND_HOLD | 4/6 | +8.36% | -3.02% | fail
1d WEEKDAY_HOLD | 4/6 | +54.97% | -19.81% | fail
1d ROTATION_BEST lb24 | 3/6 | +191.02% | -19.28% | fail
1d ROTATION_BEST lb168 | 4/6 | +171.79% | -18.15% | fail
1d ROTATION_BEST lb720 | 4/6 | +52.37% | -20.58% | fail
1d DUAL_MOMENTUM lb168 | 4/6 | +167.74% | -18.95% | fail
1d DUAL_MOMENTUM lb720 | 3/6 | +40.74% | -20.58% | fail

SUMMARY: 97 configurations, 9 passed discovery, 0 passed the holdout
```
