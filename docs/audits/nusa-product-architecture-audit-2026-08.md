# NUSA Product / Architecture Audit — 2026-08

## Audit result

- Audited base: `main` at `dd951890458eef43b77cd943a89e9e52d84d2500`
- Audit branch: `agent/p0-mobile-first-cloud-audit`
- Scope: repository, Git history, PR/issue evidence, mobile runtime source, deployment workflows, release metadata, tests, AIPOS state
- Code changes: none
- Physical Android device, inbox, and external cloud deployment evidence: unavailable in this environment
- Verdict: **NO** — the repository does not prove that a user can run the promised PAPER product on Android with the PC powered off

The audit does not treat historical CI PASS, merge records, or prior completion notes as product acceptance. Claims below are separated into repository evidence, external evidence, and unknowns.

## Product contract used for comparison

The expected product is mobile-first, PAPER-first, and fail-closed:

- Android uses an approved always-on HTTPS backend without a PC, localhost, LAN address, Quick Tunnel, or manual endpoint entry.
- `liveAuthority=NONE`, `productionMutationAllowed=false`, and AI `ZERO_AUTHORITY` remain true.
- Public Upbit quotation is unauthenticated and read-only.
- Authenticated Upbit data, if enabled, is server-side and read-only; credentials never enter the APK or JS bundle.
- Missing data is shown as unavailable/stale/error, never as fabricated success.
- The supplied NUSA reference board is the visual source of truth; source-level checks do not substitute for device screenshots.

## Evidence limits

No master reference image is stored in this repository, and no physical Android device or `adb` evidence was available during this audit. Therefore visual conformity and Android-only E2E are `UNKNOWN` at best and cannot be marked PASS. The exact run-972 APK and the persistent GitHub release APK were nevertheless downloaded and compared by SHA and bundle markers.

## History and architectural divergence timeline

| Area | Evidence | Audit interpretation |
|---|---|---|
| Cloud runtime bootstrap | `7ae1376` / PR #120 | `apps/cloud` introduced a loopback-first runtime, server, PAPER contracts, and persistence primitives. |
| Mobile PAPER endpoint/settings | `42c559c`, `56e49fb` | Mobile successor was built around a configured PAPER endpoint and operator setup flow. |
| Trusted bridge | `14d4081`, `cff98ce`, `2cf1939`, `50fe5c1`; PRs #403/#420/#486/#490/#527 | Android HTTPS was added as a bridge to a locally running loopback runtime; this improved transport security but did not remove the PC dependency. |
| Public quotation | `6b1008a`; PR #526 | Direct Upbit public ticker/candle access was separated from PAPER and is independently usable. |
| Authenticated read-only Upbit | `ea2c216`, `8692029`; PRs #513/#514/#516/#517/#518 | A source-controlled read-only bridge exists, but its credentials and deployment remain server-side/source-only rather than an Android-ready always-on service. |
| Visual work | PRs #528–#535 | Visual and Home changes were merged or held at source level, but device screenshot acceptance was not established. #535 remains Draft/HOLD. |
| Android distribution | PRs #512/#534 and `android-persistent-release.yml` | A persistent, clobbered release channel exists, but source/hash identity is not reliably coupled to the uploaded APK. |

The first clear production-path divergence is the mobile PAPER endpoint/bridge design: the mobile client requires a configured endpoint and the bridge runbook requires a PC-hosted loopback runtime. The bridge is a secure transport layer, not an always-on cloud architecture.

## Mobile runtime trace

