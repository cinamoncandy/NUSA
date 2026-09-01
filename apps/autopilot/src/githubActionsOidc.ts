const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_OIDC_JWKS = `${GITHUB_OIDC_ISSUER}/.well-known/jwks`;
const DEFAULT_AUDIENCE = "nusa-autopilot";
const CLOCK_SKEW_SECONDS = 60;
const CODING_RUNNER_WORKFLOW = ".github/workflows/autopilot-execution-consumer.yml";
const EVENT_BRIDGE_WORKFLOW = ".github/workflows/autopilot-github-event-bridge.yml";
const EVENT_BRIDGE_EVENTS = new Set(["push", "pull_request_target", "workflow_run"]);

interface JsonResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

type FetchImpl = (input: string, init?: RequestInit) => Promise<JsonResponse>;

interface JwtHeader {
  readonly alg?: unknown;
  readonly kid?: unknown;
  readonly typ?: unknown;
}

interface JwtClaims {
  readonly iss?: unknown;
  readonly aud?: unknown;
  readonly exp?: unknown;
  readonly nbf?: unknown;
  readonly iat?: unknown;
  readonly repository?: unknown;
  readonly repository_id?: unknown;
  readonly ref?: unknown;
  readonly event_name?: unknown;
  readonly workflow_ref?: unknown;
}

interface JsonWebKeySet {
  readonly keys?: unknown;
}

interface OidcPolicy {
  readonly errorPrefix: "CODING_RUNNER_OIDC" | "EVENT_BRIDGE_OIDC";
  readonly workflowPath: string;
  readonly requireMainRef: boolean;
  readonly allowedEvents: ReadonlySet<string>;
}

const CODING_RUNNER_POLICY: OidcPolicy = Object.freeze({
  errorPrefix: "CODING_RUNNER_OIDC",
  workflowPath: CODING_RUNNER_WORKFLOW,
  requireMainRef: true,
  allowedEvents: new Set(["repository_dispatch"]),
});

const EVENT_BRIDGE_POLICY: OidcPolicy = Object.freeze({
  errorPrefix: "EVENT_BRIDGE_OIDC",
  workflowPath: EVENT_BRIDGE_WORKFLOW,
  requireMainRef: false,
  allowedEvents: EVENT_BRIDGE_EVENTS,
});

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function decodeJson<T>(value: string, error: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T;
  } catch {
    throw new Error(error);
  }
}

function audienceIncludes(value: unknown, expected: string): boolean {
  if (typeof value === "string") return value === expected;
  return Array.isArray(value) && value.some((item) => item === expected);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function fail(policy: OidcPolicy, suffix: string): never {
  throw new Error(`${policy.errorPrefix}_${suffix}`);
}

function assertClaims(
  claims: JwtClaims,
  allowedRepository: string,
  nowSeconds: number,
  audience: string,
  policy: OidcPolicy,
): void {
  if (claims.iss !== GITHUB_OIDC_ISSUER) fail(policy, "ISSUER_INVALID");
  if (!audienceIncludes(claims.aud, audience)) fail(policy, "AUDIENCE_INVALID");

  const exp = finiteNumber(claims.exp);
  const nbf = finiteNumber(claims.nbf);
  const iat = finiteNumber(claims.iat);
  if (exp === null || exp < nowSeconds - CLOCK_SKEW_SECONDS) fail(policy, "EXPIRED");
  if (nbf !== null && nbf > nowSeconds + CLOCK_SKEW_SECONDS) fail(policy, "NOT_YET_VALID");
  if (iat === null || iat > nowSeconds + CLOCK_SKEW_SECONDS || iat < nowSeconds - 600) fail(policy, "ISSUED_AT_INVALID");

  if (claims.repository !== allowedRepository) fail(policy, "REPOSITORY_INVALID");
  if (policy.requireMainRef && claims.ref !== "refs/heads/main") fail(policy, "REF_INVALID");
  if (typeof claims.event_name !== "string" || !policy.allowedEvents.has(claims.event_name)) fail(policy, "EVENT_INVALID");
  const trustedWorkflowRef = `${allowedRepository}/${policy.workflowPath}@refs/heads/main`;
  if (claims.workflow_ref !== trustedWorkflowRef) fail(policy, "WORKFLOW_INVALID");
}

async function verifyWithPolicy(
  token: string,
  allowedRepository: string,
  policy: OidcPolicy,
  fetchImpl: FetchImpl,
  nowSeconds: number,
  audience: string,
): Promise<void> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) fail(policy, "TOKEN_INVALID");
  const [encodedHeader, encodedClaims, encodedSignature] = parts;
  const header = decodeJson<JwtHeader>(encodedHeader!, `${policy.errorPrefix}_HEADER_INVALID`);
  const claims = decodeJson<JwtClaims>(encodedClaims!, `${policy.errorPrefix}_CLAIMS_INVALID`);
  if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) fail(policy, "HEADER_INVALID");

  const jwksResponse = await fetchImpl(GITHUB_OIDC_JWKS, { headers: { accept: "application/json" } });
  if (!jwksResponse.ok) throw new Error(`${policy.errorPrefix}_JWKS_HTTP_${jwksResponse.status}`);
  const payload = object(await jwksResponse.json()) as JsonWebKeySet | null;
  const keys = Array.isArray(payload?.keys) ? payload.keys : [];
  const jwk = keys.map(object).find((key) => key?.kid === header.kid && key?.kty === "RSA");
  if (!jwk) fail(policy, "KEY_NOT_FOUND");

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "jwk",
      jwk as JsonWebKey,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
  } catch {
    fail(policy, "KEY_INVALID");
  }

  const signed = toArrayBuffer(new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`));
  const signature = toArrayBuffer(decodeBase64Url(encodedSignature!));
  const verified = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signed);
  if (!verified) fail(policy, "SIGNATURE_INVALID");
  assertClaims(claims, allowedRepository, nowSeconds, audience, policy);
}

export async function verifyGithubActionsOidcToken(
  token: string,
  allowedRepository: string,
  fetchImpl: FetchImpl = fetch as unknown as FetchImpl,
  nowSeconds = Math.floor(Date.now() / 1000),
  audience = DEFAULT_AUDIENCE,
): Promise<void> {
  return verifyWithPolicy(token, allowedRepository, CODING_RUNNER_POLICY, fetchImpl, nowSeconds, audience);
}

export async function verifyGithubEventBridgeOidcToken(
  token: string,
  allowedRepository: string,
  fetchImpl: FetchImpl = fetch as unknown as FetchImpl,
  nowSeconds = Math.floor(Date.now() / 1000),
  audience = DEFAULT_AUDIENCE,
): Promise<void> {
  return verifyWithPolicy(token, allowedRepository, EVENT_BRIDGE_POLICY, fetchImpl, nowSeconds, audience);
}
