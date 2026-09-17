const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { InMemoryNusaUserAccessRepository } = require("../dist/apps/cloud/src/operatorUserAccess.js");
const { MobileSessionService } = require("../dist/apps/cloud/src/mobileSessionService.js");
const { OwnerDeviceCredentialService, ownerDeviceCredentialChallengeBytes, OWNER_DEVICE_CREDENTIAL_CHALLENGE_TTL_MS } = require("../dist/apps/cloud/src/ownerCredential/ownerDeviceCredentialService.js");
const http = require("../dist/apps/cloud/src/mobileSessionHttp.js");

const ownerBearerValue = ["owner", "device", "credential", "test", "token"].join("-");
const DEVICE = "nusa-install-owner-device-0001";
const CREDENTIAL_ID = "credential-owner-device-0123456789abcdef";

function keyPair() { return crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" }); }
function publicKeySpki(pair) { return pair.publicKey.export({ type: "spki", format: "der" }).toString("base64"); }
function sign(pair, challenge) { return crypto.sign("sha256", Buffer.from(challenge, "base64"), pair.privateKey).toString("base64"); }
function request(method, body, token) { return { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) }; }

function setup() {
  const db = new SqliteDatabase(":memory:");
  const users = new InMemoryNusaUserAccessRepository();
  users.ensureOwner({ id: "owner", email: "owner@nusa.local" }, 1);
  const mobile = new MobileSessionService(db, users);
  const credentials = new OwnerDeviceCredentialService(db, users, mobile, "https://nusa.test");
  const legacyTokenVerifier = { verify(token) { return token === ownerBearerValue ? { userId: "owner", email: "owner@nusa.local", scopes: ["users:manage", "dashboard:read"] } : undefined; } };
  return { db, users, mobile, credentials, dependencies: { sessionService: mobile, ownerDeviceCredentialService: credentials, legacyTokenVerifier, userAccessRepository: users } };
}

function register(service, pair, now = 10, credentialId = CREDENTIAL_ID) {
  const started = service.startRegistration({ actorUserId: "owner", actorScopes: ["users:manage"], credentialId, deviceId: DEVICE, publicKeySpki: publicKeySpki(pair), now });
  assert.equal(service.activateRegistration({ actorUserId: "owner", actorScopes: ["users:manage"], credentialId, deviceId: DEVICE, challengeId: started.challengeId, signature: sign(pair, started.challenge), now: now + 1 }), true);
}

test("registration is ACTIVE OWNER users:manage-only and requires P-256 possession proof", () => {
  const { db, credentials, dependencies } = setup();
  try {
    const pair = keyPair();
    const body = { credentialId: CREDENTIAL_ID, deviceId: DEVICE, publicKeySpki: publicKeySpki(pair) };
    assert.equal(http.handleOwnerDeviceCredentialRegistrationChallengeHttp(request("POST", body), dependencies).status, 403);
    const startedResponse = http.handleOwnerDeviceCredentialRegistrationChallengeHttp(request("POST", body, ownerBearerValue), dependencies);
    assert.equal(startedResponse.status, 201);
    const started = JSON.parse(startedResponse.body);
    const wrong = keyPair();
    assert.equal(http.handleOwnerDeviceCredentialRegistrationActivateHttp(request("POST", { credentialId: CREDENTIAL_ID, deviceId: DEVICE, challengeId: started.challengeId, signature: sign(wrong, started.challenge) }, ownerBearerValue), dependencies).status, 401);
    assert.equal(db.connection.prepare("SELECT COUNT(*) AS count FROM nusa_owner_device_credentials").get().count, 0);
    const retry = http.handleOwnerDeviceCredentialRegistrationChallengeHttp(request("POST", body, ownerBearerValue), dependencies);
    const challenge = JSON.parse(retry.body);
    assert.equal(http.handleOwnerDeviceCredentialRegistrationActivateHttp(request("POST", { credentialId: CREDENTIAL_ID, deviceId: DEVICE, challengeId: challenge.challengeId, signature: sign(pair, challenge.challenge) }, ownerBearerValue), dependencies).status, 201);
  } finally { db.close(); }
});

test("registration activation is bound to the same active owner that created its challenge", () => {
  const { db, users, credentials } = setup();
  try {
    users.ensureOwner({ id: "other-owner", email: "other@nusa.local" }, 2);
    const pair = keyPair();
    const started = credentials.startRegistration({ actorUserId: "owner", actorScopes: ["users:manage"], credentialId: CREDENTIAL_ID, deviceId: DEVICE, publicKeySpki: publicKeySpki(pair), now: 10 });
    assert.equal(credentials.activateRegistration({ actorUserId: "other-owner", actorScopes: ["users:manage"], credentialId: CREDENTIAL_ID, deviceId: DEVICE, challengeId: started.challengeId, signature: sign(pair, started.challenge), now: 11 }), false);
    assert.equal(db.connection.prepare("SELECT COUNT(*) AS count FROM nusa_owner_device_credentials").get().count, 0);
  } finally { db.close(); }
});