| Feature | UI → client → transport → source | PC needed | Manual endpoint/token | Cloud backend | Offline | Runtime status |
|---|---|---:|---:|---:|---:|---|
| Home | `App.tsx` → `personalPaperOperationsClient.ts` → configured PAPER HTTPS/loopback endpoint → `/api/paper-operations` → PAPER snapshot | Yes for current PAPER path | Yes | Source-side only; no deployed origin proven | Shell only | Partial / blocked when endpoint is absent |
| Markets | `App.tsx` → `upbitPublicQuotationClient.ts` → direct HTTPS GET to Upbit Quotation API → ticker/candles | No | No | No | No | Implemented public path |
| Chart | `ChartView.tsx` → public candle state → Upbit candles normalized oldest-first | No | No | No | No | Implemented when public data is reachable |
| PAPER action | `PAPER`/order UI → `personalPaperOrderClient.ts` → authenticated POST `/api/paper-orders` → cloud PAPER engine | Yes for current path | Yes, verified endpoint plus memory token | Source-side only; no deployed origin proven | No | Partial / endpoint-gated |
| Portfolio | `App.tsx` → snapshot projection → `/api/paper-operations` response | Yes for PAPER portfolio | Yes | Source-side only | No | Partial; projection is single-position |
| AI | `App.tsx`/`aiView.tsx` → `snapshot.ai` → evidence-bound AI fields from PAPER/cloud contracts | Yes when snapshot-backed | Indirectly | Source-side AI runtime exists; deployed path unproven | No | Read-only contract exists; external runtime unproven |
| Settings | `settingsView.tsx` → persisted `paperEndpoint` and process-memory session token | N/A | User must understand endpoint/token | No canonical endpoint supplied | N/A | Product leak / blocker |

### PC and tunnel search classification

- **Production-path dependency:** `apps/mobile/src/settings.ts`, `App.tsx`, `personalPaperOperationsClient.ts`, `personalPaperOrderClient.ts`, `docs/TRUSTED_HTTPS_BRIDGE.md`. PAPER requires a configured endpoint; the documented trusted path terminates at a local cloudflared process and local NUSA runtime.
- **DEV/diagnostic deployment recipe:** `deploy/cloudflare-tunnel/config.example.yml`, `scripts/start-trusted-https-bridge.js`, `deploy/oracle/nusa.service`. These are not proof of an active always-on deployment.
- **DEV/test/dead loopback fallback:** `apps/mobile/src/apiClient.ts` defaults to `http://127.0.0.1:41731`; no mobile production call site instantiates this client, but its presence is a future integration hazard.
- **Fail-closed server boundary:** `apps/cloud/src/server.ts` and `cloudRuntimeConfig.ts` deliberately bind/reject non-loopback hosts. This is safe for the local runtime but incompatible with an externally reachable service until a deployment boundary is explicitly designed.

## Cloud backend audit

`apps/cloud` contains meaningful source-side runtime, health/readiness, SQLite persistence, recovery, PAPER operations, market-data, dashboard, and AI contracts. It is not a deployed always-on backend in the audited evidence.

- `nusa.md` describes hosting, persistence, and authentication for real deployment as open decisions and does not identify a running cloud process.
- `docs/deployment/firebase-readiness.md` explicitly leaves Functions/Hosting out and keeps SQLite authoritative.
- `deploy/oracle/nusa.service` is a hypothetical systemd recipe, not deployment evidence.
- `deploy/cloudflare-tunnel` publishes a local loopback service, not a cloud backend.
- No approved provider, deployed origin, health URL, secret-store binding, rollback record, or external readiness evidence was found.

Result: **MISSING — CANONICAL ALWAYS-ON BACKEND**. Provider selection/deployment authority is an external blocker; this audit does not choose one.

## PAPER audit

| Contract | Result | Evidence |
|---|---|---|
| State/read snapshot | PARTIAL | `apps/cloud/src/server.ts` and `runtime.ts` implement the contract; mobile requires a verified configured endpoint. |
| Simulated order | PARTIAL | `/api/paper-orders` is a deliberate PAPER mutation, guarded by the PAPER contract; mobile transport is endpoint/token-gated. |
| History | PARTIAL | Source-side operations/history exist; Android-only access is not proven. |
| Persistence/restart recovery | IMPLEMENTED IN SOURCE / EXTERNAL UNPROVEN | Durable SQLite/recovery code and tests exist; no deployed process or Android relaunch evidence. |
| PC-off operation | BLOCKED | No canonical backend and current mobile setup requires a local/remote endpoint entered by the user. |
| Failure handling | IMPLEMENTED IN SOURCE | Clients fail closed on missing endpoint, redirects, invalid responses, and unsafe origins. |

## Upbit audit

### Public quotation

`apps/mobile/src/upbitPublicQuotationClient.ts` is a genuine direct public path: HTTPS GET-only, no `Authorization`, bounded candle count, finite/non-negative validation, market/timestamp validation, and reverse-chronological candle normalization. Ticker, candle, gap, malformed, HTTP failure, stale, no-auth, and GET-only tests exist. This path is **IMPLEMENTED** and does not require PAPER connectivity.

