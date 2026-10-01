const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "apps/mobile/src/fieldScreensModel.ts");
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
}).outputText;
const shim = { exports: {} };
new Function("module", "exports", "require", compiled)(shim, shim.exports, require);
const { buildPaperFieldHeader, buildLiveFieldHeader, fieldHeaderPose } = shim.exports;

const perf = { realizedPnL: 0, unrealizedPnL: 0, fees: 0, turnover: 0, completedCycles: 12, filledCycles: 0, winRate: null, expectancy: null, maxDrawdown: 0 };
const paper = (overrides = {}) => ({ status: "RUNNING", dataSource: "SERVER_STREAM", performance: perf, ...overrides });
const safety = { killSwitchActive: false, staleMarketData: false, reconciliationMismatch: false, exchangeError: false, abnormalBalanceDrift: false, riskBudgetBreached: false, strategyInvalidated: false, latencyOrSlippageBreached: false };
const live = (overrides = {}) => ({ status: "NOT_READY", blockers: ["a", "b"], liveAuthority: "NONE", runtimeSafety: safety, ...overrides });

test("PAPER header fails closed and never reads green without a verified source", () => {
  assert.equal(buildPaperFieldHeader(paper({ dataSource: "UNAVAILABLE" })).tone, "amber");
  assert.equal(buildPaperFieldHeader(paper({ status: "HALTED" })).tone, "red");
  assert.equal(buildPaperFieldHeader(paper({ status: "ERROR" })).tone, "amber");
  assert.equal(buildPaperFieldHeader(paper({ status: "PAUSED" })).tone, "dim");
  const idle = buildPaperFieldHeader(paper());
  assert.match(idle.headline, /체결이 없습니다/);
  assert.equal(idle.facts.find((f) => f.label === "체결 사이클").value, "0");
  for (const source of ["PROJECTION_ABSENT", "PROJECTION_EMPTY", "LOCAL_FALLBACK"]) assert.equal(buildPaperFieldHeader(paper({ dataSource: source })).tone, "amber");
  assert.equal(buildPaperFieldHeader(paper({ performance: { ...perf, filledCycles: 3 } })).headline, "PAPER 실행 중");
});

test("LIVE header is always SEALED or HALTED and never claims LIVE is active", () => {
  assert.equal(buildLiveFieldHeader(null, "offline").statusWord, "SEALED");
  assert.equal(buildLiveFieldHeader(live()).statusWord, "SEALED");
  assert.equal(buildLiveFieldHeader(live({ runtimeSafety: { ...safety, killSwitchActive: true } })).tone, "red");
  const ready = buildLiveFieldHeader(live({ status: "READY_FOR_MANUAL_ENABLE", blockers: [] }));
  assert.equal(ready.statusWord, "SEALED");
  assert.match(ready.detail, /소유자 승인/);
  for (const model of [buildLiveFieldHeader(null), buildLiveFieldHeader(live()), ready]) assert.notEqual(model.tone, "green");
});

test("PAPER, LIVE and MORE render the field visual language", () => {
  const read = (file) => fs.readFileSync(path.join(root, "apps/mobile/src", file), "utf8");
  assert.match(read("paperLearningMonitorView.tsx"), /<FieldHeader model=\{buildPaperFieldHeader\(state\)\}/);
  assert.doesNotMatch(read("paperLearningMonitorView.tsx"), /IntelligenceMotionField/);
  assert.doesNotMatch(read("liveReadinessMonitorView.tsx"), /IntelligenceMotionField|LIVE 준비 상태 관측/);
  assert.doesNotMatch(read("homeView.tsx"), /IntelligenceMotionField|intelligenceHero/);
  assert.match(read("liveReadinessMonitorView.tsx"), /<FieldHeader model=\{buildLiveFieldHeader\(snapshot, unavailableReason, unavailableKind\)\}/);
  assert.match(read("moreMenuView.tsx"), /fieldPalette\.void/);
  const header = read("fieldHeader.tsx");
  assert.match(header, /reducedMotion !== false \|\| !changed/);
  assert.doesNotMatch(header, /Animated\.loop/);
});

test("the app-wide default theme is the field preset in both modes", () => {
  const read = (file) => fs.readFileSync(path.join(root, "apps/mobile/src", file), "utf8");
  const provider = read("ThemeProvider.tsx");
  assert.match(provider, /CURRENT_DEFAULT_PRESET: DesignPresetName = "field"/);
  assert.match(provider, /DESIGN_PRESET_SCHEMA_VERSION = "3"/);
  const design = read("designSystem.ts");
  assert.match(design, /export type DesignPresetName = "field";/);
  assert.match(design, /dark: fieldSurface,\s*light: fieldSurface,/);
  assert.match(design, /background: "#010204"/);
});

test("field typography is bundled with its OFL licence and only requested on Android", () => {
  const fontsDir = path.join(root, "apps/mobile/android/app/src/main/assets/fonts");
  for (const file of ["Sora_300Light.ttf", "Sora_400Regular.ttf", "Sora_600SemiBold.ttf", "IBMPlexMono_400Regular.ttf", "IBMPlexMono_500Medium.ttf"]) assert.ok(fs.existsSync(path.join(fontsDir, file)), file);
  for (const licence of ["OFL-Sora.txt", "OFL-IBMPlexMono.txt"]) assert.match(fs.readFileSync(path.join(fontsDir, licence), "utf8"), /SIL Open Font License, Version 1\.1/);
  const fonts = fs.readFileSync(path.join(root, "apps/mobile/src/fieldFonts.tsx"), "utf8");
  assert.match(fonts, /const android = Platform\.OS === "android"/);
});

