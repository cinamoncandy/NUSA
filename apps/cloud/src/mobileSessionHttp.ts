import { createHash, timingSafeEqual } from "node:crypto";
import {
  dashboardJsonResponse,
  type DashboardHttpRequest,
  type DashboardHttpResponse,
  type DashboardPrincipal,
  type DashboardTokenVerifier
} from "./mobileDashboardHttp";
import type { NusaUserAccessRepository } from "./operatorUserAccess";
import { isUserAllowed } from "./operatorUserAccess";
import type { MobileSessionService } from "./mobileSessionService";
import type { OwnerDeviceCredentialService } from "./ownerCredential/ownerDeviceCredentialService";

export interface MobileSessionHttpDependencies {
  readonly sessionService: MobileSessionService;
  readonly ownerDeviceCredentialService?: OwnerDeviceCredentialService;
  readonly legacyTokenVerifier: DashboardTokenVerifier;
  readonly userAccessRepository: NusaUserAccessRepository;
}

const ownerDeviceInput = (input: Record<string, unknown> | undefined): Readonly<{ credentialId: string; deviceId: string }> | undefined => {
  const credentialId = typeof input?.credentialId === "string" ? input.credentialId.trim() : "";
  const deviceId = typeof input?.deviceId === "string" ? input.deviceId.trim() : "";
  return credentialId && deviceId ? Object.freeze({ credentialId, deviceId }) : undefined;
};

export const MOBILE_ENROLLMENT_TOKEN_SHA256_ENV = "NUSA_MOBILE_ENROLLMENT_TOKEN_SHA256";
const SHA256_HEX = /^[a-f0-9]{64}$/;

const bearer = (value: string | undefined): string | undefined => /^Bearer\s+([^\s]+)$/i.exec(value?.trim() ?? "")?.[1];

/**
 * Optional migration boundary for a high-entropy credential that already exists on a mobile
 * device. Only its SHA-256 fingerprint is configured on Cloud. A match is accepted solely by
 * the first-run mobile enrollment route and is immediately exchanged for the normal rotating
 * PAPER-only mobile session. It never becomes a general dashboard bearer and grants no LIVE,
 * withdrawal, transfer, or production-mutation authority.
 */
export function matchesMobileEnrollmentTokenHash(token: string, configuredHash: string | undefined = process.env[MOBILE_ENROLLMENT_TOKEN_SHA256_ENV]): boolean {
  const expected = configuredHash?.trim().toLowerCase() ?? "";
  if (!SHA256_HEX.test(expected) || !token) return false;
  const actual = createHash("sha256").update(token, "utf8").digest();
  const expectedBytes = Buffer.from(expected, "hex");
  return actual.length === expectedBytes.length && timingSafeEqual(actual, expectedBytes);
}