### Authenticated read-only

`services/upbit-readonly/server.js` reads `UPBIT_ACCESS_KEY`/`UPBIT_SECRET_KEY` from server environment, creates JWT server-side, requires a bearer bridge token, and exposes only GET account/order queries. `apps/mobile/src/upbitLiveClient.ts` is HTTPS-only and read-only. No APK, JS bundle, or mobile persistent secret was found in the inspected path. Deployment of this bridge is not proven, so the feature is **SOURCE-IMPLEMENTED / DEPLOYMENT-UNKNOWN**.

### Mutation surface

No production Upbit order/cancel/withdraw/transfer route was found in the inspected mobile/bridge path. PAPER order POST is intentionally separate and must not be confused with LIVE authority. The repository safety contracts retain `liveAuthority=NONE`, `productionMutationAllowed=false`, and AI zero authority.

## AI audit

`aiView.tsx` displays evidence-bound thesis, confidence/probability fields, counterevidence, and recent analysis. The source distinguishes calibrated confidence from raw probability and states read-only/zero authority. The inspected code shows no downstream order, cancel, withdrawal, transfer, or LIVE mutation path.

The remaining risk is UX interpretation: confidence/probability can be visually read as a trading guarantee if evidence/state context is weak. This is not evidence that values are fabricated; it is a product and comprehension finding.

## Settings and product-leak audit

The current production-facing Settings path exposes:

- `Cloud endpoint`
- `세션 토큰`
- endpoint save/verify
- `PAPER 서버`/bridge connection language
- operator/readiness diagnostics

`settings.ts` persists an empty `paperEndpoint` by default and permits HTTPS or loopback HTTP. `settingsView.tsx` provides endpoint/token controls and says the endpoint is saved locally while the token is process-memory-only. This is an infrastructure setup screen exposed as a product requirement. A normal user cannot be expected to know a URL, port, tunnel, bearer token, or PC runtime.

## Distribution and artifact identity audit

The exact Mobile Native run 972 was verified:

- source/head: `1adb7c635c0561b10c0a9a806adc8ede4ae26bda`
- run: `31888787751` / #972
- exact artifact APK SHA-256: `0d58b920d667c1e3c60514fa7e034eb522bd161b36212e68b48af72fb795a949`
- bundle contained `NUSA / HOME` and `ACCOUNT EQUITY`

The persistent GitHub release `nusa-android-preview` was also verified:

- release target commit: `ee0a8ef32657f37c821235f0dac46041facca4a5`
- uploaded `NUSA-Android.apk` SHA-256: `73844765ba8f4907ae8d6297c03a681c46055967d1aa7270cebdec8b53f2557d`
- uploaded provenance claims source `1adb7c635c0561b10c0a9a806adc8ede4ae26bda`, run 972, APK SHA `0d58b920d667c1e3c60514fa7e034eb522bd161b36212e68b48af72fb795a949`
- persistent APK bundle contained old `NUSA ISLAND` and did not contain `NUSA / HOME` or `ACCOUNT EQUITY`

Therefore the release asset hash and provenance hash disagree, and release target and provenance source disagree. The current release workflow also clobbers one persistent release and does not inject `NUSA_BUILD_SHA`/`NUSA_BUILD_NUMBER` before building. `build.gradle` consequently defaults to `1.0.0-dev`/version code `1` when those variables are absent. Release signing uses `signingConfigs.debug`.

This is sufficient to explain an old Home appearing after a claimed new build; it is a distribution identity failure, not evidence that the new Home source was absent from run 972.

## Visual source-of-truth audit

Current `main` Home (`apps/mobile/src/homeView.tsx`) still contains the old composition: `NUSA ISLAND`, `PAPER ONLY`, `LIVE NONE`, a connection block, repeated system/safety block, and three equal MetricTiles (`PAPER 연결`, `PAPER 준비`, `AI 신뢰도`). The expected #535 markers (`NUSA / HOME`, `오늘의 PAPER 상태`, `ACCOUNT EQUITY`, `PAPER · LIVE OFF`) exist on the held PR head, not on current `main`.

The visual result is therefore:

