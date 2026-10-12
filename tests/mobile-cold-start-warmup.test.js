const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const read = (path) => fs.readFileSync(path, "utf8");

test("mobile starts credential-free canonical transport warm-up before waiting for persisted settings", () => {
  const app = read("apps/mobile/App.tsx");
  const provider = app.slice(app.indexOf("function AuthContextProvider("), app.indexOf("function AuthenticatedApp("));
  const resolve = provider.indexOf("const canonicalAtLaunch = resolveCanonicalCloudOrigin()");
  const warm = provider.indexOf("warmConnection(canonicalAtLaunch.origin)");
  const settings = provider.indexOf("settingsRepository.load()");
  assert.ok(resolve >= 0 && warm > resolve && settings > warm, "warm-up must begin before AsyncStorage settings load");
  assert.match(provider.slice(resolve, settings), /canonicalAtLaunch\.status === "READY"/);
  assert.match(provider, /restoreConfiguredPaperSession\(endpoint/);
  assert.match(provider, /setStatus\(restored \|\| getConfiguredPaperEndpoint\(\) != null \? "SIGNED_IN" : "SIGNED_OUT"\)/);
});

test("the warm-up remains an unauthenticated, HTTPS-only, no-redirect public health request", () => {
  const warmup = read("apps/mobile/src/connectionWarmup.ts").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(warmup, /!\/\^https:\\\/\\\/\[\^\\s\/\]\+\$\//);
  assert.match(warmup, /\$\{url\}\/health/);
  assert.match(warmup, /method: "GET", redirect: "error", cache: "no-store"/);
  assert.doesNotMatch(warmup, /authorization|cookie|credentialProvider/i);
});
