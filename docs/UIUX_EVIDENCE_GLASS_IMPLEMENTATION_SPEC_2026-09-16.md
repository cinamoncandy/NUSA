# NUSA Evidence Glass — implementation-ready UI specification

Date: 2026-09-16
Canonical product-contract owner: #1850
Governance dependency: #1889 Core disposition
Release dependency: #1803 global Release freeze

This specification is intentionally implementation-ready. It does not authorize implementation, Ready state, merge, or Release while the independent governance gates remain closed.

## 1. Product grammar

NUSA is a judgment-supervision product, not a brokerage dashboard.

The visual hierarchy is:

1. operational truth
2. current judgment identity and freshness
3. thesis
4. confidence and uncertainty as separate facts
5. evidence and counter-evidence
6. scenarios
7. downside / risk budget / horizon
8. invalidation condition
9. provenance / diagnostics
10. market and PAPER capital context

Capital, PnL, candles, and portfolio allocation never outrank current judgment truth on Home or Judgment.

## 2. Visible information architecture after #1889 APPROVE

Visible order:

`NUSA / 판단 / 시장 / PAPER / 자산`

Internal route IDs stay stable during migration:

- `Home` -> `NUSA`
- `AiSignal` -> `판단`
- `Markets` -> `시장`
- `Paper` -> `PAPER`
- `Portfolio` -> `자산`

Settings remains utility navigation, not a sixth product tab.

## 3. Implementation constraint

Use the current React Native stack only. No BlurView dependency is required.

Build from existing primitives where possible:

- `AuthorityRail`
- `ScreenLead`
- `MetricStrip`
- `IntelligenceSection`
- `FactRow`
- `StateNotice`

Current `ThemeProvider` / `designSystem` remains the token source. Existing neon tokens are legacy-compatible tokens, not permission to introduce neon visual treatment. Evidence Glass does not add decorative glow, cyberpunk effects, scan lines, particles, orbit animation, an AI sphere, decorative globe, or fake background blur.

Minimum interactive target stays 48 px.

## 4. Evidence Glass visual system

### 4.1 Surface hierarchy

Use four physical layers only:

- canvas: `theme.colors.background`
- evidence surface: `theme.colors.surfaceSunken`
- primary surface: `theme.colors.surface`
- raised interactive surface: `theme.colors.surfaceRaised`

Depth comes from spacing, hairline boundaries, typography, and restrained surface contrast. Do not communicate depth with glow.

### 4.2 Semantic color

Color has meaning, not decoration:

- neutral judgment / unknown: text + muted border
- canonical information: `info`
- positive evidence / healthy state: `success`
- uncertainty / stale / incomplete: `warning`
- error / invalidation / blocked: `danger`
- `primary` is reserved for selection/focus/navigation, not ambient decoration

Never render a positive green state from missing or unavailable data.

### 4.3 Typography

Use the existing Noto Sans KR stack and existing theme sizes. Hierarchy must come from weight and spacing before adding larger text.

- screen title: heading/title token
- current judgment thesis: title, maximum three lines before drill-down
- section title: title/body semibold
- evidence body: body
- provenance/freshness: caption/micro
- metrics use tabular numerals

No all-caps English wall. English micro-labels may exist only where they improve scanning and always have Korean semantic context.

## 5. Screen contract

### 5.1 NUSA / Home

First viewport contains exactly three product layers:

**NOW**
- PAPER-only authority
- runtime state
- transport
- heartbeat freshness
- market freshness

**JUDGMENT**
- canonical judgment when available
- otherwise existing `AiReadOnlyProjection` observation without pretending it is the canonical judgment
- thesis
- confidence only when its source semantics permit display
- uncertainty independently
- judgment freshness

**WHY**
- top 2 evidence items
- top 1 counter-evidence item
- disagreement count/state if canonical and available
- one drill-down action to `AiSignal`

Below the first viewport:
- public market observation context
- PAPER capital context
- supervision/learning context

Home does not contain a hero candle chart or a large account-balance hero.

### 5.2 판단 / Judgment

The first viewport is the canonical Judgment Object, never an execution ticket.

Order:

1. market + action observation label
2. thesis
3. confidence and uncertainty side-by-side but visually independent
4. regime
5. freshness / generatedAt when provable
6. authority line: `AI 판단 · 실행 권한 없음`

Progressive disclosure sections:

**근거**
- full `evidence[]`
- full `counterEvidence[]`
- preserve each evidence item's epistemic status exactly
- no conversion of unknown evidence status into verified evidence

**시나리오**
- full `scenarios[]`
- use canonical labels/values only
- do not invent probabilities when absent

**리스크**
- expected return
- downside
- risk budget
- horizon
- invalidation condition

**프로비넌스**
- canonical identity/freshness where authoritative
- source/evidence references where supplied
- diagnostics remain secondary

Do not show entry price, stop-loss, take-profit, R/R, Risk Veto, Signal Funnel, rejected-signal history, fake agent votes, or hidden reasoning unless a separate canonical source is later delivered.

### 5.3 시장

Markets stays read-only observation:
- watchlist
- chart
- public feed freshness
- market state

It may navigate to current Judgment when the market identity matches, but must not manufacture judgment from price movement.

### 5.4 PAPER

Production PAPER is supervision and learning only:
- PAPER account truth
- learning/performance
- judgment history only when canonical source exists
- calibration/learning evidence when available

