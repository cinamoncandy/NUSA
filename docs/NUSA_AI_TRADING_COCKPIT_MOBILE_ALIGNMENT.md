# NUSA AI Trading Cockpit — Native Mobile Alignment

## Decision

The native React Native application is not replaced by a scaled-down copy of the desktop cockpit.

It already implements an independent mobile operating model with `HomeView`, `MarketsView`, `TradingView`, `PortfolioView`, `AiView`, order history, notifications, and settings. The redesign therefore preserves that validated navigation/runtime ownership and aligns its product semantics with the AI Trading Cockpit rather than rebuilding the mobile shell for visual symmetry.

## Existing mobile strengths retained

- Home is a supervisor surface, not a desktop dashboard squeezed into a phone.
- The Home supervisor explicitly exposes `PAPER ONLY · LIVE NONE` and AI zero-authority state.
- Public market observation is separated from Paper operation.
- Paper trading has its own task surface.
- Portfolio is a supervision task rather than a generic account page.
- AI signal and order history are reachable as focused secondary destinations instead of permanently occupying scarce bottom-navigation space.
- Settings and notifications are utilities outside primary task navigation.
- The design system enforces 48px interaction targets.
- Missing verified market truth is rendered as unavailable rather than invented.

## Cockpit semantic mapping

| Cockpit concept | Native mobile surface | Treatment |
| --- | --- | --- |
| Command Home | `HomeView` | retain evidence-first supervisor summary and next action |
| Markets | `MarketsView` | retain public read-only observation |
| Order Station | `TradingView` | retain explicit Paper-only operation |
| Portfolio + Risk | `PortfolioView` + supervisor risk row | retain runtime-backed supervision; no fabricated risk limits |
| AI Decision | `AiView` | retain focused secondary destination from Home |
| Analytics + Activity | order history + Paper learning / monitor surfaces | retain focused secondary/deep surfaces |
| Settings + Authority | `SettingsView` + app shell | retain utilities outside the main task rail |

## Navigation decision

The desktop canonical renderer keeps five primary destinations because that is its tested architecture. Native mobile currently uses four primary task tabs (`Home`, `Markets`, `Paper`, `Portfolio`) and exposes AI Signal / Order History as contextual destinations.

The redesign intentionally does **not** force the desktop count onto native mobile. Mobile navigation is optimized for thumb reach and task frequency, while semantic meaning remains shared.

Changing this only for symmetry would add navigation churn without adding authoritative trading information.

## Visual alignment

The existing `master` mobile preset already supplies the intended cockpit qualities:

- dark low-glare background;
- compact spacing and restrained radii;
- strong numeric hierarchy;
- semantic success/warning/danger colors;
- evidence-first supervisor panels;
- compact status labels;
- explicit Paper / LIVE NONE copy.

No new decorative visual system is introduced in this work order.

## Safety alignment

Native mobile remains governed by its existing runtime and mobile session boundaries. This redesign does not:

- grant LIVE or REAL execution authority;
- change Paper submission gates;
- change credential/session handling;
- synthesize confidence, risk limits, drawdown, concentration, or order states;
- move AI from analysis/proposal into execution authority.

## Implementation outcome

Desktop receives the substantial structural/presentation rewrite because its canonical surface was the gap. Native mobile is retained as an independent cockpit implementation because its current master UX already follows the target principles more closely than a desktop-derived rewrite would.

Future native mobile changes should be driven by measured usability gaps or new authoritative data contracts, not by visual parity with desktop.