- current main vs held #535 reference: **REGRESSED / NOT PRESENT**
- actual physical screenshot vs master reference: **UNKNOWN**, because no device screenshot/reference asset was available
- source-only visual tests: **FALSE CONFIDENCE** for visual acceptance; they inspect strings/regexes, not rendered pixels or device layout

## Fake data and fallback audit

No inspected production path proved a fabricated equity, PnL, market ticker, or AI evidence fallback. The Home path uses snapshot values and explicit unavailable/readiness states. Public market failures are represented as loading/error/stale/empty states. The following risks remain:

- `apps/mobile/src/apiClient.ts` has a loopback default and is not wired into the current mobile source path; classify as DEV/DEAD, not production runtime evidence.
- Source tests and fixtures can make a contract appear complete without proving deployed data flow.
- No deployed-backend failure test proves the external mobile failure UX.

## Security audit

Repository-level results:

- HTTPS/redirect/final-origin validation: present in mobile clients and bridge contracts.
- Android cleartext: manifest is parameterized and release workflow supplies the secure value; physical APK verification was not possible here.
- Public Upbit: no credentials or Authorization header.
- Authenticated Upbit: server-side environment credentials and JWT; no mobile secret storage found.
- Live mutation: no inspected production Upbit mutation route; PAPER mutation remains separate.
- AI authority: zero-authority contracts present.

These are source-level results only. They do not prove a deployed cloud configuration or a signed production artifact.

## Test reality audit

The repository has meaningful parser, safety, and source contract tests, but several acceptance claims are weaker than their names suggest:

- `tests/mobile-uiux-visual-redesign.test.js` and `tests/mobile-uiux-min-path.test.js` are primarily source/regex assertions; they do not render Home, Markets, Chart, or tablet screenshots.
- `tests/mobile-paper-real-use-ui.test.js` checks source markers and structure; it does not execute a PC-off Android PAPER journey.
- `tests/trusted-https-bridge-contract.test.js` verifies loopback/HTTPS/token contracts statically; it does not prove a live named tunnel or TLS trust on hardware.
- `tests/mobile-settings.test.js` validates endpoint normalization and memory credential behavior, but not removal of endpoint configuration from a production UX.
- Historical PR evidence reports the full isolated suite blocked on Windows symlink privilege (`EPERM` in `tests/backup-restore.test.js`). This must not be reported as full-suite PASS.

These are `FALSE CONFIDENCE TEST` findings, not claims that the individual assertions are useless.

## HUMAN_ENVIRONMENT_ONLY audit

Genuinely external:

- physical Android installation/update and actual Home screenshot
- PC-off Android PAPER read/action/portfolio/history/relaunch/recovery
- real TLS trust, final origin, redirect, and cleartext rejection on hardware
- actual Firebase inbox delivery and tester notification receipt
- production cloud health/recovery against an approved deployment

Automatable but currently treated too broadly as human-only:

- APK source/hash/provenance consistency and embedded bundle markers
- APK application ID/version/signing certificate inspection
- release asset immutability and stale artifact detection
- rendered screenshot tests on a controlled emulator/device farm, if accepted as pre-gate evidence

## Completeness matrix

| Capability | Status | Gap |
|---|---|---|
| Public Markets/ticker/candles | IMPLEMENTED | External network/device rendering still needs evidence. |
| Chart data path | IMPLEMENTED | Device/UI evidence absent. |
| Cloud PAPER engine | SOURCE-IMPLEMENTED | No approved deployed always-on origin. |
| Mobile PAPER auto-connection | MISSING | Manual endpoint/token and local bridge remain required. |
| PAPER persistence/recovery | SOURCE-IMPLEMENTED | Deployment/relaunch evidence absent. |
| Portfolio | PARTIAL | Cloud read-only projection selects one position. |
| AI evidence/read-only | SOURCE-IMPLEMENTED | Deployed runtime and visual comprehension unproven. |
| Upbit authenticated read-only | SOURCE-IMPLEMENTED | Bridge deployment/health unproven. |
| Release provenance | BROKEN | Persistent release asset contradicts its provenance. |
| Visual acceptance | NOT PROVEN | Current main differs from held Home redesign; no physical screenshot. |

## Findings

### P0-001 — Production PAPER path depends on a PC/loopback bridge

