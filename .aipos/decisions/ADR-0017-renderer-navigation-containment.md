# ADR-0017: Renderer navigation containment

## Status

Accepted. Repository implementation only; defense-in-depth hardening of an existing
boundary. No LIVE, real-money, credential, or production-mutation surface is touched.

## Context

`apps/desktop/src/preload.ts` exposes eight bridges through `contextBridge`
(`nusa`, `nusaApp`, `aiCioDashboard`, `shadowPilot`, `recoveryReview`,
`operations`, `aiChallenger`, `aiResearch`). The bridge is deliberately narrow:
every channel name is a fixed literal, mutations are never auto-retried, and
`openFolder` takes one of three keys rather than a path.

The window itself is correctly isolated — `contextIsolation: true`,
`nodeIntegration: false`, `sandbox: true`, `webSecurity: true` — and
`apps/desktop/renderer/index.html` carries a strict
`default-src 'self'; object-src 'none'; base-uri 'none'` meta CSP.

What was absent was any restriction on where that webContents may go. There was
no `will-navigate` handler, no `setWindowOpenHandler`, and no explicit
`webviewTag: false` anywhere in `apps/desktop`. Two properties make that gap
matter:

1. A preload is re-injected on every navigation in a webContents. A renderer that
   reached remote content would hand that content the entire bridge — including
   `activateKillSwitch`, `placeOrder`, `openFolder`, `exportDiagnostics`, and
   `recoveryReview.ownerReview`.
2. A meta CSP applies only to the document that carries it. After a navigation the
   new document carries the remote server's headers instead, so the CSP does not
   constrain the attacker's page. A meta CSP also does not restrict top-level
   navigation in the first place; `navigate-to` and `form-action` are not set.

No exploit path is currently reachable: the renderer builds every node with
`createElement`/`replaceChildren`, uses no `innerHTML`, and contains no anchors
or `window.open` calls. This is therefore a latent gap rather than a live
vulnerability — but it is the gap that would turn any future link, or any future
HTML-string rendering of AI or market text, into full bridge disclosure.

## Decision

1. Add `isAllowedRendererNavigation(currentUrl, target)`: a navigation is permitted
   only to the same `file:` document path the window already has, with no query.
   Reloads and in-page fragments stay; everything else is refused.
2. Add `applyRendererNavigationPolicy(contents, onBlocked)`, which pins a
   webContents to its current document: `will-navigate` is prevented unless the
   check above passes, `will-attach-webview` is always prevented, and
   `setWindowOpenHandler` always denies.
3. Register that policy on `app.on("web-contents-created")` rather than on the one
   window, so any surface added later is covered by default.
4. Add `webviewTag: false` to `browserWindowSecurityOptions`. A `<webview>` would
   own a webContents created outside this policy.
5. Record each block as a `RENDERER_NAVIGATION_BLOCKED` startup diagnostic with a
   sanitized, length-bounded URL. The app never attempts any of these itself, so
   one occurring is either a defect or an attempt to reach the bridge.

## Safety invariants

- `liveAuthority=NONE`
- `productionMutationAllowed=false`
- AI remains ZERO_AUTHORITY.
- The existing isolation guarantees are unchanged and still asserted at the call
  site: `contextIsolation`, `nodeIntegration`, `sandbox`, `webSecurity`.
- The policy only ever narrows what the renderer may do; no channel, capability, or
  origin is added.

## Consequences

The preload bridge is now reachable only from the local document the app ships,
independently of how disciplined the renderer's DOM construction stays. The one
behavioral cost is that any future feature genuinely needing an external link must
open it through a main-process handler (`shell.openExternal`) rather than by
navigating the window — which is the correct shape for that anyway.
