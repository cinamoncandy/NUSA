import { describe, expect, it } from "vitest";
import fs from "node:fs";

const app = fs.readFileSync("apps/mobile/App.tsx", "utf8");
const themeProvider = fs.readFileSync("apps/mobile/src/ThemeProvider.tsx", "utf8");
const androidTheme = fs.readFileSync("apps/mobile/src/androidInstitutionalTheme.ts", "utf8");
const homeRouter = fs.readFileSync("apps/mobile/src/homeView.tsx", "utf8");
const androidA = fs.readFileSync("apps/mobile/src/androidAHomeView.tsx", "utf8");
const androidB = fs.readFileSync("apps/mobile/src/androidBHomeView.tsx", "utf8");
const androidC = fs.readFileSync("apps/mobile/src/androidCHomeView.tsx", "utf8");
const androidD = fs.readFileSync("apps/mobile/src/androidDHomeView.tsx", "utf8");
const aiRouter = fs.readFileSync("apps/mobile/src/aiView.tsx", "utf8");
const androidAi = fs.readFileSync("apps/mobile/src/androidNusaDecisionView.tsx", "utf8");
const markets = fs.readFileSync("apps/mobile/src/marketsView.tsx", "utf8");
const nativeTheme = fs.readFileSync("apps/mobile/android/app/src/main/res/values/styles.xml", "utf8");
const nativeColors = fs.readFileSync("apps/mobile/android/app/src/main/res/values/colors.xml", "utf8");

describe("Android selected physical-device concept D", () => {
  it("routes D only on Android while preserving comparison references and legacy iOS surfaces", () => {
    expect(themeProvider).toContain('Platform.OS === "android" ? applyAndroidInstitutionalTheme(base) : base');
    expect(homeRouter).toContain('Platform.OS === "android"');
    expect(homeRouter).toContain("AndroidDHomeView");
    expect(homeRouter).not.toContain("AndroidAHomeView");
    expect(homeRouter).not.toContain("AndroidBHomeView");
    expect(homeRouter).not.toContain("AndroidCHomeView");
    expect(androidA).toContain("ANDROID · A");
    expect(androidB).toContain("PAPER · B");
    expect(androidC).toContain("android-c-now");
    expect(aiRouter).toContain('Platform.OS === "android"');
    expect(aiRouter).toContain("AndroidNusaDecisionView");
    expect(homeRouter).toContain("LegacyHomeView");
    expect(aiRouter).toContain("LegacyAiView");
  });

  it("implements the selected bright pearl supervisory reference", () => {
    expect(androidD).toContain("AI SUPERVISORY OS");
    expect(androidD).toContain("YOU ARE SUPERVISOR");
    expect(androidD).toContain("CAPITAL OVERVIEW");
    expect(androidD).toContain("NUSA JUDGMENT");
    expect(androidD).toContain("EVIDENCE STREAM");
    expect(androidD).toContain("OWNER COMMAND");
    expect(androidD).toContain("useWindowDimensions");
    expect(androidD).toContain("fontScale >= 1.35");
    expect(androidTheme).toContain('mode: "light"');
    expect(androidTheme).toContain('background: "#F5F7FB"');
    expect(androidTheme).toContain('primary: "#24B99E"');
    expect(androidTheme).toContain('navSurface: "#FBFCFF"');
  });

  it("uses the Android five-destination supervisory navigation while iOS retains legacy tabs", () => {
    expect(app).toContain('const androidTabs = ["Home", "Markets", "AiSignal", "Portfolio", "Control"] as const');
    expect(app).toContain('Home: "NOW"');
    expect(app).toContain('Markets: "MARKET"');
    expect(app).toContain('AiSignal: "NUSA"');
    expect(app).toContain('Portfolio: "ASSETS"');
    expect(app).toContain('Control: "CONTROL"');
    expect(app).toContain('Platform.OS === "android"');
    expect(app).toContain('setUtilityView("SETTINGS")');
    expect(app).toContain('const tabs = ["Home", "Markets", "Paper", "Portfolio"] as const');
  });

  it("does not fabricate unavailable financial or authority truth", () => {
    expect(androidD).toContain('ai?.calibrationStatus === "CALIBRATED"');
    expect(androidD).toContain("canonical AI projection에 전용 invalidation 필드가 없어 조건을 임의 생성하지 않습니다");
    expect(androidD).toContain("PAPER ONLY");
    expect(androidD).toContain("LIVE NONE");
    expect(androidD).toContain("AI ZERO AUTHORITY");
    expect(androidAi).toContain("KEY EVIDENCE");
    expect(androidAi).toContain("COUNTER EVIDENCE");
    for (const source of [androidTheme, androidA, androidB, androidC, androidD, androidAi]) {
      for (const forbidden of ["submitOrder", "productionMutationAllowed = true", "liveAuthority =", "credentialProvider", "axios", "WebSocket("]) {
        expect(source).not.toContain(forbidden);
      }
    }
  });

  it("preserves the Android interaction floor and light native chrome", () => {
    expect(markets).toContain("minHeight: androidInstitutional ? 48 : 48");
    expect(androidD).toContain("minHeight: 48");
    expect(nativeTheme).toContain("android:windowBackground");
    expect(nativeTheme).toContain("android:windowLightStatusBar\">true");
    expect(nativeTheme).toContain("android:windowLightNavigationBar\">true");
    expect(nativeColors).toContain('<color name="nusa_accent">#24B99E</color>');
    expect(nativeColors).toContain('<color name="nusa_window_background">#F5F7FB</color>');
  });
});