- **Expected:** Android PAPER works without a PC, terminal, localhost, LAN address, or Quick Tunnel.
- **Actual:** Mobile PAPER starts without a configured endpoint, requires endpoint verification and a process-memory token, and the trusted bridge runbook requires a local NUSA runtime plus local cloudflared.
- **Evidence:** `apps/mobile/src/App.tsx`, `settings.ts`, `personalPaperOperationsClient.ts`, `personalPaperOrderClient.ts`; `docs/TRUSTED_HTTPS_BRIDGE.md`; `deploy/cloudflare-tunnel/config.example.yml`; PRs #403/#420/#486/#490/#527.
- **User impact:** The Android app is not standalone; PAPER cannot be used when the PC is off.
- **Root cause:** A secure local bridge was treated as the mobile deployment path before an approved always-on backend existed.
- **Recommended correction:** After provider/deployment authority, make a canonical HTTPS origin part of release configuration, remove manual endpoint from production UX, and demote the bridge to DEV/DIAGNOSTIC only.
- **Regression gate:** Production bundle/path scan rejects localhost, LAN, Quick Tunnel, and manual endpoint dependency; PC-off Android E2E passes.

### P0-002 — No approved canonical always-on backend is deployed

- **Expected:** A provider-backed HTTPS service exposes health/readiness, PAPER state/action/history, persistence/recovery, market data, and read-only AI/broker surfaces.
- **Actual:** `apps/cloud` is source-side; Firebase readiness omits Hosting/Functions; Oracle and Cloudflare files are recipes/local bridge configuration; no provider, origin, deployment, secret binding, or external health evidence exists.
- **Evidence:** `nusa.md`, `docs/deployment/firebase-readiness.md`, `deploy/oracle/nusa.service`, `deploy/cloudflare-tunnel/*`, `.aipos/decisions/ADR-0014-mobile-first-cloud-provider-required.md`.
- **User impact:** There is no verified backend for the required mobile-only product path.
- **Root cause:** Cloud provider and deployment authority were never approved.
- **Recommended correction:** Obtain explicit provider/deployment authority, then deploy/reuse the existing cloud contracts with health, persistence, secrets, recovery, observability, and rollback.
- **Regression gate:** External `/health`/`/ready`, persistence/recovery, secret-store, rollback, and exact-origin checks pass before mobile wiring.

### P0-003 — Android-only PAPER E2E is absent and currently blocked

- **Expected:** With the PC powered off: launch → PAPER state → PAPER action → portfolio/history → close/relaunch/recovery.
- **Actual:** Current endpoint-gated code and no deployed origin prevent this proof; no physical device evidence is available.
- **Evidence:** `WO-0054`, `docs/TRUSTED_HTTPS_BRIDGE.md`, mobile clients, AIPOS `HUMAN_ENVIRONMENT_ONLY` gate, and absence of `adb` in the audit environment.
- **User impact:** Core product promise is unverified and presently not reachable through the stated architecture.
- **Root cause:** P0-001 and P0-002.
- **Recommended correction:** Run the full PC-off test only after the canonical backend is healthy and the release endpoint is automatic.
- **Regression gate:** Timestamped device evidence covers every step and recovery, with no PC process.

### P0-004 — Published Android release artifact does not match its provenance

- **Expected:** A tester downloads an APK whose bytes, source SHA, bundle markers, release target, and provenance all identify the same build.
- **Actual:** Run 972 exact artifact is source `1adb7c6…`, SHA `0d58b920…`, and contains new Home markers. The persistent release asset is SHA `73844765…`, targets `ee0a8ef…`, contains old `NUSA ISLAND`, while its provenance claims run 972 and SHA `0d58b920…`.
- **Evidence:** GitHub run `31888787751`/#972 artifact `9248025038`; persistent release `nusa-android-preview`; `NUSA-Android.provenance.json`; extracted `assets/index.android.bundle`; verified SHA-256 values.
- **User impact:** Users can install an old UI while CI and provenance appear to describe a new UI; visual acceptance becomes impossible to trust.
- **Root cause:** A persistent clobbered release has no atomic source/hash/content verification and can reuse stale assets.
- **Recommended correction:** Publish immutable source-addressed artifacts, inject source/build identity, verify APK hash and bundle markers before publish, and reject mismatched release assets.
- **Regression gate:** CI fails on any source/provenance/APK/bundle-marker mismatch; installation/update proof uses the exact published SHA.

