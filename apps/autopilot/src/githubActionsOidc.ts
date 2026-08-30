const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_OIDC_JWKS = `${GITHUB_OIDC_ISSUER}/.well-known/jwks`;
const DEFAULT_AUDIENCE = "nusa-autopilot";
const CLOCK_SKEW_SECONDS = 60;

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

function assertClaims(
  claims: JwtClaims,
  allowedRepository: string,
  nowSeconds: number,
  audience: string,
): void {
  if (claims.iss !== GITHUB_OIDC_ISSUER) throw new Error("CODING_RUNNER_OIDC_ISSUER_INVALID");
  if (!audienceIncludes(claims.aud, audience)) throw new Error("CODING_RUNNER_OIDC_AUDIENCE_INVALID");

  const exp = finiteNumber(claims.exp);
  const nbf = finiteNumber(claims.nbf);
  const iat = finiteNumber(claims.iat);
  if (exp === null || exp < nowSeconds - CLOCK_SKEW_SECONDS) throw new Error("CODING_RUNNER_OIDC_EXPIRED");
  if (nbf !== null && nbf > nowSeconds + CLOCK_SKEW_SECONDS) throw new Error("CODING_RUNNER_OIDC_NOT_YET_VALID");
  if (iat === null || iat > nowSeconds + CLOCK_SKEW_SECONDS || iat < nowSeconds - 600) throw new Error("CODING_RUNNER_OIDC_ISSUED_AT_INVALID");

  if (claims.repository !== allowedRepository) throw new Error("CODING_RUNNER_OIDC_REPOSITORY_INVALID");
  if (claims.ref !== "refs/heads/main") throw new Error("CODING_RUNNER_OIDC_REF_INVALID");
  if (claims.event_name !== "repository_dispatch") throw new Error("CODING_RUNNER_OIDC_EVENT_INVALID");
  const expectedWorkflowRef = `${allowedRepository}/.github/workflows/autopilot-execution-consumer.yml@refs/heads/main`;
  if (claims.workflow_ref !== expectedWorkflowRef) throw new Error("CODING_RUNNER_OIDC_WORKFLOW_INVALID");
}

export async function verifyGithubActionsOidcToken(
  token: string,
  allowedRepository: string,
  fetchImpl: FetchImpl = fetch as unknown as FetchImpl,
  nowSeconds = Math.floor(Date.now() / 1000),
  audience = DEFAULT_AUDIENCE,
): Promise<void> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) throw new Error("CODING_RUNNER_OIDC_TOKEN_INVALID");
  const [encodedHeader, encodedClaims, encodedSignature] = parts;
  const header = decodeJson<JwtHeader>(encodedHeader!, "CODING_RUNNER_OIDC_HEADER_INVALID");
  const claims = decodeJson<JwtClaims>(encodedClaims!, "CODING_RUNNER_OIDC_CLAIMS_INVALID");
  if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) throw new Error("CODING_RUNNER_OIDC_HEADER_INVALID");

  const jwksResponse = await fetchImpl(GITHUB_OIDC_JWKS, { headers: { accept: "application/json" } });
  if (!jwksResponse.ok) throw new Error(`CODING_RUNNER_OIDC_JWKS_HTTP_${jwksResponse.status}`);
  const payload = object(await jwksResponse.json()) as JsonWebKeySet | null;
  const keys = Array.isArray(payload?.keys) ? payload.keys : [];
  const jwk = keys.map(object).find((key) => key?.kid === header.kid && key?.kty === "RSA");
  if (!jwk) throw new Error("CODING_RUNNER_OIDC_KEY_NOT_FOUND");

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
    throw new Error("CODING_RUNNER_OIDC_KEY_INVALID");
  }

  const signed = toArrayBuffer(new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`));
  const signature = toArrayBuffer(decodeBase64Url(encodedSignature!));
  const verified = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signed);
  if (!verified) throw new Error("CODING_RUNNER_OIDC_SIGNATURE_INVALID");
  assertClaims(claims, allowedRepository, nowSeconds, audience);
}
