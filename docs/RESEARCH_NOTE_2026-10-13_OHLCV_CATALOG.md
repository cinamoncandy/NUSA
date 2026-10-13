# 연구 노트 2026-10-13: 시가·고가·저가·거래량(OHLCV) 전략 38가지 사전등록 검증 (authority_impact: none)

읽기 전용 오프라인 연구입니다. 재현: `node scripts/offline-ohlcv-catalog-screen.js` (작업지시 `WO-RESEARCH-20261013-OHLCV-CATALOG`, 사전등록 커밋 `e9ee51851`, 데이터는 그 뒤에 받음).

고정 입력: `docs/research-data/2026-10-13-upbit-60m-ohlcv.json` (sha256 `332f9e19175589b41de6b38be912cc0f6715e3bec68ed1f3322e5f7948bbae59`), `docs/research-data/2026-10-13-upbit-1d-ohlcv.json` (sha256 `223aae12171d658396a429ffd89e6325b36b39a0a63770128010100b636a0052`).

## 방법
- 계열 19개(ATR 돌파, 켈트너, 고가·저가 돈치안, 거래량 확인 돌파, OBV 추세, 스토캐스틱, 윌리엄스 %R, MFI 회귀, VWAP 회귀, 인사이드바, NR7, 거래량 동반 강한 마감, 투매 반등, ADX 추세, 슈퍼트렌드, 갭 상승 지속, 거래량 모멘텀) × 1시간봉·일봉 = 38가지.
- 최근 120일(1시간봉), 365일(일봉)은 최종 시험용으로 떼어 둠. 1차 선별은 6구간 규칙.
- 최종 합격선은 앞선 97가지까지 합친 누적 135개로 보정(p < 0.05/135).

## 결과: 38가지 중 1차 통과 1가지, 최종 통과 0가지
| 1차 통과 | 최종 시험 거래 수 | 거래당 평균 | 비용 2배 | p |
|---|---|---|---|---|
| 일봉 켈트너 돌파 20/2 | 16 | −2.67% | −2.87% | 0.91 |

1시간봉은 1차 통과가 없었습니다. 켈트너는 1차에서 6구간 모두 플러스였지만 떼어 둔 최근 1년에서 손해였습니다(과적합).

## 누적 결론 (오늘 시험한 135가지)
- 종가 전략 97가지와 OHLCV 전략 38가지, 어느 것도 떼어 둔 최근 데이터에서 통과하지 못했습니다.
- 학습 루프에 넣을 후보는 없습니다. 기준·한도는 바꾸지 않았습니다.

## 호가(오더북)
Upbit는 과거 호가를 주지 않아 과거 시험이 불가능합니다. 시험하려면 실시간 호가 수집부터 시작해야 하며(새 수집기와 저장, 소유자 결정 필요), 아직 수집하지 않았습니다.

## 한계
- 5개 시장, 롱 온리, 종가 체결, 시장 간 시각을 같은 봉으로 맞춤.
- 시험하지 않은 것: 호가, 체결 강도, 펀딩비·김치 프리미엄 같은 외부 데이터, 기계학습 모델.

