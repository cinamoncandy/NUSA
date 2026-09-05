# NUSA Mobile Visual System Spec (canonical reference)

Status: **reference document — introduces no new tokens, changes no pixels.**
Every value below is quoted from the implementation; the files are the
source of truth. New UI work must reuse these tokens instead of inventing
parallel values. `authority_impact: none`.

Canonical sources:

* `apps/mobile/src/designSystem.ts` — presets, palette, type, spacing, radii, shadows, interaction
* `apps/mobile/src/ThemeProvider.tsx` — dark/light resolution, OLED handling
* `apps/mobile/src/uxLayout.ts` — workspace metrics, `metricTone()`
* `apps/mobile/src/homeVisualProfile.ts` — per-preset HOME hero metrics
* `apps/mobile/src/numberFormat.ts` — financial number language
* `apps/mobile/src/watchlist.ts` — `formatFeedAgeMs` relative-age rule
* `apps/mobile/src/homeStatusRail.ts` — status/risk/freshness domain rules

---

## 1. Product personality

Calm · Precise · Professional · Intelligent · Dense but readable · Trustworthy.
Never: casino, neon-crypto, cyberpunk, hacker terminal, toy AI app, generic
Material demo. Matches MASTER VISUAL REFERENCE direction (#536): black
dominant, white/gray structure, luminous accents used sparingly for
signal — never for large generic surfaces.

## 2. Color semantics (meaning, not decoration)

| Token family | Meaning | Notes |
|---|---|---|
| `success` / `danger` | FACT market outcomes (up/down, profit/loss) | Always paired with icon/text/label, never color-alone |
| `warning` | caution, stale, degraded, pending | |
| `info` | read-only, neutral system facts | |
| `primary` / `primarySoft` | product chrome, selected states, PAPER surfaces | Subdued fills, not large teal CTAs |
| `aiSignalStart/Mid/End/Soft` | AI interpretation surfaces ONLY | Must stay visually distinct from success/danger |
| `text` / `textMuted` | hierarchy levels 1 / 2-3 | |
| `surface` / `surfaceSunken` / `surfaceRaised` | container depth (sunken = inset/data, raised = selected) | |
| `border` / `borderStrong` | hairline structure, strong = emphasis containers | |

Known tension (deferred, do not freelance): in dark mode `success` and
`aiSignalEnd` resolve to the same teal. Pinned by design-system tests and
entangled with the MASTER board direction — owner decision required.

## 3. Typography

* Weights only: `regular 400`, `medium 500`, `semibold 600`, `bold 700`
  (`theme.typography.weights`). No other weights anywhere.
* Financial numbers: `fontVariant: ["tabular-nums"]`, right-aligned in
  comparison layouts (watchlist rows, metric cells).
* Hero values: `adjustsFontSizeToFit` + `numberOfLines={1}` (never clip).
* Status/meta lines may wrap; never `numberOfLines={1}` without shrink.
* Confidence: whole percent or High/Medium/Low — no false precision
  (e.g. never `78.41%`); uncalibrated confidence renders as missing.

## 4. Spacing / layout / shape

* Scale only: `0 / 4 / 8 / 12 / 16 / 24 / 32 / 48` (`theme.spacing`).
* Radii: `sm / md / lg` only. Shadows: `sm / md / focus / glow`, minimal —
  hierarchy only, never decoration on every card.
* Workspace: `maxWorkspaceWidth: 1080`, phone gutter `20`, section gap
  `24`, content gap `14` (`uxLayout`). One horizontal padding per screen.
* Cards must earn their surface: flat rows/sections by default; no
  card-in-card nesting.
* Touch: major actions `minHeight 48`; pressed feedback
  `pressedOpacity: 0.88`, disabled `0.42`.

## 5. Motion

Purpose-built only: state transition, refresh, expand/collapse,
navigation. Fast and restrained. No constant pulse, decorative movement,
or endless animation. Haptics only on critical interactions.

## 6. Numbers (all screens, no exceptions)

* KRW: `formatKRW` — rounded, ko-KR grouping, `₩` prefix.
* Signed PnL: `formatSignedMoney` — explicit `+`/`-`.
* Ratios: `formatSignedPercent` — 2 decimals; missing renders as the
  caller-owned label (`—` hero, `-` rows), never `0.00%` for unknown.
* Unbounded cumulatives (turnover): `formatCompactKRW` (`₩12.3K/M/B`).
* Precision lives in the domain layer; views never round accounting.

## 7. Freshness (first-class, every feed surface)

* STALE chip + relative age (`방금`, `N초 전`, `N분 전`, `N시간 전`)
  via the shared `formatFeedAgeMs` rule.
* Unverifiable age renders as nothing — never a guessed timestamp.
* Stale data keeps full visibility at reduced emphasis; never normal colors.
* HOME adds snapshot-age-first ordering (PAPER state age beats feed age).

## 8. FACT vs AI (visual contract)

* FACT: prices, timestamps, fills, PnL, runtime state — neutral type,
  tabular numbers, source labels (`UPBIT PUBLIC`, `PAPER RESULT`).
* AI: labeled `NUSA AI 판단` + `VERIFIED`/`NEUTRAL` badge; thesis +
  calibration-gated confidence + evidence/counter-evidence counts.
* Uncalibrated AI shows no confidence number. Missing AI shows an
  explicit empty state, never a neutral-sounding opinion.
* AI screens state `ZERO_AUTHORITY` and the absence of execution paths.

## 9. Risk language (single vocabulary)

`정상 / 주의 / 상승 / 높음 / 위급 / 확인 불가`
(`homeStatusRail` risk map). Unknown is never styled as safe.
Risk always pairs color + icon/text label.

## 10. States (every screen ships all of them)

`NORMAL / LOADING (skeleton-first) / EMPTY (reason + next action) /
ERROR (message + retry + technical detail) / STALE / DEGRADED / OFFLINE`.
Error = user message + action + technical detail. Empty = why + what next.

## 11. Per-screen contracts

* **HOME**: rail (market/system/risk/freshness) → asset hero (누적 basis,
  never `오늘` on lifetime data) → notices → AI card → terrain → key
  metrics → safety rail. No dead controls; referenceNav is the sole
  visible nav inside the full-bleed shell.
* **Markets**: segmented CHART/WATCHLIST (phone), side-by-side (tablet);
  chart panel carries candle freshness; watchlist rows compare
  price/change/signal with tabular alignment.
* **PAPER**: observatory first (activity summary, quote hero, allocation),
  ticket second (01 조건 → 02 검토 → 03 확정 with confirm step);
  every CTA PAPER-labeled; disabled states explain why.
* **Portfolio**: PAPER summary first, REAL_READ_ONLY strictly separated
  with non-aggregation copy; absolute last-success timestamps.
* **AI**: NOW/WHY/RESULT/RISK/LEARNING; calibration-gated numbers;
  Korean labels for all enums.
* **Orders**: search/filter/period/sort + pagination; absolute fill times.
* **Settings**: grouped (not a list); build identity reachable;
  credentials never displayed.

## 12. Forbidden list

neon/glow/glassmorphism/gradient abuse · card stacks · huge hero text ·
meaningless illustration · decorative graphs · pill-everything ·
badge-everything · endless animation · heavy blur · low contrast ·
tiny fonts · fake confidence/PnL/prices/news · stale-as-fresh ·
LIVE-worded feed labels in a PAPER-only product.

## 13. Verification bar for visual changes

typecheck (root+mobile) · lint · related suites green · pinned visual
contracts intact (`*-visual-*.test`, `*-canonical*.test`,
`design-system*.test`) · production route re-confirmed · no new
hardcoded color/spacing/typography outside tokens. Device rendering,
OLED, 200% physical font, gestures: HUMAN_ONLY.
