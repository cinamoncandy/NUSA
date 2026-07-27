# DOKKAEBI mobile app

A real Expo/React Native client for `apps/server`'s REST API -- Dashboard, Portfolio, Control
(start/stop/auto-trade), Kill Switch, and foreground local notifications for new ORDER/RISK
events. No business logic lives here; every screen just renders what the server already
computes, the same way `apps/web` does.

This is a standalone npm-managed project, deliberately excluded from the repo's root pnpm
workspace (see `pnpm-workspace.yaml`) -- its native React Native dependency graph has nothing to
do with the rest of this monorepo's Node-only TypeScript build, and folding it into the shared
`pnpm-lock.yaml` would only risk breaking both.

## Run it

```bash
cd apps/mobile-app
npm install
npm run web      # or: npm start (Expo Go on a phone), npm run ios / npm run android
```

On first launch, open the **설정** (Settings) tab and enter the DOKKAEBI server's address (e.g.
`http://192.168.0.10:4100` for a phone on the same LAN) and, if the server has
`DOKKAEBI_API_KEY` set, the API key. Both are required for every other tab to load real data.

## What's real vs. honestly out of scope

- **Real**: every screen calls `apps/server`'s actual REST API (`/api/market`, `/api/account`,
  `/api/control`, `/api/strategy/start|stop|auto-trade`) -- verified against a real running
  server via `expo export --platform web` (a real Metro bundle) and a real Playwright session
  driving the web build end to end, including placing real orders and toggling the Kill Switch.
- **Local notifications, not push**: the "알림" toggle polls `GET /api/control` while this app is
  open and fires a local device notification for new ORDER/RISK events (native: `expo-notifications`;
  web: the browser's own `Notification` API, since `expo-notifications` has no web implementation
  at all). This is honestly foreground-only -- a true always-on push (notified even after the app
  is force-quit) needs a deployed EAS project with push credentials, which nothing in this
  sandbox can provision or verify. `apps/server`'s existing webhook notifier
  (`apps/server/src/webhookNotifier.ts`) is the one channel that already works regardless of
  whether this app is even running.
- **No manual order placement UI** in this first pass -- the API client only wires up what the
  four requested screens (Dashboard/Portfolio/Control/Kill Switch) actually need.
