# Paper Trading Owner Review Packet

## 1. Executive summary

PR #1 provides an Electron Windows Upbit public-ticker Paper Trading runtime with durable SQLite state, deterministic recovery, scenario evidence, research validation, evidence export, bundle verification, and fail-closed controls.

This packet is a review aid. Creating it is not owner approval, does not change release status, and does not change the Draft state.

## 2. What this PR does

- Receives and validates public Upbit ticker data.
- Produces SMA strategy signals.
- Routes manual and automatic Paper commands through the control plane and runtime command service.
- Persists broker, orders, control state, processed signal keys, scenario events, research reports, and owner review records in SQLite.
- Records scenario evidence only through runtime or explicit verified fault drills.
- Replays events to derive counters and validates checksums and event identity.
- Exports and independently verifies an operator evidence bundle.
- Keeps live trading, private APIs, credentials, withdrawals, and automatic promotion out of scope.

## 3. Explicit non-goals

- No live order endpoint.
- No private Upbit API, API key, secret, JWT, withdrawal, deposit, or account-sync path.
- No profitability claim.
- No automatic Champion or release promotion.
- No renderer access to SQLite, Node.js, credentials, or broker objects.
- No CI or rehearsal event is operational evidence.

## 4. Architecture and production entry points

- Electron main: `apps/desktop/src/main.ts`
- Renderer bridge: `apps/desktop/src/preload.ts`
- Paper broker: `apps/desktop/src/paper/paperBroker.ts` (re-exported from `packages/core/src/paperBroker.ts`)
- Upbit public WebSocket: `apps/desktop/src/exchange/upbitWebSocket.ts`
- Runtime transaction boundary: `apps/desktop/src/runtimeCommandService.ts`
- Control plane: `apps/desktop/src/controlPlane.ts`
- SQLite persistence: `apps/desktop/src/desktopPersistenceStore.ts`
- Evidence reader/export: `apps/desktop/src/evidenceOperator.ts`
- Bundle/evaluator contracts: `apps/cloud/src/operatorEvidenceBundle.ts`, `apps/cloud/src/releaseEvidenceAuthority.ts`
- Operator commands: `scripts/evidence-cli.js`

## 5. Critical Paper order flow

1. Upbit public WebSocket receives ticker data.
2. Main process forwards the ticker to the strategy and runtime.
3. Control state and operational readiness gate automatic execution.
4. A signal key is claimed before automatic execution.
5. PaperBroker validates and simulates the order.
6. Runtime snapshots application state, persists account/control/order/evidence atomically, and publishes only after success.
7. On persistence failure, memory is restored, strategy stops, control becomes `FAULTED`, auto trading is disabled, and later commands are blocked.
8. Renderer receives projections only through constrained IPC.

Manual commands use the same persistence and rollback boundary. Failed signal claims and failed order writes are restored.

## 6. Startup and shutdown

Startup verifies SQLite safety pragmas, integrity, and migrations before the market stream starts. Existing state is restored only after validation; restored sessions force Paper auto trading OFF. Legacy import is explicit and idempotent. Startup persistence failure leaves the runtime unavailable and does not start the stream.

Shutdown stops the stream, clears dashboard state, and closes SQLite. No session-completion event is claimed because the current schema defines session observation, not session completion.

## 7. IPC security

Exposed commands are limited to Paper order, Paper snapshot, control snapshot, strategy start/stop, auto-trade toggle, and quantity update. Main-process handlers validate side, quantity, and boolean types. There is no raw SQL IPC, arbitrary evidence append IPC, arbitrary PASS IPC, fault injection IPC, credential IPC, or renderer broker access. `contextIsolation`, sandbox, and `nodeIntegration: false` remain enabled.

## 8. SQLite model

Migration IDs are versioned and checked by `packages/storage/src/migrationRunner.ts`. Desktop tables:

