"use strict";

const crypto = require("node:crypto");

const CONTEXT = "nusa/release-authorized";
const SHA40 = /^[0-9a-f]{40}$/i;
const APP_ID = /^\d+$/;
const ALLOWED_STATES = new Set(["success", "failure", "error", "pending"]);

function fail(message) {
  throw new Error(message);
}

function normalizePrivateKey(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return raw.includes("\\n") && !raw.includes("\n") ? raw.replace(/\\n/g, "\n") : raw;
}

function configured(env = process.env) {
  const appId = String(env.NUSA_RELEASE_AUTHORITY_APP_ID ?? "").trim();
  const privateKey = normalizePrivateKey(env.NUSA_RELEASE_AUTHORITY_PRIVATE_KEY);
  if (!appId && !privateKey) return false;
  if (!appId || !privateKey) fail("release authority GitHub App configuration is partial");
  if (!APP_ID.test(appId)) fail("release authority GitHub App id is invalid");
  if (!privateKey.includes("PRIVATE KEY-----")) fail("release authority GitHub App private key is invalid");
  return true;
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function createAppJwt(appId, privateKey, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!APP_ID.test(String(appId))) fail("release authority GitHub App id is invalid");
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds <= 0) fail("release authority clock is invalid");
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const payload = base64UrlJson({ iat: nowSeconds - 60, exp: nowSeconds + 540, iss: String(appId) });
  const unsigned = `${header}.${payload}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned, "utf8"), privateKey).toString("base64url");
  return `${unsigned}.${signature}`;
}

async function githubJson(fetchImpl, url, options, label) {
  const response = await fetchImpl(url, options);
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; }
  catch { fail(`${label} returned invalid JSON`); }
  if (!response.ok) fail(`${label} failed with HTTP ${response.status}`);
  return body;
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) fail(`unexpected argument: ${key}`);
    const value = argv[index + 1];
    if (value == null || value.startsWith("--")) fail(`missing value for ${key}`);
    values[key.slice(2)] = value;
    index += 1;
  }
  const repo = String(values.repo ?? "").trim();
  const sha = String(values.sha ?? "").trim().toLowerCase();
  const state = String(values.state ?? "").trim().toLowerCase();
  const auditedBase = String(values["audited-base"] ?? "").trim().toLowerCase();
  const prNumber = Number(values.pr);
  const targetUrl = String(values["target-url"] ?? "").trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) fail("release authority repository is invalid");
  if (!SHA40.test(sha)) fail("release authority exact head SHA is invalid");
  if (!SHA40.test(auditedBase)) fail("release authority audited base SHA is invalid");
  if (!ALLOWED_STATES.has(state)) fail("release authority status state is invalid");
  if (!Number.isSafeInteger(prNumber) || prNumber <= 0) fail("release authority PR number is invalid");
  if (targetUrl && !/^https:\/\/github\.com\//.test(targetUrl)) fail("release authority target URL is invalid");
  return Object.freeze({ repo, sha, state, auditedBase, prNumber, targetUrl });
}

async function publish(input, env = process.env, fetchImpl = global.fetch) {
  if (typeof fetchImpl !== "function") fail("release authority requires fetch");
  if (!configured(env)) return Object.freeze({ configured: false, published: false });

  const appId = String(env.NUSA_RELEASE_AUTHORITY_APP_ID).trim();
  const privateKey = normalizePrivateKey(env.NUSA_RELEASE_AUTHORITY_PRIVATE_KEY);
  const jwt = createAppJwt(appId, privateKey);
  const common = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "nusa-release-authority",
  };
  const installation = await githubJson(
    fetchImpl,
    `https://api.github.com/repos/${input.repo}/installation`,
    { headers: { ...common, Authorization: `Bearer ${jwt}` } },
    "release authority installation lookup",
  );
  if (!Number.isSafeInteger(installation.id) || installation.id <= 0) fail("release authority installation id is invalid");

  const repoName = input.repo.split("/")[1];
  const tokenResponse = await githubJson(
    fetchImpl,
    `https://api.github.com/app/installations/${installation.id}/access_tokens`,
    {
      method: "POST",
      headers: { ...common, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ repositories: [repoName], permissions: { statuses: "write" } }),
    },
    "release authority installation token",
  );
  const token = typeof tokenResponse.token === "string" ? tokenResponse.token.trim() : "";
  if (!token) fail("release authority installation token is unavailable");

  const description = input.state === "success"
    ? `Audit PASS PR #${input.prNumber}; base ${input.auditedBase.slice(0, 12)}`
    : `Canonical merge authorization revoked for PR #${input.prNumber}`;
  const status = await githubJson(
    fetchImpl,
    `https://api.github.com/repos/${input.repo}/statuses/${input.sha}`,
    {
      method: "POST",
      headers: { ...common, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        state: input.state,
        context: CONTEXT,
        description,
        ...(input.targetUrl ? { target_url: input.targetUrl } : {}),
      }),
    },
    "release authority status publication",
  );
  if (status.context !== CONTEXT || status.state !== input.state || String(status.sha ?? "").toLowerCase() !== input.sha) {
    fail("release authority status response identity mismatch");
  }
  return Object.freeze({ configured: true, published: true, context: CONTEXT, state: input.state });
}

async function main() {
  const input = parseArgs(process.argv.slice(2));
  const result = await publish(input);
  if (!result.configured) {
    process.stdout.write("RELEASE_AUTHORITY_NOT_CONFIGURED\n");
    return;
  }
  process.stdout.write(`RELEASE_AUTHORITY_STATUS_PUBLISHED context=${result.context} state=${result.state}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  CONTEXT,
  configured,
  createAppJwt,
  normalizePrivateKey,
  parseArgs,
  publish,
};
