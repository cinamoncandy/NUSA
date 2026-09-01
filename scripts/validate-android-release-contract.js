const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const CONTRACT_PATH = path.join(ROOT, ".github", "android-release-contract.json");
const SOURCE_ROOT = path.join(ROOT, "apps", "mobile", "src");

const REQUIRED_SAFETY = Object.freeze({
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  aiAuthority: "ZERO_AUTHORITY",
  mobileCredentialStorageAllowed: false,
  paperRealSeparation: true,
  failClosed: true,
});

const REQUIRED_UI_ROLES = Object.freeze([
  "homePaperLearning",
  "homeSupervisorLearning",
  "tradePaperLearning",
  "portfolioPaperLearning",
  "paperLearningMonitor",
]);

const REQUIRED_CHART_ROLES = Object.freeze([
  "marketsChartTab",
  "marketDetailWorkspace",
  "chartScreen",
  "chartCandles",
]);

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);

function fail(message) {
  throw new Error(`Android release contract violation: ${message}`);
}

function readContract(contractPath = CONTRACT_PATH) {
  if (!fs.existsSync(contractPath)) fail(`missing ${path.relative(ROOT, contractPath)}`);
  let contract;
  try {
    contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
  } catch (error) {
    fail(`invalid JSON: ${error.message}`);
  }
  return contract;
}

function validateRoleMap(label, value, requiredRoles) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  for (const role of requiredRoles) {
    if (!Object.prototype.hasOwnProperty.call(value, role)) fail(`${label}.${role} is required`);
    const marker = value[role];
    if (typeof marker !== "string" || marker.length < 3 || !/^[a-z0-9-]+$/.test(marker)) {
      fail(`${label}.${role} must be a non-empty lowercase marker`);
    }
  }
  const markers = requiredRoles.map((role) => value[role]);
  if (new Set(markers).size !== markers.length) fail(`${label} markers must be unique`);
  return markers;
}

function validateContractShape(contract) {
  if (contract == null || typeof contract !== "object" || Array.isArray(contract)) fail("root must be an object");
  if (contract.schemaVersion !== 1) fail("schemaVersion must remain 1 until validator support changes atomically");
  if (contract.releaseMode !== "PAPER_SHADOW_ONLY") fail("releaseMode must be PAPER_SHADOW_ONLY");
  if (contract.safety == null || typeof contract.safety !== "object" || Array.isArray(contract.safety)) {
    fail("safety must be an object");
  }
  for (const [key, expected] of Object.entries(REQUIRED_SAFETY)) {
    if (contract.safety[key] !== expected) fail(`safety.${key} must equal ${JSON.stringify(expected)}`);
  }
  const uiMarkers = validateRoleMap("uiMarkers", contract.uiMarkers, REQUIRED_UI_ROLES);
  const chartMarkers = validateRoleMap("chartMarkers", contract.chartMarkers, REQUIRED_CHART_ROLES);
  return { uiMarkers, chartMarkers };
}

function shouldScanFile(filePath) {
  const relative = path.relative(SOURCE_ROOT, filePath).replaceAll("\\", "/");
  if (!SOURCE_EXTENSIONS.has(path.extname(filePath))) return false;
  if (/(^|\/)(__tests__|tests?|fixtures)(\/|$)/.test(relative)) return false;
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(relative)) return false;
  return true;
}

function collectSourceFiles(directory = SOURCE_ROOT, result = []) {
  if (!fs.existsSync(directory)) fail(`missing source root ${path.relative(ROOT, directory)}`);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectSourceFiles(entryPath, result);
    else if (entry.isFile() && shouldScanFile(entryPath)) result.push(entryPath);
  }
  return result;
}

function findMarkerHits(markers, sourceFiles) {
  const contents = sourceFiles.map((filePath) => ({
    filePath,
    text: fs.readFileSync(filePath, "utf8"),
  }));
  const hits = new Map();
  for (const marker of markers) {
    const markerHits = contents
      .filter(({ text }) => text.includes(marker))
      .map(({ filePath }) => path.relative(ROOT, filePath).replaceAll("\\", "/"));
    if (markerHits.length === 0) fail(`marker ${JSON.stringify(marker)} is absent from production mobile source`);
    hits.set(marker, markerHits);
  }
  return hits;
}

function validateAndroidReleaseContract(options = {}) {
  const contract = readContract(options.contractPath || CONTRACT_PATH);
  const { uiMarkers, chartMarkers } = validateContractShape(contract);
  const sourceFiles = collectSourceFiles(options.sourceRoot || SOURCE_ROOT, []);
  const markerHits = findMarkerHits([...uiMarkers, ...chartMarkers], sourceFiles);
  return {
    contract,
    markerHits,
    sourceFileCount: sourceFiles.length,
  };
}

if (require.main === module) {
  try {
    const result = validateAndroidReleaseContract();
    console.log(`Android release contract PASS: ${result.markerHits.size} semantic markers across ${result.sourceFileCount} production source files.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  CONTRACT_PATH,
  REQUIRED_CHART_ROLES,
  REQUIRED_SAFETY,
  REQUIRED_UI_ROLES,
  SOURCE_ROOT,
  validateAndroidReleaseContract,
  validateContractShape,
};