### P1-001 — Technical endpoint/token configuration leaks into product UX

- **Expected:** Ordinary users see connection state and retry, not URL, port, tunnel, or bearer infrastructure.
- **Actual:** Settings exposes `Cloud endpoint`, session token, save/verify controls, and bridge/PAPER setup copy.
- **Evidence:** `apps/mobile/src/settingsView.tsx`, `apps/mobile/src/settings.ts`; test IDs `settings-paper-endpoint`, `settings-paper-token`, `settings-paper-connect`.
- **User impact:** Product cannot be used without understanding infrastructure; endpoint mistakes become user support failures.
- **Root cause:** Manual bridge configuration is part of the current runtime contract.
- **Recommended correction:** Hide endpoint/token in production, provide a release-configured origin and product-level retry/status UX; keep operator diagnostics separate.
- **Regression gate:** Production UI has no endpoint/token/port controls and tests prove automatic canonical endpoint selection.

### P1-002 — Release identity and signing are not strong enough for reliable distribution

- **Expected:** Each release has meaningful version/build/source identity and production-appropriate signing.
- **Actual:** Workflow does not set `NUSA_BUILD_SHA`/`NUSA_BUILD_NUMBER`; Gradle defaults to `1.0.0-dev`/version code `1`; release uses `signingConfigs.debug`.
- **Evidence:** `apps/mobile/android/app/build.gradle`, `.github/workflows/android-persistent-release.yml`.
- **User impact:** Old and new APKs can look identical to testers; update behavior and artifact provenance are ambiguous.
- **Root cause:** Build identity is optional rather than enforced, and release signing is a development configuration.
- **Recommended correction:** Make source SHA/build number required inputs, fail if absent, use approved release signing, and publish immutable metadata.
- **Regression gate:** APK metadata, certificate fingerprint, source SHA, and artifact digest are checked in CI and release publication.

### P1-003 — Portfolio projection drops multi-position truth

- **Expected:** If the snapshot has multiple positions, the mobile contract represents them; aggregate-only data is not converted into a fabricated representative position.
- **Actual:** `buildReadOnlyPortfolio` selects one non-zero/first position and projects only `account.position`.
- **Evidence:** `apps/cloud/src/runtime.ts` lines 54–62; Issue #210 portfolio finding.
- **User impact:** Users can see an incomplete portfolio and misunderstand allocation/exposure.
- **Root cause:** The read-only projection contract is single-position shaped.
- **Recommended correction:** Extend the truthful read-only contract to preserve all positions, or explicitly render aggregate-only data without inventing detail.
- **Regression gate:** Multi-position fixture reaches mobile unchanged; aggregate fixture never creates a representative position.

### P1-004 — Visual acceptance is not established on current main

- **Expected:** Home follows the NUSA reference family with terrain/signal centerpiece, restrained status, strong financial hierarchy, and coherent visual language across screens.
- **Actual:** Current main retains the older Home composition; #535 markers are only on the held branch. No device screenshot or repository reference image proves conformity.
- **Evidence:** `apps/mobile/src/homeView.tsx` on `origin/main` vs `git show 1adb7c6:apps/mobile/src/homeView.tsx`; Issues #210/#349; PR #535 Draft/HOLD; static visual tests.
- **User impact:** A passing source test can still ship an old or visually unrelated screen.
- **Root cause:** Visual acceptance is coupled to source strings and artifact delivery rather than rendered/device evidence.
- **Recommended correction:** First fix artifact identity (P0-004), then perform the held Home visual gate on the exact installed APK; do not redesign unrelated screens in this audit.
- **Regression gate:** Before merge, exact APK install and before/after device screenshots meet the reference criteria.

### P1-005 — Tests provide false confidence for runtime and visual acceptance

- **Expected:** Required tests exercise the production transport/runtime and render or otherwise verify the acceptance surface.
- **Actual:** Several UI/bridge tests are source regex checks; full isolated suite history includes Windows symlink `EPERM`; no test proves deployed cloud or PC-off Android E2E.
- **Evidence:** `tests/mobile-uiux-visual-redesign.test.js`, `tests/mobile-uiux-min-path.test.js`, `tests/mobile-paper-real-use-ui.test.js`, `tests/trusted-https-bridge-contract.test.js`; PR #532/#535 validation notes.
- **User impact:** CI can be green while installed behavior is stale or unavailable.
- **Root cause:** Static contract coverage was treated as product acceptance.
- **Recommended correction:** Add exact artifact/provenance gates, deployed contract tests, and a real-device test lane; preserve source tests as unit checks.
- **Regression gate:** Required gate matrix explicitly distinguishes source, deployed, and device evidence; Windows environment blocker is resolved or visible.