function jsonObject(body: string | undefined): Record<string, unknown> | undefined {
  if (body == null) return undefined;
  try {
    const value = JSON.parse(body) as unknown;
    return value != null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

function methodOnly(request: DashboardHttpRequest, method: "GET" | "POST"): DashboardHttpResponse | undefined {
  if (request.method.toUpperCase() === method) return undefined;
  const response = dashboardJsonResponse(405, { error: "METHOD_NOT_ALLOWED" });
  return Object.freeze({ ...response, headers: Object.freeze({ ...response.headers, allow: method }) });
}

function authorizeOwner(request: DashboardHttpRequest, dependencies: MobileSessionHttpDependencies): DashboardPrincipal | undefined {
  const token = bearer(request.headers.authorization ?? request.headers.Authorization);
  if (token == null) return undefined;
  const principal = dependencies.sessionService.verifyAccess(token) ?? dependencies.legacyTokenVerifier.verify(token);
  if (principal == null || !principal.scopes.includes("users:manage")) return undefined;
  const actor = dependencies.userAccessRepository.get(principal.userId);
  if (actor?.role !== "OWNER" || !isUserAllowed(actor)) return undefined;
  return principal;
}

export function handleOwnerDeviceCredentialRegistrationChallengeHttp(request: DashboardHttpRequest & { readonly body?: string }, dependencies: MobileSessionHttpDependencies): DashboardHttpResponse {
  const methodError = methodOnly(request, "POST"); if (methodError) return methodError;
  const principal = authorizeOwner(request, dependencies);
  if (principal == null) return dashboardJsonResponse(403, { error: "OWNER_AUTHENTICATION_REQUIRED" });
  if (dependencies.ownerDeviceCredentialService == null) return dashboardJsonResponse(503, { error: "OWNER_DEVICE_CREDENTIAL_UNAVAILABLE" });
  const input = jsonObject(request.body); const binding = ownerDeviceInput(input);
  const publicKeySpki = typeof input?.publicKeySpki === "string" ? input.publicKeySpki : "";
  if (binding == null || !publicKeySpki) return dashboardJsonResponse(400, { error: "INVALID_OWNER_DEVICE_CREDENTIAL_REGISTRATION" });
  try {
    return dashboardJsonResponse(201, dependencies.ownerDeviceCredentialService.startRegistration({ actorUserId: principal.userId, actorScopes: principal.scopes, ...binding, publicKeySpki }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return dashboardJsonResponse(message.includes("limit") ? 429 : message.includes("authority") ? 403 : 400, { error: "OWNER_DEVICE_CREDENTIAL_REGISTRATION_REJECTED" });
  }
}

export function handleOwnerDeviceCredentialRegistrationActivateHttp(request: DashboardHttpRequest & { readonly body?: string }, dependencies: MobileSessionHttpDependencies): DashboardHttpResponse {
  const methodError = methodOnly(request, "POST"); if (methodError) return methodError;
  const principal = authorizeOwner(request, dependencies);
  if (principal == null) return dashboardJsonResponse(403, { error: "OWNER_AUTHENTICATION_REQUIRED" });
  if (dependencies.ownerDeviceCredentialService == null) return dashboardJsonResponse(503, { error: "OWNER_DEVICE_CREDENTIAL_UNAVAILABLE" });
  const input = jsonObject(request.body); const binding = ownerDeviceInput(input);
  const challengeId = typeof input?.challengeId === "string" ? input.challengeId : "";
  const signature = typeof input?.signature === "string" ? input.signature : "";
  if (binding == null || !challengeId || !signature) return dashboardJsonResponse(400, { error: "INVALID_OWNER_DEVICE_CREDENTIAL_ACTIVATION" });
  try {
    return dependencies.ownerDeviceCredentialService.activateRegistration({ actorUserId: principal.userId, actorScopes: principal.scopes, ...binding, challengeId, signature })
      ? dashboardJsonResponse(201, { state: "ACTIVE" })
      : dashboardJsonResponse(401, { error: "OWNER_DEVICE_CREDENTIAL_PROOF_REJECTED" });
  } catch { return dashboardJsonResponse(403, { error: "OWNER_DEVICE_CREDENTIAL_ACTIVATION_REJECTED" }); }
}

export function handleOwnerDeviceCredentialAuthenticationChallengeHttp(request: DashboardHttpRequest & { readonly body?: string }, dependencies: MobileSessionHttpDependencies): DashboardHttpResponse {
  const methodError = methodOnly(request, "POST"); if (methodError) return methodError;
  if (dependencies.ownerDeviceCredentialService == null) return dashboardJsonResponse(503, { error: "OWNER_DEVICE_CREDENTIAL_UNAVAILABLE" });
  const binding = ownerDeviceInput(jsonObject(request.body));
  if (binding == null) return dashboardJsonResponse(400, { error: "INVALID_OWNER_DEVICE_CREDENTIAL_AUTHENTICATION" });
  try {
    const challenge = dependencies.ownerDeviceCredentialService.startAuthentication(binding);
    return challenge == null ? dashboardJsonResponse(401, { error: "OWNER_DEVICE_CREDENTIAL_REJECTED" }) : dashboardJsonResponse(201, challenge);
  } catch (error) {
    return dashboardJsonResponse(error instanceof Error && error.message.includes("limit") ? 429 : 400, { error: "OWNER_DEVICE_CREDENTIAL_REJECTED" });
  }
}

export function handleOwnerDeviceCredentialAuthenticationCompleteHttp(request: DashboardHttpRequest & { readonly body?: string }, dependencies: MobileSessionHttpDependencies): DashboardHttpResponse {
  const methodError = methodOnly(request, "POST"); if (methodError) return methodError;
  if (dependencies.ownerDeviceCredentialService == null) return dashboardJsonResponse(503, { error: "OWNER_DEVICE_CREDENTIAL_UNAVAILABLE" });
  const input = jsonObject(request.body); const binding = ownerDeviceInput(input);
  const challengeId = typeof input?.challengeId === "string" ? input.challengeId : "";
  const signature = typeof input?.signature === "string" ? input.signature : "";
  if (binding == null || !challengeId || !signature) return dashboardJsonResponse(400, { error: "INVALID_OWNER_DEVICE_CREDENTIAL_AUTHENTICATION" });
  try {
    const tokens = dependencies.ownerDeviceCredentialService.authenticate({ ...binding, challengeId, signature });
    return tokens == null ? dashboardJsonResponse(401, { error: "OWNER_DEVICE_CREDENTIAL_PROOF_REJECTED" }) : dashboardJsonResponse(200, tokens);
  } catch { return dashboardJsonResponse(401, { error: "OWNER_DEVICE_CREDENTIAL_PROOF_REJECTED" }); }
}

export function handleOwnerDeviceCredentialRevokeHttp(request: DashboardHttpRequest & { readonly body?: string }, dependencies: MobileSessionHttpDependencies): DashboardHttpResponse {
  const methodError = methodOnly(request, "POST"); if (methodError) return methodError;
  const principal = authorizeOwner(request, dependencies);
  if (principal == null) return dashboardJsonResponse(403, { error: "OWNER_AUTHENTICATION_REQUIRED" });
  if (dependencies.ownerDeviceCredentialService == null) return dashboardJsonResponse(503, { error: "OWNER_DEVICE_CREDENTIAL_UNAVAILABLE" });
  const input = jsonObject(request.body);
  const credentialId = typeof input?.credentialId === "string" ? input.credentialId : "";
  try { return dependencies.ownerDeviceCredentialService.revoke({ actorUserId: principal.userId, actorScopes: principal.scopes, credentialId }) ? dashboardJsonResponse(200, { revoked: true }) : dashboardJsonResponse(404, { error: "OWNER_DEVICE_CREDENTIAL_NOT_FOUND" }); }
  catch { return dashboardJsonResponse(400, { error: "OWNER_DEVICE_CREDENTIAL_REVOKE_REJECTED" }); }
}

/**
 * Why enrollment was refused. Every one of these used to collapse into a single
 * `USER_NOT_ACTIVE`, which made a rejected credential, an unregistered account, an account
 * awaiting approval, and a mismatched identity indistinguishable from outside -- including in
 * the operator's own logs. Each names a state of the caller's own account, so none of them
 * tells an unauthenticated caller anything about the server it could not already attempt.
 */
export type MobileEnrollmentRefusal =
  | "NO_CREDENTIAL"
  | "CREDENTIAL_REJECTED"
  | "USER_NOT_REGISTERED"
  | "USER_NOT_ACTIVE"
  | "USER_IDENTITY_MISMATCH";

export function authorizeActiveUserResult(
  request: DashboardHttpRequest,
  dependencies: MobileSessionHttpDependencies
): { readonly principal: DashboardPrincipal } | { readonly refusal: MobileEnrollmentRefusal } {
  const token = bearer(request.headers.authorization ?? request.headers.Authorization);
  if (token == null) return { refusal: "NO_CREDENTIAL" };
  let principal = dependencies.legacyTokenVerifier.verify(token);
  if (principal == null && matchesMobileEnrollmentTokenHash(token)) {
    principal = dependencies.legacyTokenVerifier.ownerPrincipal;
  }
  if (principal == null || !principal.userId.trim() || !principal.email?.trim()) return { refusal: "CREDENTIAL_REJECTED" };
  const user = dependencies.userAccessRepository.get(principal.userId.trim());
  if (user == null) return { refusal: "USER_NOT_REGISTERED" };
  if (!isUserAllowed(user)) return { refusal: "USER_NOT_ACTIVE" };
  if (user.email !== principal.email.trim().toLowerCase()) return { refusal: "USER_IDENTITY_MISMATCH" };
  return { principal };
}


/**
 * First-run enrollment for an already authenticated, approved user. The
 * caller's bearer is used only for this request; the issued capability is the
 * existing one-time mobile bootstrap token and is never persisted by Cloud.
 */
export function handleMobileEnrollmentHttp(request: DashboardHttpRequest & { readonly body?: string }, dependencies: MobileSessionHttpDependencies): DashboardHttpResponse {
  const methodError = methodOnly(request, "POST");
  if (methodError) return methodError;
  let outcome: ReturnType<typeof authorizeActiveUserResult>;
  try { outcome = authorizeActiveUserResult(request, dependencies); } catch { return dashboardJsonResponse(401, { error: "UNAUTHORIZED" }); }
  if (!("principal" in outcome)) {
    // A missing or rejected credential is 401; a credential that authenticated but whose account
    // cannot enroll is 403, and says which state that is.
    const unauthenticated = outcome.refusal === "NO_CREDENTIAL" || outcome.refusal === "CREDENTIAL_REJECTED";
    return dashboardJsonResponse(unauthenticated ? 401 : 403, { error: outcome.refusal });
  }
  const principal = outcome.principal;
  const input = jsonObject(request.body);
  const deviceId = typeof input?.deviceId === "string" ? input.deviceId.trim() : "";
  if (deviceId.length < 8 || deviceId.length > 256 || /[\r\n]/.test(deviceId)) return dashboardJsonResponse(400, { error: "INVALID_MOBILE_ENROLLMENT_REQUEST" });
  try {
    const issued = dependencies.sessionService.issueSelfBootstrap({ actorUserId: principal.userId, deviceId });
    return dashboardJsonResponse(201, issued);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("ACTIVE")) return dashboardJsonResponse(403, { error: "USER_NOT_ACTIVE" });
    if (message.includes("scope")) return dashboardJsonResponse(400, { error: "INVALID_MOBILE_SESSION_SCOPES" });
    return dashboardJsonResponse(403, { error: "MOBILE_ENROLLMENT_REJECTED" });
  }
}

export function handleMobileBootstrapIssueHttp(request: DashboardHttpRequest & { readonly body?: string }, dependencies: MobileSessionHttpDependencies): DashboardHttpResponse {
  const methodError = methodOnly(request, "POST");
  if (methodError) return methodError;
  let principal: DashboardPrincipal | undefined;
  try { principal = authorizeOwner(request, dependencies); } catch { return dashboardJsonResponse(401, { error: "UNAUTHORIZED" }); }
  if (principal == null) return dashboardJsonResponse(403, { error: "FORBIDDEN" });
  const input = jsonObject(request.body);
  const targetUserId = typeof input?.targetUserId === "string" ? input.targetUserId.trim() : "";
  const scopes = Array.isArray(input?.scopes) ? input.scopes.filter((value): value is string => typeof value === "string") : undefined;
  if (!targetUserId) return dashboardJsonResponse(400, { error: "INVALID_MOBILE_BOOTSTRAP_REQUEST" });
  try {
    const issued = dependencies.sessionService.issueBootstrap({ actorUserId: principal.userId, targetUserId, ...(scopes ? { scopes } : {}) });
    return dashboardJsonResponse(201, issued);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("ACTIVE")) return dashboardJsonResponse(409, { error: "TARGET_USER_NOT_ACTIVE" });
    if (message.includes("scope")) return dashboardJsonResponse(400, { error: "INVALID_MOBILE_SESSION_SCOPES" });
    return dashboardJsonResponse(403, { error: "FORBIDDEN" });
  }
}

export function handleMobileBootstrapHttp(request: DashboardHttpRequest & { readonly body?: string }, dependencies: MobileSessionHttpDependencies): DashboardHttpResponse {
  const methodError = methodOnly(request, "POST");
  if (methodError) return methodError;
  const input = jsonObject(request.body);
  const bootstrapToken = typeof input?.bootstrapToken === "string" ? input.bootstrapToken.trim() : "";
  const deviceId = typeof input?.deviceId === "string" ? input.deviceId.trim() : undefined;
  if (!bootstrapToken) return dashboardJsonResponse(400, { error: "INVALID_MOBILE_BOOTSTRAP_REQUEST" });
  try {
    const tokens = dependencies.sessionService.bootstrap(bootstrapToken, Date.now(), deviceId);
    return tokens == null ? dashboardJsonResponse(401, { error: "MOBILE_BOOTSTRAP_REJECTED" }) : dashboardJsonResponse(200, tokens);
  } catch { return dashboardJsonResponse(401, { error: "MOBILE_BOOTSTRAP_REJECTED" }); }
}

export function handleMobilePairingStartHttp(request: DashboardHttpRequest & { readonly body?: string }, dependencies: MobileSessionHttpDependencies): DashboardHttpResponse {
  const methodError = methodOnly(request, "POST");
  if (methodError) return methodError;
  const input = jsonObject(request.body);
  const deviceId = typeof input?.deviceId === "string" ? input.deviceId.trim() : "";
  try { return dashboardJsonResponse(201, dependencies.sessionService.startPairing(deviceId)); }
  catch (error) {
    return dashboardJsonResponse(error instanceof Error && error.message.includes("limit") ? 429 : 400, { error: "PAIRING_START_REJECTED" });
  }
}

export function handleMobilePairingStatusHttp(request: DashboardHttpRequest & { readonly body?: string }, dependencies: MobileSessionHttpDependencies): DashboardHttpResponse {
  const methodError = methodOnly(request, "POST");
  if (methodError) return methodError;
  const input = jsonObject(request.body);
  try {
    const status = dependencies.sessionService.pairingStatus(String(input?.requestId ?? ""), String(input?.deviceId ?? ""));
    return status == null ? dashboardJsonResponse(404, { error: "PAIRING_NOT_FOUND" }) : dashboardJsonResponse(200, status);
  } catch { return dashboardJsonResponse(400, { error: "INVALID_PAIRING_REQUEST" }); }
}

export function handleMobilePairingApproveHttp(request: DashboardHttpRequest & { readonly body?: string }, dependencies: MobileSessionHttpDependencies): DashboardHttpResponse {
  const methodError = methodOnly(request, "POST");
  if (methodError) return methodError;
  const principal = authorizeOwner(request, dependencies);
  if (principal == null) return dashboardJsonResponse(403, { error: "FORBIDDEN" });
  const input = jsonObject(request.body);
  try {
    const requestId = typeof input?.requestId === "string" && input.requestId.trim() ? input.requestId : undefined;
    const targetUserId = typeof input?.targetUserId === "string" && input.targetUserId.trim() ? input.targetUserId.trim() : principal.userId;
    const approved = dependencies.sessionService.approvePairing({ actorUserId: principal.userId, actorScopes: principal.scopes, targetUserId, ...(requestId ? { requestId } : {}), verificationCode: String(input?.verificationCode ?? "") });
    return approved ? dashboardJsonResponse(200, { state: "APPROVED" }) : dashboardJsonResponse(409, { error: "PAIRING_APPROVAL_REJECTED" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return message.includes("target user must be ACTIVE")
      ? dashboardJsonResponse(409, { error: "TARGET_USER_NOT_ACTIVE" })
      : dashboardJsonResponse(403, { error: "FORBIDDEN" });
  }
}

export function handleMobilePairingExchangeHttp(request: DashboardHttpRequest & { readonly body?: string }, dependencies: MobileSessionHttpDependencies): DashboardHttpResponse {
  const methodError = methodOnly(request, "POST");
  if (methodError) return methodError;
  const input = jsonObject(request.body);
  const requestId = String(input?.requestId ?? "");
  const deviceId = String(input?.deviceId ?? "");
  try {
    const tokens = dependencies.sessionService.exchangePairing(requestId, deviceId);
    return tokens == null ? dashboardJsonResponse(401, { error: "PAIRING_EXCHANGE_REJECTED" }) : dashboardJsonResponse(200, tokens);
  } catch { return dashboardJsonResponse(401, { error: "PAIRING_EXCHANGE_REJECTED" }); }
}

/** Normal password sign-in never accepts or returns an owner identity. */
export function handleOwnerPasswordSignInHttp(request: DashboardHttpRequest & { readonly body?: string }, dependencies: MobileSessionHttpDependencies): DashboardHttpResponse {
  const methodError = methodOnly(request, "POST"); if (methodError) return methodError;
  const input = jsonObject(request.body);
  const deviceId = typeof input?.deviceId === "string" ? input.deviceId.trim() : "";
  if (deviceId.length < 8 || deviceId.length > 256 || /[\r\n]/.test(deviceId)) return dashboardJsonResponse(400, { error: "INVALID_PASSWORD_SIGN_IN_REQUEST" });
  try {
    const outcome = dependencies.sessionService.signInWithOwnerPassword({ password: input?.password, deviceId });
    if (outcome.status === "AMBIGUOUS_OWNER" || outcome.status === "INVALID_OWNER") return dashboardJsonResponse(400, { error: "INVALID_PASSWORD_SIGN_IN_REQUEST" });
    if (outcome.status === "LOCKED") {
      const response = dashboardJsonResponse(429, { error: "PASSWORD_ATTEMPTS_THROTTLED", retryAfterMs: outcome.retryAfterMs });
      return Object.freeze({ ...response, headers: Object.freeze({ ...response.headers, "retry-after": String(Math.ceil(outcome.retryAfterMs / 1000)) }) });
    }
    return outcome.status === "ISSUED" ? dashboardJsonResponse(200, outcome.tokens) : dashboardJsonResponse(401, { error: "PASSWORD_REJECTED" });
  } catch { return dashboardJsonResponse(401, { error: "PASSWORD_REJECTED" }); }
}

/** Session alone is insufficient: the current password must verify before replacement. */
export function handleOwnerPasswordChangeHttp(request: DashboardHttpRequest & { readonly body?: string }, dependencies: MobileSessionHttpDependencies): DashboardHttpResponse {
  const methodError = methodOnly(request, "POST"); if (methodError) return methodError;
  const token = bearer(request.headers.authorization ?? request.headers.Authorization);
  const principal = token == null ? undefined : dependencies.sessionService.verifyAccess(token);
  const actor = principal == null ? undefined : dependencies.userAccessRepository.get(principal.userId);
  if (principal == null || actor?.role !== "OWNER" || !isUserAllowed(actor)) return dashboardJsonResponse(403, { error: "OWNER_AUTHENTICATION_REQUIRED" });
  const input = jsonObject(request.body);
  if (typeof input?.newPassword !== "string") return dashboardJsonResponse(400, { error: "INVALID_PASSWORD_CHANGE_REQUEST" });
  try {
    const outcome = dependencies.sessionService.changeOwnerPassword({ actorUserId: principal.userId, currentPassword: input?.currentPassword, newPassword: input.newPassword });
    if (outcome.status === "LOCKED") {
      const response = dashboardJsonResponse(429, { error: "PASSWORD_ATTEMPTS_THROTTLED", retryAfterMs: outcome.retryAfterMs });
      return Object.freeze({ ...response, headers: Object.freeze({ ...response.headers, "retry-after": String(Math.ceil(outcome.retryAfterMs / 1000)) }) });
    }
    return outcome.status === "CHANGED" ? dashboardJsonResponse(200, { changed: true }) : outcome.status === "REJECTED" ? dashboardJsonResponse(401, { error: "PASSWORD_REJECTED" }) : dashboardJsonResponse(403, { error: "OWNER_AUTHENTICATION_REQUIRED" });
  } catch { return dashboardJsonResponse(400, { error: "INVALID_PASSWORD_CHANGE_REQUEST" }); }
}

export function handleMobileSessionRefreshHttp(request: DashboardHttpRequest & { readonly body?: string }, dependencies: MobileSessionHttpDependencies): DashboardHttpResponse {
  const methodError = methodOnly(request, "POST");
  if (methodError) return methodError;
  const input = jsonObject(request.body);
  const refreshToken = typeof input?.refreshToken === "string" ? input.refreshToken.trim() : "";
  const deviceId = typeof input?.deviceId === "string" ? input.deviceId.trim() : undefined;
  if (!refreshToken) return dashboardJsonResponse(400, { error: "INVALID_MOBILE_REFRESH_REQUEST" });
  try {
    const tokens = dependencies.sessionService.refresh(refreshToken, Date.now(), deviceId);
    return tokens == null ? dashboardJsonResponse(401, { error: "MOBILE_REFRESH_REJECTED" }) : dashboardJsonResponse(200, tokens);
  } catch { return dashboardJsonResponse(401, { error: "MOBILE_REFRESH_REJECTED" }); }
}

export function handleMobileSessionRevokeHttp(request: DashboardHttpRequest, dependencies: MobileSessionHttpDependencies): DashboardHttpResponse {
  const methodError = methodOnly(request, "POST");
  if (methodError) return methodError;
  const accessToken = bearer(request.headers.authorization ?? request.headers.Authorization);
  if (accessToken == null) return dashboardJsonResponse(401, { error: "UNAUTHORIZED" });
  try {
    if (dependencies.sessionService.verifyAccess(accessToken) == null) return dashboardJsonResponse(401, { error: "UNAUTHORIZED" });
    dependencies.sessionService.revokeAccess(accessToken);
    return dashboardJsonResponse(200, { revoked: true });
  } catch { return dashboardJsonResponse(503, { error: "MOBILE_SESSION_UNAVAILABLE" }); }
}

export function handleMobileMeHttp(request: DashboardHttpRequest, dependencies: MobileSessionHttpDependencies): DashboardHttpResponse {
  const methodError = methodOnly(request, "GET");
  if (methodError) return methodError;
  const accessToken = bearer(request.headers.authorization ?? request.headers.Authorization);
  if (accessToken == null) return dashboardJsonResponse(401, { error: "UNAUTHORIZED" });
  try {
    const me = dependencies.sessionService.me(accessToken);
    return me == null ? dashboardJsonResponse(401, { error: "UNAUTHORIZED" }) : dashboardJsonResponse(200, me);
  } catch { return dashboardJsonResponse(503, { error: "MOBILE_SESSION_UNAVAILABLE" }); }
}