No manual BUY/SELL production ticket.

### 5.5 자산

- Cloud PAPER portfolio preferred
- LOCAL PAPER fallback only where existing contract permits
- REAL_READ_ONLY visually and arithmetically separate
- never sum PAPER and REAL balances
- allocation, equity, PnL and exposure remain contextual facts, not AI authority

## 6. Canonical judgment consumer change after #1914 is consumable

`presentAiTradingJudgment()` currently exposes scalar labels and only counts for evidence/scenarios. The reconciliation implementation must preserve the validated `AiTradingJudgment` object for progressive disclosure rather than rebuilding facts from formatted strings.

Required consumer data:

- `market`
- `action`
- `thesis`
- `marketRegime`
- `confidence`
- `uncertainty`
- `evidence[]`
- `counterEvidence[]`
- evidence epistemic status
- `scenarios[]`
- `expectedReturn`
- `downside`
- `riskBudget`
- `timeHorizonMs`
- `invalidationCondition`
- canonical identity/freshness fields when authoritative

The presentation adapter may provide display strings, but it must not collapse arrays to counts when the detail UI needs original canonical objects.

## 7. State model

The UI must never merge these meanings:

- `LOADING`: request in progress
- `READY`: canonical data available
- `STALE`: previously valid data exceeds freshness rule
- `ERROR`: retrieval/validation failed
- `UNKNOWN`: truth cannot be established
- `EMPTY`: valid source confirms no records
- `NO_WORK`: canonical pipeline confirms no applicable work
- `BLOCKED`: an explicit gate prevents progress

Missing judgment is not HOLD. Missing confidence is not zero confidence. Missing evidence is not evidence against.

## 8. Motion contract

Motion is telemetry only.

Allowed triggers:
- authoritative judgment identity changes
- canonical generatedAt/content changes
- runtime state changes
- freshness transition
- user navigation/expansion interaction

When `STALE`, `ERROR`, `UNKNOWN`, or `BLOCKED`, ambient/runtime motion stops.

Reduced motion:
- no interpolation animation for state replacement
- use immediate content replacement
- retain semantic status text

Never animate fictional `OBSERVE -> REASON -> VERIFY -> DECIDE` AI thinking progress.

## 9. Responsive contract

Acceptance widths:

- 360 px
- 390 px
- 430 px
- tablet layout >= 768 px

At 360 px:
- no horizontal scrolling for core content
- confidence/uncertainty may stack if required
- evidence/counter-evidence uses a single column
- authority rail may wrap detail but authority identity remains visible
- no clipped Korean text for primary judgment/action labels

At 390/430 px:
- preserve single-column reading order
- two-column metric treatment allowed only when labels remain legible

Tablet:
- progressive disclosure may use two-pane evidence/detail layout
- semantic order remains identical to mobile

## 10. Android acceptance workflow delta

The existing `Android Product UX Acceptance` Pixel 6 flow is necessary but insufficient for the reconciliation release gate.

The post-approval implementation must extend, not duplicate, that workflow to verify:

- Home capture
- Judgment capture
- Judgment evidence expanded
- Scenario section
- Risk/invalidation section
- Markets
- PAPER
- Portfolio
- Settings
- return to Home

Acceptance evidence must cover 360/390/430 equivalent viewports or deterministic Android device profiles that prove those widths. A single Pixel 6 screenshot set cannot satisfy the width-parity contract.

Artifact report must include:
- viewport/profile
- route
- screenshot
- UI hierarchy dump
- required semantic test IDs
- clipping/overflow assertion result
- reduced-motion assertion result where automated

## 11. Accessibility acceptance

- interactive targets >= 48 px
- screen headers exposed as headers
- status communicated in text, never color alone
- logical screen-reader order follows visual hierarchy
- actionable controls have accessibility role/label
- dynamic type must not hide authority, thesis, invalidation, or error text
- confidence and uncertainty announced as separate values

## 12. One clean reconciliation implementation scope

After #1889 explicitly approves and the dependency branch is legally consumable under current Release governance, create/continue exactly one implementation scope covering:

1. visible `AI -> 판단` IA change while retaining route ID `AiSignal`
2. Judgment progressive disclosure using canonical objects
3. Evidence Glass convergence on Home + Judgment first
4. shared primitive/token cleanup required by those screens
5. Android 360/390/430 + tablet/accessibility acceptance
6. actual screenshot artifacts

Markets/PAPER/Portfolio visual convergence may be included only where it is token/primitive fallout from this same scope; avoid unrelated product behavior changes.

## 13. Release acceptance

UI work is not DONE until all are true:

- exact implementation head is known
- focused tests PASS
- typecheck/build/lint/security PASS
- authority/safety tests PASS
- unresolved review threads = 0
- 360/390/430 acceptance PASS
- Android screenshot evidence exists
- reduced-motion/accessibility acceptance PASS
- #1889 disposition permits the implemented contract
- canonical exact-head Audit/Release path permits merge
- exact-main post-merge CI PASS
- PAPER production deployment provenance is verified when deployment is required

No generic merge, manual bypass, PAT bypass, or fabricated release evidence.

Safety invariants remain:

`PAPER_ONLY`

`liveAuthority=NONE`

`productionMutationAllowed=false`

`aiAuthority=ZERO_AUTHORITY`
