/**
 * REAL_READ_ONLY observability contract (issue #661).
 *
 * This is an observation surface over the account a real broker credential can *read*. It is
 * deliberately shaped so that no consumer can mistake it for PAPER accounting or for LIVE
 * capability:
 *
 *  - Every monetary field is `number | null`. A value that was not actually observed is `null`,
 *    never `0` -- a fake zero balance is indistinguishable from a real empty account, and that
 *    ambiguity is exactly what makes an observability surface dangerous to act on.
 *  - Field names are REAL-specific (`observedCashKrw`, `observedAssets`). Nothing here is named
 *    `equity` or `pnl`, so a REAL snapshot cannot be summed into or substituted for the PAPER
 *    ledger by field-name coincidence.
 *  - No order identity is carried, only counts. Reconciliation drift is expressed as changed
 *    currency codes and an open-order delta, which is what the canonical
 *    upbitReadOnlyReconciliation already produces.
 *  - Account identity is a masked hint only, re-validated here rather than trusted from upstream.
 *
 * Mirrors shadowObservabilityReadOnly.ts intentionally: same authority invariants, same recursive
 * forbidden-key sweep, same bounded-event discipline, same validate-and-freeze return.
 */
export type RealReadOnlyRuntimeStatus = "HEALTHY" | "DEGRADED" | "ERROR" | "OFFLINE" | "NOT_CONFIGURED";

/**
 * Exactly the canonical UpbitReadOnlyResultCode set from
 * apps/desktop/src/exchange/upbitReadOnlyService.ts. Kept as a literal union rather than an
 * import so the wire contract does not depend on a desktop module, but a test asserts the two
 * stay identical -- a code the service can emit but this contract cannot express would silently
 * degrade to something vaguer on the way to the operator.
 */
export type RealReadOnlyConnectionCode =
  | "CONNECTED"
  | "NOT_CONFIGURED"
  | "CLOCK_UNSAFE"
  | "INVALID_CREDENTIALS"
  | "IP_NOT_ALLOWED"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "PROVIDER_ERROR";

/** Canonical statuses from upbitReadOnlyReconciliation. */
export type RealReadOnlyReconciliationStatus = "MATCH" | "DIFF" | "UNKNOWN";

export type RealReadOnlyFreshness = "FRESH" | "STALE" | "UNKNOWN";

export type RealReadOnlyEventType =
  | "CONNECTION_ESTABLISHED"
  | "CONNECTION_LOST"
  | "AUTH_FAILURE"
  | "AUTH_RECOVERED"
  | "ACCOUNT_REFRESH"
  | "ACCOUNT_SNAPSHOT_STALE"
  | "RECONCILIATION_MATCH"
  | "RECONCILIATION_MISMATCH"
  | "BALANCE_DRIFT"
  | "MALFORMED_BROKER_RESPONSE"
  | "RELAY_FAILURE"
  | "CREDENTIAL_READINESS_REGRESSION"
  | "RECOVERED";

export type RealReadOnlyAlertCode =
  | "ACCOUNT_DATA_STALE"
  | "BROKER_DISCONNECTED"
  | "AUTH_FAILURE"
  | "RECONCILIATION_MISMATCH"
  | "BALANCE_DRIFT"
  | "RELAY_FAILURE"
  | "CREDENTIAL_READINESS_REGRESSION";

export type RealReadOnlyAlertSeverity = "INFO" | "WARNING" | "CRITICAL";

export interface RealReadOnlyEvent {
  readonly id: string;
  readonly sequence: number;
  readonly mode: "REAL_READ_ONLY";
  readonly eventType: RealReadOnlyEventType;
  readonly occurredAt: number;
  /** Safe, already-redacted operator text. Never a raw broker response or header. */
  readonly reason: string;
  readonly reasonCodes: readonly string[];
}

export interface RealReadOnlyAlert {
  readonly code: RealReadOnlyAlertCode;
  readonly severity: RealReadOnlyAlertSeverity;
  readonly raisedAt: number;
  readonly reason: string;
}

export interface RealReadOnlyAsset {
  readonly currency: string;
  /** null means "not observed", never "zero balance". */
  readonly available: number | null;
  readonly locked: number | null;
  readonly avgBuyPrice: number | null;
  readonly unitCurrency: string;
}

export interface RealReadOnlyAccountSnapshot {
  /** Masked credential hint from the canonical credential provider. Never a raw key or UUID. */
  readonly maskedAccountReference: string | null;
  readonly observedAt: number | null;
  readonly observedCashKrw: number | null;
  readonly observedLockedKrw: number | null;
  readonly observedAssets: readonly RealReadOnlyAsset[];
  readonly openOrderCount: number | null;
}

