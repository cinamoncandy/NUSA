# NUSA Frontend Design Direction

## Product character
NUSA is a personal investment-intelligence workspace, not an exchange. The interface must feel calm, exact, premium, and trustworthy while making PAPER / READ ONLY / ZERO AUTHORITY impossible to misunderstand.

## Platform scope
Android is the product target for this frontend completion pass. iOS is not a release blocker and is outside the definition of done unless explicitly reintroduced later.

## Reference synthesis
The visual direction is informed by contemporary finance and trading case studies on Behance: dense information is grouped into a small number of strong surfaces; portfolio values and market prices receive the strongest typographic hierarchy; navigation stays quiet; semantic color is reserved for status, P&L, risk, and action meaning. References are inspiration only, never copied layouts or assets.

## Principles
1. **Obsidian first** — near-black surfaces with restrained mint intelligence accents; light mode remains fully supported.
2. **Numbers lead** — financial values use tabular numerals and stronger hierarchy than labels.
3. **One primary decision per surface** — cards should answer one question before exposing secondary detail.
4. **Semantic color discipline** — mint = primary/intelligence, green = positive/healthy, amber = caution, red = loss/blocking, blue-gray = informational.
5. **Safety is structural** — PAPER and read-only authority are persistent UI states, not footnotes.
6. **Touchable and accessible** — primary controls use 48px targets; compact segmented controls never fall below 40px and expose tab semantics.
7. **Quiet chrome** — borders and elevation separate information without decorative noise.
8. **State completeness** — loading, empty, stale, disconnected, blocked, error, and success states must look intentional.

## Core hierarchy
- Global: NUSA identity → authority strip → current workspace → bottom navigation.
- Home: total equity / system health → next action → intelligence summary → secondary operational detail.
- Markets: watchlist first, chart second; switching uses a compact segmented control rather than two primary CTA buttons.
- PAPER: market and account readiness first; mutation controls only exist when explicitly enabled.
- Portfolio: total equity and P&L first → realized/unrealized split → allocation → position detail.
- AI: confidence and evidence must remain distinguishable from raw model probability.

## Interaction language
- Pressed controls reduce opacity subtly and may scale by at most 1%.
- Disabled state is visibly muted and exposes accessibility disabled state.
- Text fields visibly distinguish focus with the design-system focus token.
- Selected tabs expose selected accessibility state.
- Decorative brand marks are hidden from accessibility trees.

## Definition of frontend complete
Frontend completion requires visual consistency across every reachable screen, intentional empty/loading/error/disconnected states, accessibility semantics for navigation and controls, design-system contract tests, TypeScript/lint/build success, exact-head CI success, Android native build success, and Android physical-device visual acceptance when human-environment evidence is available.
