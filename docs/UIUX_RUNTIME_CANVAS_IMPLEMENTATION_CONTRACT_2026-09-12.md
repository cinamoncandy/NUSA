# NUSA Runtime Canvas — Implementation Contract

Status: implementation-ready specification; activation still follows Core/HOLD governance.

## Purpose

This document is the no-fantasy boundary for the next mobile visual. Every visible datum or motion must map to an existing canonical source or render unavailable.

## Canonical source mapping

| UI element | Canonical source | Missing behavior |
| --- | --- | --- |
| Market | `AiTradingJudgment.market` | `—` |
| Judgment action | `AiTradingJudgment.action` | `판단 없음` |
| Thesis | `AiTradingJudgment.thesis` | `검증된 통합 AI 판단이 없습니다.` |
| Market regime | `AiTradingJudgment.marketRegime` | `—` |
| Confidence | `AiTradingJudgment.confidence` | `—` |
| Uncertainty | `AiTradingJudgment.uncertainty` | `—` |
| Evidence | `AiTradingJudgment.evidence[]` | `검증된 근거 없음` |
| Counter evidence | `AiTradingJudgment.counterEvidence[]` | `반대 근거 없음` only when judgment itself is valid; otherwise unavailable |
| Evidence epistemic status | `AiTradingEvidenceItem.status` | never infer |
| Scenarios | `AiTradingJudgment.scenarios[]` | unavailable |
| Expected return | `AiTradingJudgment.expectedReturn` | `—` |
| Downside | `AiTradingJudgment.downside` | `—` |
| Risk budget | `AiTradingJudgment.riskBudget` | `—` |
| Horizon | `AiTradingJudgment.timeHorizonMs` | `—` |
| Invalidation | `AiTradingJudgment.invalidationCondition` | `—` |
| Judgment freshness | `generatedAt` + authoritative product freshness rule | UNKNOWN until freshness rule is wired |
| Calibration diagnostics | `AiReadOnlyProjection.calibration*` | unavailable |
| Critic severity | `AiReadOnlyProjection.criticSeverity` | unavailable |
| Disagreements | `AiReadOnlyProjection.disagreements[]` | unavailable |
| Scenario robustness | `AiReadOnlyProjection.scenarioRobustnessState` | unavailable |
| AI authority | canonical authority projection | always fail closed; no optimistic default |
| Public market state | existing public market state/feed freshness | LOADING/READY/STALE/ERROR only |
| PAPER state | canonical PAPER operations/runtime snapshot | preserve NOT_CONFIGURED/DEGRADED/etc. |
| Portfolio | canonical PAPER portfolio snapshot | `—/UNAVAILABLE` |
| REAL account | REAL_READ_ONLY snapshot | separate surface; never summed with PAPER |

## Action labels

Canonical presentation mapping already exists in `aiTradingJudgmentPresentation.ts`:

- LONG -> `LONG 관찰 판단`
- SHORT -> `SHORT 관찰 판단`
- EXIT -> `EXIT 관찰 판단`
- HOLD -> `HOLD 관찰 판단`
- ABSTAIN -> `판단 보류`

Every action surface also displays `AI 판단 · 실행 권한 없음`.

## Runtime Canvas topology

The 390px judgement canvas uses one continuous surface rather than a KPI card grid.

Order:

1. authority/truth rail;
2. judgment identity (`market`, action, regime, generated time/freshness if provable);
3. thesis;
4. confidence + uncertainty as a paired relationship;
5. evidence stream vs counter-evidence stream;
6. scenario distribution;
7. downside / risk budget / horizon;
8. invalidation condition;
9. trust diagnostics drawer;
10. safe navigation action.

`Expected return` and `downside` are estimates, not performance promises. Evidence status labels remain visible where material.

## Motion mapping

The component may use React Native core `Animated`; no additional animation dependency is required.

### Allowed transitions

`judgmentId` or `generatedAt` changed:
- 180–260ms cross-fade/translate of the judgment surface;
- no wording such as THINKING/RUNNING unless separately provided by runtime.

Evidence collection identity/content changed between authoritative snapshots:
- briefly emphasize only changed rows;
- no moving particles and no source-count animation beyond the actual count.

Action changed between authoritative judgments:
- text transition + subtle boundary emphasis;
- never infer why it changed unless a canonical history/delta source exists.

STALE/BLOCKED/ERROR:
- all ambient motion stops;
- affected node remains visually interrupted and textual state is explicit.

Reduced motion:
- instant state replacement; no translation/pulse.

### Forbidden

- fake sequential OBSERVE -> REASON -> VERIFY -> DECIDE progress;
- animated percentages not backed by values;
- perpetual glowing/orbiting objects;
- fake ingestion dots;
- fake source/agent activity;
- healthy motion under UNKNOWN.

## Dark Glass mapping to current RN stack

No BlurView dependency exists today. Therefore implementation uses:

- `background`: near-black/graphite opaque base;
- `glass.base`: semi-transparent dark surface plus hairline border;
- `glass.raised`: slightly higher-opacity surface plus stronger boundary;
- `glass.overlay`: modal/sheet surface only;
- no neon token;
- no glow shadow;
- low-saturation intelligence accent;
- semantic success/warning/danger remain dedicated.

This is intentionally reproducible in React Native 0.86 with current dependencies.

## 390px canonical layout

- horizontal padding: 20px;
- top authority rail: 32–40px;
- primary judgment canvas: full width;
- typography hierarchy, not card color, carries emphasis;
- evidence/counter streams stack on 360; may remain two compact columns only when each column stays readable on 390/430;
- bottom primary navigation remains 5 destinations;
- no decorative hero asset.

## First implementation acceptance

The first active implementation slice must prove:

1. no hard-coded market/judgment/demo value;
2. valid canonical judgment renders every supported field truthfully;
3. null/invalid judgment renders unavailable, not a synthetic HOLD;
4. confidence and uncertainty remain separate;
5. evidence epistemic statuses are not discarded;
6. action always shows no execution authority;
7. stale/error/unknown stop motion and remain text-visible;
8. 360/390/430 no clipping;
9. reduced-motion path exists;
10. screenshots are captured from the actual app and become the visual review artifact.

## Not yet permitted by this contract

- manual trading controls;
- LIVE controls;
- arbitrary agent progress visualization;
- invented What Changed history;
- portfolio-impact visualization without a canonical source;
- simulated backdrop blur not available in the RN stack.
