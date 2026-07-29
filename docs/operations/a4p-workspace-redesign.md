# A4P Workspace Redesign

The desktop renderer now uses screen-level workspace views. Navigation changes the active
main-content view and does not scroll a single long document. Existing runtime IDs remain in
place inside their owning view so the safety and IPC code keeps its original contracts.

## Information architecture

| View | Purpose |
| --- | --- |
| Dashboard | Safety state, market state, Shadow state, next action, recent activity |
| Market | Public market price and chart |
| Shadow Session | Observation controls, session counters, event timeline |
| Orders & Fills | Paper ledger records |
| Portfolio | Paper account values |
| Risk & Safety | User summary plus read-only A4 diagnostics |
| Recovery | Recovery process rail plus reconciliation controls |
| Evidence | Evidence discovery controls and immutable-record context |
| Diagnostics | Deep AI/runtime inspection |
| Settings | Product preferences |
| About | Version, environment, safety and folder actions |

The dashboard intentionally does not show raw diagnostics or the event log. Those remain in
Shadow Session and Diagnostics, where their detail is useful without competing with the next
user action.

## Visual validation

Screenshots were captured from the Electron app with the public-data runtime present. No Shadow
start command, order command, private API, credential, or account mutation was invoked.

- Dashboard: `docs/artifacts/a4p-v2/dashboard.png`
- Dashboard 1280x720: `docs/artifacts/a4p-v2/dashboard-1280x720.png`
- Dashboard 1440x900: `docs/artifacts/a4p-v2/dashboard-1440x900.png`
- Dashboard 1920x1080: `docs/artifacts/a4p-v2/dashboard-1920x1080.png`
- Market: `docs/artifacts/a4p-v2/market.png`
- Shadow Session: `docs/artifacts/a4p-v2/shadow-session.png`
- Orders & Fills: `docs/artifacts/a4p-v2/orders.png`
- Portfolio: `docs/artifacts/a4p-v2/portfolio.png`
- Risk & Safety: `docs/artifacts/a4p-v2/risk.png`
- Recovery: `docs/artifacts/a4p-v2/recovery.png`
- Evidence: `docs/artifacts/a4p-v2/evidence.png`
- Diagnostics: `docs/artifacts/a4p-v2/diagnostics.png`
- Settings: `docs/artifacts/a4p-v2/settings.png`
- About: `docs/artifacts/a4p-v2/about.png`

## Accessibility and safety

View headings receive focus when navigation changes. Navigation exposes `aria-current`, inactive
views expose `aria-hidden`, long values use copy affordances, and reduced-motion disables view
animation. The redesign adds no IPC channel and keeps `LIVE TRADING DISABLED`, sandbox, and
renderer isolation unchanged.