### P1-006 — Authenticated read-only bridge has no deployment proof

- **Expected:** If authenticated read-only Upbit is product scope, its server-side bridge is reachable through the approved cloud path with health, secret binding, and recovery evidence.
- **Actual:** Source bridge exists and is GET-only, but binds loopback and has no approved deployed origin or external health evidence.
- **Evidence:** `services/upbit-readonly/server.js`, `apps/mobile/src/upbitLiveClient.ts`, PR #518 explicitly stating no production deployment.
- **User impact:** The feature is present in code but unavailable or operationally undefined for a mobile user.
- **Root cause:** Cloud deployment decision is unresolved.
- **Recommended correction:** Deploy only as part of the approved cloud architecture; keep credentials server-side and mutation surface absent.
- **Regression gate:** External read-only probes, secret scan, GET-only guard, and no-mutation capability guard pass.

### P1-007 — Current mobile navigation and operator surfaces remain product-incoherent

- **Expected:** User-facing IA is clear: Home, Markets, PAPER, Portfolio, AI; operator/technical settings are secondary and separated.
- **Actual:** `App.tsx` uses internal tabs `Home/Markets/Trade/Portfolio/More`, maps labels to PAPER/AI, and exposes technical connection controls in Settings.
- **Evidence:** `apps/mobile/src/App.tsx`, `settingsView.tsx`, Issue #210 IA finding.
- **User impact:** Users must infer product concepts from implementation-oriented labels and setup surfaces.
- **Root cause:** Compatibility with existing route/test contracts was prioritized over a stable product IA.
- **Recommended correction:** After endpoint architecture is fixed, simplify the visible IA without breaking internal contracts; isolate operator diagnostics.
- **Regression gate:** Screen-reader labels, deep links, tests, and visible IA agree; no duplicate endpoint CTA remains.

### P1-008 — AI confidence presentation can overstate certainty

- **Expected:** AI remains evidence-based and read-only; confidence/probability is shown only with clear calibration/evidence context.
- **Actual:** `aiView.tsx` surfaces calibrated confidence/raw probability and a MetricTile alongside thesis/evidence. No fabricated output was proven, but the visual hierarchy can be interpreted as a trading guarantee.
- **Evidence:** `apps/mobile/src/aiView.tsx`; AI contract evidence in `.aipos/evidence/WO-AI-010-completion.json`.
- **User impact:** Users may mistake advisory analysis for authority or certainty.
- **Root cause:** Evidence-bound fields are rendered in a compact dashboard without a tested comprehension gate.
- **Recommended correction:** Keep only supported qualitative/ calibrated values, attach evidence/state context, and remove unsupported probability display.
- **Regression gate:** AI UI tests assert zero authority, evidence provenance, and no action controls; human comprehension review remains required.

### P2-001 — Unwired loopback API client creates architectural ambiguity

- **Expected:** A single explicit production transport boundary exists.
- **Actual:** `apps/mobile/src/apiClient.ts` defaults to `127.0.0.1:41731` but is not instantiated by the current mobile source path.
- **Evidence:** `rg` call-site search and file source.
- **User impact:** Future wiring can silently reintroduce localhost dependency.
- **Root cause:** Legacy client remains after successor transport work.
- **Recommended correction:** Remove or mark DEV/TEST ONLY after consumers are confirmed absent.
- **Regression gate:** Production bundle/path scan rejects loopback defaults.

### P2-002 — Operator and connection concepts are duplicated across Settings/Home

- **Expected:** One compact operational state and one relevant action.
- **Actual:** Home repeats authority/readiness/safety information while Settings repeats connection/setup concepts.
- **Evidence:** `homeView.tsx`, `App.tsx`, `settingsView.tsx`.
- **User impact:** Cognitive load and unclear next action.
- **Root cause:** Safety copy and bridge setup were added incrementally.
- **Recommended correction:** Keep safety invariant internally; present one compact status and one product-level retry/setup state.
- **Regression gate:** Snapshot/visual test checks one primary CTA and no repeated endpoint/status blocks.

