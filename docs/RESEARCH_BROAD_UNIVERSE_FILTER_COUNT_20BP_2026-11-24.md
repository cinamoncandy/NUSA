# Broad-universe step 2b at the looser bar (20 bp): count and gate (2026-11-24)

Made once, as pre-registered in `docs/RESEARCH_BROAD_UNIVERSE_LOOSER_FILTER_PREREG_2026-11-24.md` (merged before the count) with the count tool of #3274 (independent review: no P1). Counts and market codes only; no candle price, volume or return is printed or committed. The first count (#3266, 10 bp: forward pool 29) stands unedited.

## Result (`docs/research-data/broad-universe-filter-count-20bp-2026-11-24.json`)
| Step | 10 bp (first count) | **20 bp (this count)** |
|---|---|---|
| markets in file / with enough window days | 300 / 92 | 300 / 92 |
| pass tick bar | 37 | **57** |
| pass traded-value bar (unchanged) | 91 | 91 |
| pass both | 36 | **56** |
| discovery pool after pegged assets | 36 | **56** |
| forward pool, lenient boundary (after the six study markets and warning flags) | 29 | **48** |
| forward pool, alternative boundary | 26 | **49** |

## Gate
The design gate needs at least 40 forward markets, evaluated on the strict count. **Both boundary counts are at least 40 (48 and 49): the gate is passed.** The 29 markets of the first count are all inside the new 48; 19 markets are added (1INCH, ADA, AHT, ARK, AWE, DKA, FCT2, GAME2, GMT, HIVE, HUNT, IQ, MVL, ORBS, PUNDIX, SC, STRAX, STX, TFUEL).

## Caveats
- The two boundary labels are not ordered in general: with 20 bp the "alternative" boundary gave one more market than the lenient one (49 versus 48), because the tick tiers read from today's prices overlap (for example tick 0.1 up to 99.2 and tick 1 from 83.7 in the recorded tier table). The gate holds under either, so the verdict does not depend on the label.
- The tick tiers are today's tiers applied to the 2021-2023 window median price (a proxy); the ticker snapshot hash (`tickerSnapshotSha256`) and the tier table are recorded in the result file.
- Only 92 of 300 markets had enough window days; delisted markets are not in the list (survivorship).
- The cost consequence stated in the pre-registration applies: a one-tick spread floor of up to 20 bp per side, so a base round trip up to about 0.30 percent and a stress case up to about 0.70 percent. Small low-priced markets are over-represented in the added 19.
- The count is the gate of the design; the real forward market list is a separate snapshot rule at the forward pre-registration.

## What follows (not started; each step needs its own reviewed PR and the owner's go)
Design section 6: tooling PRs (`scripts/run-broad-mining.js`, a new daily/hourly fetch script), hosted-runner fetch with manifests, discover and freeze record, descriptive hold-back veto, forward pre-registration on a snapshot list. No hourly data is fetched by this step; broad fetches stay off the PAPER host before 2026-12-10.
