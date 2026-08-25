"use strict";

const fs = require("node:fs");
const path = require("node:path");

function read(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function validateAndroidReleaseModel(root = path.resolve(__dirname, "..")) {
  const failures = [];
  const expect = (condition, message) => {
    if (!condition) failures.push(message);
  };

  const mobilePackagePath = path.join(root, "apps", "mobile", "package.json");
  const mobilePackage = JSON.parse(fs.readFileSync(mobilePackagePath, "utf8"));
  const gradlePath = path.join(root, "apps", "mobile", "android", "app", "build.gradle");
  const gradle = fs.readFileSync(gradlePath, "utf8");
  const debugStrings = read(root, "apps/mobile/android/app/src/debug/res/values/strings.xml");
  const settingsView = read(root, "apps/mobile/src/settingsView.tsx");

  expect(mobilePackage.version === "1.0.101", "mobile product version must be 1.0.101");
  expect(/applicationId\s+"com\.nusa\.mobile"/.test(gradle), "Android package must remain com.nusa.mobile");
  expect(!/applicationIdSuffix\s+["']\.preview["']/.test(gradle), "active .preview application suffix is forbidden");
  expect(!/versionNameSuffix\s+["']-preview["']/.test(gradle), "active -preview version suffix is forbidden");
  expect(/applicationIdSuffix\s+["']\.debug["']/.test(gradle), "local debug installs must retain a neutral .debug identity");
  expect(/versionNameSuffix\s+["']-debug["']/.test(gradle), "local debug installs must retain a neutral -debug identity");
  expect(!/preview/i.test(gradle), "Android Gradle configuration must not use active Preview terminology");
  expect(!/preview/i.test(debugStrings), "debug launcher label must not use active Preview terminology");
  expect(settingsView.includes("mobilePackage.version"), "mobile settings must use the product metadata version");
  expect(!settingsView.includes("NUSA Mobile 0.1.0"), "mobile settings must not advertise the retired product version");
  expect(/new groovy\.json\.JsonSlurper\(\)\.parse\(file\("\.\.\/\.\.\/package\.json"\)\)/.test(gradle), "Gradle must read the mobile package metadata");
  expect(/def nusaProductVersionCodeBase = \(nusaProductMajor \* 10000000\)/.test(gradle), "versionCode base must derive from semver product metadata with channel space");
  expect(/def nusaVersionCode = nusaProductVersionCodeBase \+ \(nusaBuildChannel == "rc" \? 1/.test(gradle), "versionCode must use deterministic channel slots");
  expect(/def nusaVersionName = nusaBuildChannel == "rc"/.test(gradle), "RC version naming must be channel-driven");
  expect(/buildConfigField "String", "NUSA_BUILD_NUMBER"/.test(gradle), "CI build number must remain packaged as provenance");
  expect(!/def nusaVersionCode[^\r\n]*nusaBuildNumber/.test(gradle), "CI build number must not drive Android versionCode");
  expect(/\$\{nusaProductVersion\}-rc\.\$\{nusaBuildNumber\}/.test(gradle), "CI build number may identify an RC but must not replace the product version");
  expect(/VERSION_CODE_BASE=\$\(\(MAJOR \* 10000000 \+ MINOR \* 100000 \+ PATCH \* 10\)\)/.test(read(root, ".github/workflows/android-release.yml")), "workflow versionCode validation must reserve channel space");

  const workflowDirectory = path.join(root, ".github", "workflows");
  const workflowFiles = fs.readdirSync(workflowDirectory).filter((name) => /android|mobile-native/i.test(name));
  expect(!workflowFiles.includes("android-persistent-release.yml"), "the retired persistent Preview workflow must not remain active");
  expect(!fs.existsSync(path.join(root, ".github", "android-preview-source.txt")), "the retired Preview source pointer must not remain active");
  for (const file of workflowFiles) {
    const content = read(root, path.join(".github/workflows", file));
    expect(!/preview|persistent-preview|android-preview/i.test(content), `active workflow ${file} contains retired Preview terminology`);
  }
  const releaseWorkflow = read(root, ".github/workflows/android-release.yml");
  expect(/name: Android RC and Release/.test(releaseWorkflow), "canonical Android workflow must expose RC and Release semantics");
  expect(/NUSA_BUILD_CHANNEL: \$\{\{ steps\.channel\.outputs\.value \}\}/.test(releaseWorkflow), "canonical workflow must pass the build channel");
  expect(/physical_acceptance_evidence/.test(releaseWorkflow), "final release must require a physical acceptance evidence reference");
  const mobileNativeWorkflow = read(root, ".github/workflows/mobile-native.yml");
  expect(/NUSA_BUILD_CHANNEL: rc/.test(mobileNativeWorkflow), "Mobile Native RC build must set the RC channel");
  expect(/nusa-android-rc-/.test(mobileNativeWorkflow), "Mobile Native artifact must use neutral RC naming");

  const modelDoc = read(root, "docs/android-101-release-model.md");
  for (const required of ["1.0.101", "RC", "GALAXY PHYSICAL ACCEPTANCE", "RELEASE", "Historical Preview", "liveAuthority=NONE", "productionMutationAllowed=false", "AI authority=ZERO_AUTHORITY"]) {
    expect(modelDoc.includes(required), `release model documentation must include ${required}`);
  }

  return { ok: failures.length === 0, failures };
}

if (require.main === module) {
  const result = validateAndroidReleaseModel();
  if (!result.ok) {
    console.error(result.failures.map((failure) => `- ${failure}`).join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Android release model: PASS");
  }
}

module.exports = { validateAndroidReleaseModel };