- `desktop_account_state`: singleton broker account state.
- `desktop_orders`: ordered Paper orders with unique IDs and ordinals.
- `desktop_control_state`: singleton control state.
- `desktop_control_events`: ordered control audit events.
- `desktop_processed_signal_keys`: idempotency keys.
- `desktop_paper_scenario_evidence`: contiguous append sequence and unique event IDs.
- `desktop_research_manifests`, `desktop_research_reports`: immutable target-linked research records.
- `desktop_owner_review_records`: checksummed owner review records.

SQLite uses foreign keys, WAL, synchronous FULL, busy timeout, quick check, transactional migrations, and rollback on failed writes. The operator reader opens the DB read-only and never runs migrations or writes.

## 9. Evidence model

Scenario types:

- `SESSION_OBSERVED`
- `ORDER_COMPLETED`
- `REGIME_OBSERVED`
- `RECOVERY_COMPLETED`
- `DUPLICATE_ORDER_CHECKED`
- `FAULT_SCENARIO_PASSED`

Fault PASS requires a verified runtime drill. A natural error alone is not a PASS. Test fixtures and rehearsal data use non-operational provenance and are excluded from production counters.

## 10. Research validation

Walk-Forward, Cost Stress, and Integrity reports carry target identity, dataset checksum, code version, deterministic configuration, and result checksum. Reports outside the requested target are ignored or block evaluation. A failed or missing report cannot be promoted to PASS.

## 11. Operator commands

```text
pnpm evidence:status
pnpm evidence:status --db <absolute-db-path>
pnpm evidence:export --db <absolute-db-path> --output <absolute-output> --code-version <sha> --strategy-id <id> --strategy-version <version> --dataset-id <id> --dataset-checksum <sha256>
pnpm evidence:verify --bundle <absolute-bundle-path>
pnpm evidence:rehearse
```

Status reports `not evaluated` if the actual DB is unavailable. Export requires an exact target and uses exclusive output creation. Verify validates bundle checksum, replay counters, and event chain.

## 12. Current actual evidence status

- Actual user Paper evidence DB: **not evaluated**
- Real Paper observation counts: **not evaluated**
- Actual research reports: **not evaluated**
- Actual evidence bundle: **not evaluated**
- Owner review: **not completed**
- Release status: **BLOCKED**

CI success is not operational evidence.

## 13. Tests and CI

Windows CI #1182 passed:

- frozen lockfile install
- TypeScript typecheck
- build
- persistence atomicity suites
- control, evidence, research, IPC, security, and readiness suites
- full isolated suite: 107 test files

The rehearsal and CLI tests validate contracts and isolation; they do not increment operational counters.

## 14. Known limitations

- No real operational Paper evidence has been reviewed in this task.
- No live trading readiness is asserted.
- SQLite is a local single-user Paper backend, not a multi-process production database.
- Research acceptance still requires real target-linked reports and owner review.
- The strategy is a deterministic pipeline fixture, not an investment performance claim.
- Database backup, retention, and restore are operator responsibilities.

## 15. Blocking reasons

- Real Paper sessions/orders/regime/recovery/duplicate evidence not evaluated.
- Required fault drills not verified against an actual operational database.
- Research reports for the exact target not evaluated.
- Independent bundle review not completed.
- Owner review not completed.

## 16. Owner verification steps

- [ ] Keep PR Draft while evidence is incomplete.
- [ ] Confirm Paper mode and absence of private API/credentials.
- [ ] Make a verified DB backup.
- [ ] Run real Paper observations and inspect status counters.
- [ ] Run approved fault drills with evidence DB preservation.
- [ ] Persist and independently verify the exact research reports.
- [ ] Export and verify the exact target bundle.
- [ ] Review blocking reasons and database identity.
- [ ] Decide whether to request changes, split follow-up work, or keep collecting evidence.
- [ ] Only the owner decides whether the PR may leave Draft.

## 17. Rollback plan

Stop the runtime, preserve the failed DB unchanged, restore a verified backup, restart with auto trading OFF, run SQLite integrity checks, inspect account/order/control/audit state, and record an incident report. Do not auto-repair or overwrite a failed evidence database.

## 18. Final decision

Recommended decision: **Keep Draft and collect real Paper evidence**.

Release readiness remains **BLOCKED pending real operational evidence and owner review**.
