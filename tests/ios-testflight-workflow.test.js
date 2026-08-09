const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workflowPath = path.resolve(__dirname, "../.github/workflows/ios-testflight.yml");
const workflow = fs.readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n");

test("TestFlight distribution is manual, protected, and does not run on push or pull request", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n\s+push:/);
  assert.doesNotMatch(workflow, /\n\s+pull_request:/);
  assert.match(workflow, /environment: testflight/);
  assert.match(workflow, /permissions:\n\s+contents: read/);
});

test("TestFlight workflow fails closed when Apple deployment material is absent", () => {
  for (const secret of [
    "APPLE_TEAM_ID",
    "IOS_DISTRIBUTION_CERTIFICATE_BASE64",
    "IOS_DISTRIBUTION_CERTIFICATE_PASSWORD",
    "IOS_PROVISIONING_PROFILE_BASE64",
    "APP_STORE_CONNECT_API_KEY_ID",
    "APP_STORE_CONNECT_API_ISSUER_ID",
    "APP_STORE_CONNECT_API_KEY_BASE64",
  ]) {
    assert.equal(workflow.includes(secret), true, `missing required deployment input ${secret}`);
  }
  assert.match(workflow, /Missing TestFlight deployment secret/);
});

test("deployment secrets are step-scoped away from dependency installation", () => {
  const jobEnv = workflow.match(/\n    env:\n      APP_BUNDLE_ID: [^\n]+\n/);
  assert.notEqual(jobEnv, null);
  assert.equal(jobEnv[0].includes("secrets."), false);

  const installStart = workflow.indexOf("- name: Install locked JavaScript dependencies");
  const signingStart = workflow.indexOf("- name: Install Apple distribution signing assets");
  assert.notEqual(installStart, -1);
  assert.notEqual(signingStart, -1);
  const dependencyInstallSection = workflow.slice(installStart, signingStart);
  assert.equal(dependencyInstallSection.includes("secrets."), false);
});

test("TestFlight workflow signs a physical-device release with the NUSA bundle identity", () => {
  assert.match(workflow, /APP_BUNDLE_ID: com\.nusa\.trader/);
  assert.match(workflow, /-destination 'generic\/platform=iOS'/);
  assert.match(workflow, /CODE_SIGN_STYLE=Manual/);
  assert.match(workflow, /CODE_SIGN_IDENTITY='Apple Distribution'/);
  assert.match(workflow, /PROVISIONING_PROFILE_SPECIFIER=/);
  assert.doesNotMatch(workflow, /CODE_SIGNING_ALLOWED=NO/);
});

test("TestFlight workflow rejects mismatched or development provisioning profiles", () => {
  assert.match(workflow, /PROFILE_TEAM_ID/);
  assert.match(workflow, /PROFILE_APP_ID/);
  assert.match(workflow, /Entitlements:get-task-allow/);
  assert.match(workflow, /Development provisioning profiles are not accepted for TestFlight/);
});

test("TestFlight workflow exports, validates, uploads, and removes ephemeral signing material", () => {
  assert.match(workflow, /<string>app-store-connect<\/string>/);
  assert.equal(workflow.includes("-exportArchive"), true);
  assert.match(workflow, /xcrun altool --validate-app/);
  assert.match(workflow, /xcrun altool --upload-app/);
  assert.match(workflow, /Remove signing material/);
  assert.match(workflow, /security delete-keychain/);
});