## 전체 출력
```
OHLCV catalog: 38 configurations; cumulative K 135; holdout p-value bar 3.70e-4

60m: 15212 aligned bars 2025-01-16..2026-10-12; windows W1 2025-01-24..2025-04-18 DOWN; W2 2025-04-19..2025-07-12 UP; W3 2025-07-12..2025-10-04 UP; W4 2025-10-04..2025-12-28 DOWN; W5 2025-12-28..2026-03-22 DOWN; W6 2026-03-22..2026-06-14 DOWN; holdout 2026-06-14..2026-10-12

1d: 1824 aligned bars 2021-10-15..2026-10-12; windows W1 2022-05-08..2022-12-02 DOWN; W2 2022-12-03..2023-06-29 UP; W3 2023-06-30..2024-01-24 UP; W4 2024-01-25..2024-08-20 UP; W5 2024-08-21..2025-03-17 UP; W6 2025-03-18..2025-10-12 UP; holdout 2025-10-13..2026-10-12

configuration | +windows | UP mean | DOWN mean | discovery | holdout trades | mean/trade | 2x mean/trade | p | holdout
60m ATR_BREAKOUT k1 chandelier3 | 2/6 | +21.75% | -28.85% | fail
60m ATR_BREAKOUT k1.5 chandelier3 | 2/6 | +15.98% | -17.10% | fail
60m KELTNER_BREAKOUT 20/2 | 3/6 | +13.94% | -7.68% | fail
60m DONCHIAN_HL 20/10 | 2/6 | +14.72% | -17.17% | fail
60m DONCHIAN_HL 55/27 | 3/6 | +19.37% | -11.26% | fail
60m VOLUME_BREAKOUT 20 vol2x | 3/6 | +12.94% | -10.61% | fail
60m OBV_TREND 20 & sma50 | 1/6 | -1.72% | -29.23% | fail
60m STOCHASTIC 14 20/80 | 0/6 | -7.54% | -25.76% | fail
60m WILLIAMS_R 14 -90/-50 | 1/6 | -1.04% | -19.26% | fail
60m MFI_REVERSION 14 20/50 | 1/6 | -2.93% | -16.80% | fail
60m VWAP_REVERSION 24 -2% | 1/6 | +0.03% | -13.63% | fail
60m INSIDE_BAR_BREAKOUT 5bars | 0/6 | -13.54% | -17.78% | fail
60m NR7_BREAKOUT chandelier3 | 2/6 | +9.18% | -20.41% | fail
60m CLOSE_STRENGTH clv0.8 vol1.5x 3bars | 0/6 | -14.13% | -14.65% | fail
60m CAPITULATION_REVERSION vol3x 6bars | 3/6 | +4.01% | -11.30% | fail
60m ADX_TREND 14/25 | 3/6 | +12.28% | -12.83% | fail
60m SUPERTREND 10/3 | 3/6 | +23.11% | -16.11% | fail
60m GAP_UP_CONTINUATION 1% 3bars | 0/6 | +0.00% | +0.00% | fail
60m VOLUME_MOMENTUM 24 vol1.5x | 3/6 | +17.99% | -10.75% | fail
1d ATR_BREAKOUT k1 chandelier3 | 5/6 | +46.06% | -9.32% | fail
1d ATR_BREAKOUT k1.5 chandelier3 | 5/6 | +34.06% | -7.34% | fail
1d KELTNER_BREAKOUT 20/2 | 6/6 | +37.20% | +1.17% | PASS | 16 | -2.67% | -2.87% | 9.13e-1 | fail
1d DONCHIAN_HL 20/10 | 5/6 | +38.42% | -15.81% | fail
1d DONCHIAN_HL 55/27 | 5/6 | +31.95% | -7.92% | fail
1d VOLUME_BREAKOUT 20 vol2x | 5/6 | +38.56% | -15.42% | fail
1d OBV_TREND 20 & sma50 | 5/6 | +48.21% | -9.36% | fail
1d STOCHASTIC 14 20/80 | 4/6 | +7.87% | -12.78% | fail
1d WILLIAMS_R 14 -90/-50 | 3/6 | +5.51% | -35.11% | fail
1d MFI_REVERSION 14 20/50 | 4/6 | +2.04% | -24.97% | fail
1d VWAP_REVERSION 24 -2% | 4/6 | +8.36% | -45.93% | fail
1d INSIDE_BAR_BREAKOUT 5bars | 5/6 | +10.41% | -26.50% | fail
1d NR7_BREAKOUT chandelier3 | 5/6 | +42.94% | -12.00% | fail
1d CLOSE_STRENGTH clv0.8 vol1.5x 3bars | 5/6 | +7.23% | -5.07% | fail
1d CAPITULATION_REVERSION vol3x 6bars | 3/6 | +3.56% | -21.89% | fail
1d ADX_TREND 14/25 | 4/6 | +37.83% | -12.12% | fail
1d SUPERTREND 10/3 | 5/6 | +42.95% | -3.99% | fail
1d GAP_UP_CONTINUATION 1% 3bars | 0/6 | +0.00% | +0.00% | fail
1d VOLUME_MOMENTUM 24 vol1.5x | 5/6 | +46.78% | -4.59% | fail

SUMMARY: 38 configurations, 1 passed discovery, 0 passed the holdout
```