test("challenge bytes separate registration/authentication and bind context, device, expiry, and nonce", () => {
  const { db, credentials } = setup();
  try {
    const pair = keyPair(); register(credentials, pair);
    const auth = credentials.startAuthentication({ credentialId: CREDENTIAL_ID, deviceId: DEVICE, now: 20 });
    assert.ok(auth);
    const registrationBytes = ownerDeviceCredentialChallengeBytes({ challengeId: auth.challengeId, nonce: "different-nonce", purpose: "REGISTRATION", credentialId: CREDENTIAL_ID, deviceId: DEVICE, serverContext: "https://nusa.test", expiresAt: auth.expiresAt });
    assert.notDeepEqual(Buffer.from(auth.challenge, "base64"), registrationBytes);
    assert.equal(credentials.authenticate({ credentialId: CREDENTIAL_ID, deviceId: DEVICE, challengeId: auth.challengeId, signature: crypto.sign("sha256", registrationBytes, pair.privateKey).toString("base64"), now: 21 }), undefined);
    const expired = credentials.startAuthentication({ credentialId: CREDENTIAL_ID, deviceId: DEVICE, now: 30 });
    assert.ok(expired);
    assert.equal(credentials.authenticate({ credentialId: CREDENTIAL_ID, deviceId: DEVICE, challengeId: expired.challengeId, signature: sign(pair, expired.challenge), now: 30 + OWNER_DEVICE_CREDENTIAL_CHALLENGE_TTL_MS }), undefined);
  } finally { db.close(); }
});

test("authentication rejects replay, wrong device, and revoked credentials, then uses existing rotating MobileSessionTokens", () => {
  const { db, credentials, mobile } = setup();
  try {
    const pair = keyPair(); register(credentials, pair);
    const challenge = credentials.startAuthentication({ credentialId: CREDENTIAL_ID, deviceId: DEVICE, now: 50 }); assert.ok(challenge);
    assert.equal(credentials.authenticate({ credentialId: CREDENTIAL_ID, deviceId: "nusa-install-wrong-device-0001", challengeId: challenge.challengeId, signature: sign(pair, challenge.challenge), now: 51 }), undefined);
    const tokens = credentials.authenticate({ credentialId: CREDENTIAL_ID, deviceId: DEVICE, challengeId: challenge.challengeId, signature: sign(pair, challenge.challenge), now: 52 });
    assert.ok(tokens); assert.equal(mobile.verifyAccess(tokens.accessToken, 53).userId, "owner");
    assert.equal(credentials.authenticate({ credentialId: CREDENTIAL_ID, deviceId: DEVICE, challengeId: challenge.challengeId, signature: sign(pair, challenge.challenge), now: 54 }), undefined);
    assert.equal(credentials.revoke({ actorUserId: "owner", actorScopes: ["users:manage"], credentialId: CREDENTIAL_ID, now: 55 }), true);
    assert.equal(credentials.startAuthentication({ credentialId: CREDENTIAL_ID, deviceId: DEVICE, now: 56 }), undefined);
  } finally { db.close(); }
});

test("source boundaries expose only public key and signature operations, never private/exported keys or exchange secrets", () => {
  const root = path.resolve(__dirname, "..");
  const native = fs.readFileSync(path.join(root, "apps/mobile/android/app/src/main/java/com/nusa/mobile/NusaOwnerDeviceCredentialModule.java"), "utf8");
  const bridge = fs.readFileSync(path.join(root, "apps/mobile/src/ownerDeviceCredential.ts"), "utf8");
  const service = fs.readFileSync(path.join(root, "apps/cloud/src/ownerCredential/ownerDeviceCredentialService.ts"), "utf8");
  assert.match(native, /AndroidKeyStore/); assert.match(native, /BIOMETRIC_STRONG/);
  assert.doesNotMatch(native, /Authenticators\.DEVICE_CREDENTIAL|AUTH_DEVICE_CREDENTIAL/);
  assert.doesNotMatch(native, /getPrivateKey|exportPrivate|PrivateKey\.getEncoded/);
  assert.doesNotMatch(bridge, /privateKey|export.*key/i);
  assert.doesNotMatch(service, /UPBIT|BINANCE|BYBIT|OKX|COINBASE|exchange.*(?:secret|key)/i);
  assert.doesNotMatch(service, /console\.|operationalLog|signature.*(?:log|audit)/i);
});