export interface RealReadOnlyReconciliation {
  readonly status: RealReadOnlyReconciliationStatus;
  readonly observedAt: number | null;
  readonly reason: string;
  readonly changedCurrencies: readonly string[];
  readonly openOrderDifferenceCount: number | null;
}

export interface RealReadOnlyCredentialReadiness {
  readonly configured: boolean;
  readonly provider: string | null;
  /**
   * Named "credential hint" rather than anything containing "accessKey" on purpose: the recursive
   * FORBIDDEN_KEY sweep below matches access[_-]?key, so a field carrying even the *masked* hint
   * under that name is rejected by this contract's own redaction guard. Keeping the sweep strict
   * and renaming the field is the safe direction -- adding an allowlist hole to admit one field
   * would weaken the guard for every field added after it.
   */
  readonly maskedCredentialHint: string | null;
}

export interface RealReadOnlyObservabilitySnapshot {
  readonly schemaVersion: 1;
  readonly mode: "REAL_READ_ONLY";
  readonly readOnly: true;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
  readonly runtimeStatus: RealReadOnlyRuntimeStatus;
  readonly generatedAt: number;
  readonly connection: Readonly<{
    readonly code: RealReadOnlyConnectionCode;
    readonly connected: boolean;
    readonly lastSuccessfulRefreshAt: number | null;
    readonly lastErrorAt: number | null;
    /** Already redacted upstream; re-swept here for forbidden content. */
    readonly lastErrorReason: string | null;
  }>;
  readonly freshness: RealReadOnlyFreshness;
  readonly account: RealReadOnlyAccountSnapshot;
  readonly reconciliation: RealReadOnlyReconciliation;
  readonly credentialReadiness: RealReadOnlyCredentialReadiness;
  readonly blockers: readonly string[];
  readonly alerts: readonly RealReadOnlyAlert[];
  readonly events: readonly RealReadOnlyEvent[];
  /** Proof-of-observation counters. Any non-zero mutation counter is a contract violation. */
  readonly counters: Readonly<{
    readonly refreshCount: number;
    readonly errorCount: number;
    readonly reconciliationCount: number;
    readonly orderMutationCount: 0;
    readonly withdrawalCount: 0;
    readonly transferCount: 0;
    readonly cashMutationCount: 0;
    readonly positionMutationCount: 0;
  }>;
}

export function validateRealReadOnlyEvent(event: RealReadOnlyEvent): RealReadOnlyEvent {
  if (event.mode !== "REAL_READ_ONLY" || typeof event.id !== "string" || !event.id.trim()) throw new Error("invalid REAL_READ_ONLY event identity");
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) throw new Error("invalid REAL_READ_ONLY event sequence");
  if (!Number.isFinite(event.occurredAt) || event.occurredAt < 0) throw new Error("invalid REAL_READ_ONLY event timestamp");
  if (!EVENT_TYPES.has(event.eventType)) throw new Error("invalid REAL_READ_ONLY event type");
  safeText(event.reason, "event.reason");
  if (!Array.isArray(event.reasonCodes) || event.reasonCodes.some((reason) => typeof reason !== "string" || !reason.trim() || FORBIDDEN_VALUE.test(reason))) throw new Error("REAL_READ_ONLY reason codes are invalid");
  assertSafeObject(event);
  return Object.freeze(structuredClone(event));
}

const MAX_EVENTS = 500;
const MAX_ALERTS = 64;
const MAX_ASSETS = 256;
/**
 * Deliberately at least as strict as the SHADOW sweep. `uuid`, `nonce` and `signature` are added
 * because a real broker response carries order UUIDs and request-signing material that SHADOW
 * never sees.
 */
const FORBIDDEN_KEY = /(authorization|bearer|token|secret|password|api[_-]?key|access[_-]?key|private[_-]?key|signature|cookie|jwt|nonce|uuid|account[_-]?id|order[_-]?id|fill[_-]?id)/i;
/** Values that must never appear even under an innocuous key name. */
const FORBIDDEN_VALUE = /(bearer\s|eyJ[A-Za-z0-9_-]{8,}|-----BEGIN)/i;