test("tab changes use a state-change-only field transition and no heavy legacy weights remain", () => {
  const app = fs.readFileSync(path.join(root, "apps/mobile/App.tsx"), "utf8");
  assert.match(app, /<TabTransition transitionKey=\{/);
  const transition = fs.readFileSync(path.join(root, "apps/mobile/src/tabTransition.tsx"), "utf8");
  assert.match(transition, /reducedMotion !== false \|\| !changed/);
  assert.doesNotMatch(transition, /Animated\.loop/);
  for (const file of fs.readdirSync(path.join(root, "apps/mobile/src")).filter((name) => name.endsWith(".tsx"))) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, "apps/mobile/src", file), "utf8"), /fontWeight: "(800|900)"/, file);
  }
});

test("header pose follows the HOME grammar and never collapses a healthy tab", () => {
  const halted = buildPaperFieldHeader(paper({ status: "HALTED" }));
  assert.equal(fieldHeaderPose(halted).spread, 0.3);
  const offline = buildPaperFieldHeader(paper({ dataSource: "UNAVAILABLE" }));
  assert.ok(fieldHeaderPose(offline).presence < 0.5);
  const unverified = buildPaperFieldHeader(paper({ dataSource: "LOCAL_FALLBACK" }));
  assert.ok(fieldHeaderPose(unverified).presence < 0.5);
  assert.deepEqual({ ...fieldHeaderPose(buildPaperFieldHeader(paper())) }, { spread: 1, presence: 1 });
  assert.deepEqual({ ...fieldHeaderPose(buildLiveFieldHeader(live())) }, { spread: 1, presence: 1 });
  const header = fs.readFileSync(path.join(root, "apps/mobile/src/fieldHeader.tsx"), "utf8");
  assert.match(header, /const sealed = model\.eyebrow === "LIVE" && model\.statusWord === "SEALED"/);
});

test("PAPER and LIVE headers draw the HOME attractor, still and tinted by state", () => {
  const header = fs.readFileSync(path.join(root, "apps/mobile/src/fieldHeader.tsx"), "utf8");
  assert.match(header, /<AttractorField decisionCount=\{null\} fillCount=\{null\} tone=\{model\.tone === "red" \? "halt"/);
  assert.doesNotMatch(header, /buildFieldGeometry|buildStrandPaths|ContourCore/);
});

test("PAPER body does not repeat the header status band and keeps the read-only marker", () => {
  const view = fs.readFileSync(path.join(root, "apps/mobile/src/paperLearningMonitorView.tsx"), "utf8");
  assert.doesNotMatch(view, /<AuthorityRail|<ScreenLead/);
  assert.match(view, /testID="paper-learning-read-only-label">PAPER LEARNING · READ ONLY</);
  const os = fs.readFileSync(path.join(root, "apps/mobile/src/intelligenceOs.tsx"), "utf8");
  assert.doesNotMatch(os, /metricStrip: \{[^}]*borderRadius/);
});

test("More title carries the still attractor mark", () => {
  const view = fs.readFileSync(path.join(root, "apps/mobile/src/moreMenuView.tsx"), "utf8");
  assert.match(view, /<AttractorField decisionCount=\{null\} fillCount=\{null\} tone="normal" reducedMotion size=\{34\}/);
});

test("PAPER risk and source words are plain Korean and fail closed", () => {
  const { paperRiskWord, paperSourceWord } = shim.exports;
  assert.equal(paperRiskWord(null), "확인 불가");
  assert.equal(paperRiskWord("PASS"), "통과");
  assert.equal(paperRiskWord("BLOCKED_BY_LIMIT"), "차단");
  assert.equal(paperRiskWord("REVIEW"), "주의");
  assert.equal(paperSourceWord("SERVER_STREAM"), "서버 실시간");
  assert.equal(paperSourceWord("LOCAL_FALLBACK"), "기기 대체 관측");
  assert.equal(paperSourceWord("UNAVAILABLE"), "확인 필요");
});

test("LIVE unavailable states lead with what to do, never with a raw exception", () => {
  const { liveUnavailableMessage } = shim.exports;
  const failed = buildLiveFieldHeader(null, "Property 'structuredClone' doesn't exist");
  assert.doesNotMatch(failed.detail, /structuredClone/);
  assert.equal(failed.detail, liveUnavailableMessage("FAILED"));
  assert.equal(failed.facts[0].label, "실거래 권한");
  const setup = buildLiveFieldHeader(null, "PAPER endpoint must be verified before LIVE readiness reads.", "SETUP");
  assert.match(setup.detail, /설정에서 서버를 연결하세요/);
  assert.doesNotMatch(setup.detail, /잠시 후 다시/);
  assert.equal(buildLiveFieldHeader(null, "pending", "PENDING").detail, "서버 상태를 확인하는 중입니다.");
});