### P2-003 — Build identity is absent from the normal product diagnostic surface

- **Expected:** Support can identify source/build without exposing secrets or infrastructure.
- **Actual:** Settings hardcodes `NUSA Mobile 0.1.0`; no verified source/build surface exists.
- **Evidence:** `apps/mobile/src/settingsView.tsx`, `build.gradle`.
- **User impact:** Tester cannot distinguish stale APKs during acceptance.
- **Root cause:** Build metadata is not wired to a diagnostic surface.
- **Recommended correction:** Add non-secret source/build metadata only after release identity enforcement; do not put infrastructure URLs in user copy.
- **Regression gate:** Diagnostic build identity matches provenance and does not expose secrets.

### P3-001 — Residual token/card polish remains inconsistent

- **Expected:** Premium visual language is consistent after functional architecture is correct.
- **Actual:** Design tokens and surface hierarchy exist, but visual conformity is not render-proven and several screens retain card/status density.
- **Evidence:** `apps/mobile/src/designSystem.ts`, current Home/Markets/Chart source, absent device/reference evidence.
- **User impact:** Lower polish, not the core mobile availability blocker.
- **Root cause:** Visual passes preceded reliable artifact and device gates.
- **Recommended correction:** Address only after P0/P1 architecture, delivery, and truthful-data gates.
- **Regression gate:** Reference-based device screenshots and reduced-motion/accessibility checks.

## KEEP / FIX / DELETE / DEMOTE

- **KEEP:** Public Upbit quotation client; loopback cloud safety boundary; PAPER risk/state contracts; server-side read-only credential handling; fail-closed validation and redirect guards.
- **FIX:** Canonical mobile endpoint strategy after provider approval; Settings product UX; portfolio projection; release identity and immutable publication; deployed read-only bridge wiring.
- **DEMOTE TO DEV/DIAGNOSTIC:** Cloudflare/Quick Tunnel launcher, local bridge runbook, and loopback-only operator setup once an approved cloud path exists. Do not delete until developer workflows are migrated.
- **DO NOT DELETE AS A WORKAROUND:** PAPER safety checks, secret scanning, redirect validation, or mutation guards.

## Correction DAG

```text
P0-002 provider/deployment authority
  -> deploy existing cloud contracts with health, secrets, persistence, recovery
  -> P0-001 canonical release endpoint and production Settings separation
  -> P0-003 PC-off Android PAPER E2E
  -> P1-006 authenticated read-only bridge deployment proof
  -> P1-003 truthful multi-position portfolio contract
  -> P0-004 immutable artifact/provenance/release identity gate
  -> P1-004 exact installed Home visual acceptance
  -> #349/#391/#535 decisions only after their own evidence gates
```

Parallel, but not sufficient to unblock the DAG: static secret/mutation scans, artifact-marker verification, source-only contract tests, and reference-based emulator rendering. Provider choice and deployment authority are not to be inferred from existing recipes.

## Audit validation

Validation performed on the audit branch after writing this document:

- `git diff --check`: PASS
- `pnpm run aipos:drift`: PASS
- `pnpm run aipos:conformance`: PASS; canonical fingerprint `04bd456eaa744aac95a275464ed4fb58e0065af8c8c4ca0e3c41c91559ac6028`
- `pnpm run firebase:validate`: PASS
- `pnpm run deployment:check`: PASS
- focused mobile/bridge audit tests: **32/32 PASS**
- full isolated suite: not claimed PASS; historical repository evidence records Windows symlink privilege `EPERM` in `tests/backup-restore.test.js`

A green source check does not change the external blockers above. The reporting distinction is:

- repository contract: may PASS;
- deployed cloud: UNKNOWN/BLOCKED;
- exact published artifact: FAIL for the persistent release mismatch;
- physical Android acceptance: HUMAN_ENVIRONMENT_ONLY / not proven.

## Next single action

**Obtain explicit approval for one always-on cloud provider and deployment authority, including the canonical HTTPS origin and secret-management owner.**

Do not choose a provider, modify production code, change #535, or merge anything before that decision. This audit is complete at this stop condition.