const RUNTIME_STATUSES = new Set<RealReadOnlyRuntimeStatus>(["HEALTHY", "DEGRADED", "ERROR", "OFFLINE", "NOT_CONFIGURED"]);
const CONNECTION_CODES = new Set<RealReadOnlyConnectionCode>(["CONNECTED", "NOT_CONFIGURED", "CLOCK_UNSAFE", "INVALID_CREDENTIALS", "IP_NOT_ALLOWED", "NETWORK_ERROR", "TIMEOUT", "PROVIDER_ERROR"]);
const RECONCILIATION_STATUSES = new Set<RealReadOnlyReconciliationStatus>(["MATCH", "DIFF", "UNKNOWN"]);
const FRESHNESS = new Set<RealReadOnlyFreshness>(["FRESH", "STALE", "UNKNOWN"]);
const EVENT_TYPES = new Set<RealReadOnlyEventType>(["CONNECTION_ESTABLISHED", "CONNECTION_LOST", "AUTH_FAILURE", "AUTH_RECOVERED", "ACCOUNT_REFRESH", "ACCOUNT_SNAPSHOT_STALE", "RECONCILIATION_MATCH", "RECONCILIATION_MISMATCH", "BALANCE_DRIFT", "MALFORMED_BROKER_RESPONSE", "RELAY_FAILURE", "CREDENTIAL_READINESS_REGRESSION", "RECOVERED"]);
const ALERT_CODES = new Set<RealReadOnlyAlertCode>(["ACCOUNT_DATA_STALE", "BROKER_DISCONNECTED", "AUTH_FAILURE", "RECONCILIATION_MISMATCH", "BALANCE_DRIFT", "RELAY_FAILURE", "CREDENTIAL_READINESS_REGRESSION"]);
const ALERT_SEVERITIES = new Set<RealReadOnlyAlertSeverity>(["INFO", "WARNING", "CRITICAL"]);
/** A masked hint may only be a short prefix/suffix around a mask, never a whole key. */
const MASKED_HINT = /^[A-Za-z0-9]{0,8}\*{2,}[A-Za-z0-9]{0,8}$/;

function finite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function optionalFinite(value: number | null, name: string): void {
  if (value != null) finite(value, name);
}

function nonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`);
}

function optionalNonNegativeInteger(value: number | null, name: string): void {
  if (value != null) nonNegativeInteger(value, name);
}

function safeText(value: string | null, name: string): void {
  if (value == null) return;
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  if (value.length > 400) throw new Error(`${name} exceeds the safe operator-text bound`);
  if (FORBIDDEN_VALUE.test(value)) throw new Error(`${name} contains prohibited credential material`);
}

function assertSafeObject(value: unknown, path = "real"): void {
  if (value == null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY.test(key)) throw new Error(`${path}.${key} is prohibited in REAL_READ_ONLY observability`);
    if (typeof child === "string" && FORBIDDEN_VALUE.test(child)) throw new Error(`${path}.${key} contains prohibited credential material`);
    assertSafeObject(child, `${path}.${key}`);
  }
}

export function validateRealReadOnlyObservabilitySnapshot(
  snapshot: RealReadOnlyObservabilitySnapshot,
  maximumEvents = MAX_EVENTS
): RealReadOnlyObservabilitySnapshot {
  if (snapshot.schemaVersion !== 1 || snapshot.mode !== "REAL_READ_ONLY" || snapshot.readOnly !== true || snapshot.liveAuthority !== "NONE" || snapshot.productionMutationAllowed !== false || snapshot.aiAuthority !== "ZERO_AUTHORITY") throw new Error("REAL_READ_ONLY authority invariant violated");
  if (!RUNTIME_STATUSES.has(snapshot.runtimeStatus)) throw new Error("invalid REAL_READ_ONLY runtime status");
  if (!Number.isSafeInteger(maximumEvents) || maximumEvents < 1 || maximumEvents > MAX_EVENTS) throw new Error("invalid REAL_READ_ONLY observability limit");
  finite(snapshot.generatedAt, "generatedAt");

  const connection = snapshot.connection;
  if (!CONNECTION_CODES.has(connection.code)) throw new Error("invalid REAL_READ_ONLY connection code");
  if (typeof connection.connected !== "boolean") throw new Error("REAL_READ_ONLY connected flag must be boolean");
  if (connection.connected !== (connection.code === "CONNECTED")) throw new Error("REAL_READ_ONLY connected flag contradicts its connection code");
  optionalFinite(connection.lastSuccessfulRefreshAt, "connection.lastSuccessfulRefreshAt");
  optionalFinite(connection.lastErrorAt, "connection.lastErrorAt");
  safeText(connection.lastErrorReason, "connection.lastErrorReason");

  if (!FRESHNESS.has(snapshot.freshness)) throw new Error("invalid REAL_READ_ONLY freshness");

  const account = snapshot.account;
  if (account.maskedAccountReference != null && !MASKED_HINT.test(account.maskedAccountReference)) throw new Error("REAL_READ_ONLY account reference must be masked");
  optionalFinite(account.observedAt, "account.observedAt");
  optionalFinite(account.observedCashKrw, "account.observedCashKrw");
  optionalFinite(account.observedLockedKrw, "account.observedLockedKrw");
  optionalNonNegativeInteger(account.openOrderCount, "account.openOrderCount");
  if (account.observedAssets.length > MAX_ASSETS) throw new Error("REAL_READ_ONLY asset bound exceeded");
  const currencies = new Set<string>();
  for (const asset of account.observedAssets) {
    if (!asset.currency.trim() || !asset.unitCurrency.trim()) throw new Error("REAL_READ_ONLY asset identity is invalid");
    if (currencies.has(asset.currency)) throw new Error("duplicate REAL_READ_ONLY asset currency");
    currencies.add(asset.currency);
    optionalFinite(asset.available, `asset.${asset.currency}.available`);
    optionalFinite(asset.locked, `asset.${asset.currency}.locked`);
    optionalFinite(asset.avgBuyPrice, `asset.${asset.currency}.avgBuyPrice`);
  }

  const reconciliation = snapshot.reconciliation;
  if (!RECONCILIATION_STATUSES.has(reconciliation.status)) throw new Error("invalid REAL_READ_ONLY reconciliation status");
  optionalFinite(reconciliation.observedAt, "reconciliation.observedAt");
  safeText(reconciliation.reason, "reconciliation.reason");
  if (!Array.isArray(reconciliation.changedCurrencies) || reconciliation.changedCurrencies.some((value) => typeof value !== "string" || !value.trim())) throw new Error("REAL_READ_ONLY changed currencies are invalid");
  if (reconciliation.openOrderDifferenceCount != null) finite(reconciliation.openOrderDifferenceCount, "reconciliation.openOrderDifferenceCount");

  const credentialReadiness = snapshot.credentialReadiness;
  if (typeof credentialReadiness.configured !== "boolean") throw new Error("REAL_READ_ONLY credential readiness is invalid");
  if (credentialReadiness.maskedCredentialHint != null && !MASKED_HINT.test(credentialReadiness.maskedCredentialHint)) throw new Error("REAL_READ_ONLY credential hint must be masked");

  if (!Array.isArray(snapshot.blockers) || snapshot.blockers.some((value) => typeof value !== "string" || !value.trim() || FORBIDDEN_VALUE.test(value))) throw new Error("REAL_READ_ONLY blockers are invalid");

  if (snapshot.alerts.length > MAX_ALERTS) throw new Error("REAL_READ_ONLY alert bound exceeded");
  for (const alert of snapshot.alerts) {
    if (!ALERT_CODES.has(alert.code) || !ALERT_SEVERITIES.has(alert.severity)) throw new Error("invalid REAL_READ_ONLY alert");
    finite(alert.raisedAt, "alert.raisedAt");
    safeText(alert.reason, "alert.reason");
  }

  if (snapshot.events.length > maximumEvents) throw new Error("REAL_READ_ONLY event bound exceeded");
  const ids = new Set<string>();
  let previousSequence = 0;
  for (const event of snapshot.events) {
    if (event.mode !== "REAL_READ_ONLY") throw new Error("REAL_READ_ONLY event mode is invalid");
    if (ids.has(event.id)) throw new Error("duplicate REAL_READ_ONLY event id");
    ids.add(event.id);
    if (!Number.isSafeInteger(event.sequence) || event.sequence <= previousSequence) throw new Error("REAL_READ_ONLY event sequence is not deterministic");
    previousSequence = event.sequence;
    if (!event.id.trim()) throw new Error("REAL_READ_ONLY event identity is invalid");
    finite(event.occurredAt, "event.occurredAt");
    if (!EVENT_TYPES.has(event.eventType)) throw new Error("REAL_READ_ONLY event type is invalid");
    safeText(event.reason, "event.reason");
    if (!Array.isArray(event.reasonCodes) || event.reasonCodes.some((reason) => typeof reason !== "string" || !reason.trim() || FORBIDDEN_VALUE.test(reason))) throw new Error("REAL_READ_ONLY reason codes are invalid");
  }

  for (const [name, value] of Object.entries(snapshot.counters)) nonNegativeInteger(value as number, `counters.${name}`);
  // The whole point of this surface: observing a real account must never have moved anything.
  for (const name of ["orderMutationCount", "withdrawalCount", "transferCount", "cashMutationCount", "positionMutationCount"] as const) {
    if (snapshot.counters[name] !== 0) throw new Error(`REAL_READ_ONLY mutation invariant violated: ${name}`);
  }

  assertSafeObject(snapshot);
  return Object.freeze(structuredClone(snapshot));
}
