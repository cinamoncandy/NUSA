import { describe, expect, it } from "vitest";
import fs from "node:fs";

const app = fs.readFileSync("apps/mobile/App.tsx", "utf8");
const canonicalHome = fs.readFileSync("apps/mobile/src/homeView.tsx", "utf8");
const canonicalAi = fs.readFileSync("apps/mobile/src/aiView.tsx", "utf8");
const androidHome = fs.readFileSync("apps/mobile/src/androidDHomeView.tsx", "utf8");
const androidAi = fs.readFileSync("apps/mobile/src/androidNusaDecisionView.tsx", "utf8");
const themeProvider = fs.readFileSync("apps/mobile/src/ThemeProvider.tsx", "utf8");
const androidTheme = fs.readFileSync("apps/mobile/src/androidInstitutionalTheme.ts", "utf8");
const nativeTheme = fs.readFileSync("apps/mobile/android/app/src/main/res/values/styles.xml", "utf8");
const nativeColors = fs.readFileSync("apps/mobile/android/app/src/main/res/values/colors.xml", "utf8");

describe("Android D device-QA release candidate", () => {
  it("keeps latest main Home market-source safety while selecting D only on Android", () => {
    expect(canonicalHome).toContain("selectHomeMarketData(publicMarkets, snapshot?.markets ?? [])");
    expect(canonicalHome).toContain("publicMarkets: readonly WatchlistMarket[] | null");
    expect(app).toContain("publicMarkets={publicMarkets.markets}");
    expect(app).toContain('Platform.OS === "android"');
    expect(app).toContain("<AndroidDHomeView");
    expect(app).toContain("<HomeView");
    expect(app).toContain("<AndroidNusaDecisionView");
    expect(app).toContain("<AiView");
    expect(canonicalAi).toContain("AiReadOnlyProjection");
  });

  it("uses the Android supervisory five-destination navigation without promoting PAPER trading", () => {
    expect(app).toContain('const androidTabs = ["Home", "Markets", "AiSignal", "Portfolio", "Control"] as const');
    expect(app).toContain('Home: "NOW"');
    expect(app).toContain('Markets: "MARKET"');
    expect(app).toContain('AiSignal: "NUSA"');
    expect(app).toContain('Portfolio: "ASSETS"');
    expect(app).toContain('Control: "CONTROL"');
    expect(app).toContain('const tabs = ["Home", "Markets", "Paper", "Portfolio"] as const');
    expect(app).toContain("if (control) { setUtilityView(\"SETTINGS\"); return; }");
  });

  it("keeps financial and authority truth fail-closed", () => {
    expect(androidHome).toContain("PAPER ONLY");
    expect(androidHome).toContain("LIVE NONE");
    expect(androidHome).toContain("AI ZERO AUTHORITY");
    expect(androidHome).toContain("canonical AI projection에 전용 invalidation 필드가 없어 조건을 임의 생성하지 않습니다");
    expect(androidAi).toContain("AI AUTHORITY");
    expect(androidAi).toContain('value="ZERO"');
    expect(androidAi).toContain("주문·이체·출금·운영 변경 권한이 없습니다");
    expect(androidAi).toContain("전용 invalidation 필드가 없습니다");
    expect(androidHome).toContain('ai?.calibrationStatus === "CALIBRATED"');
    for (const source of [androidHome, androidAi, androidTheme]) {
      for (const forbidden of ["submitOrder", "productionMutationAllowed = true", "liveAuthority = \"LIVE\"", "withdraw(", "transfer(", "WebSocket("]) {
        expect(source).not.toContain(forbidden);
      }
    }
  });

  it("uses the selected bright physical-device visual language and accessible interaction floor", () => {
    expect(androidTheme).toContain('mode: "light"');
    expect(androidTheme).toContain('background: "#F5F7FB"');
    expect(androidTheme).toContain('primary: "#24B99E"');
    expect(themeProvider).toContain('barStyle={theme.mode === "dark" ? "light-content" : "dark-content"}');
    expect(androidHome).toContain("minHeight: 48");
    expect(androidHome).toContain("fontScale >= 1.35");
    expect(androidHome).toContain("StyleSheet.absoluteFill");
    expect(androidHome).not.toContain("StyleSheet.absoluteFillObject");
    expect(nativeTheme).toContain("android:windowLightStatusBar\">true");
    expect(nativeTheme).toContain("android:windowLightNavigationBar\">true");
    expect(nativeColors).toContain('<color name="nusa_accent">#24B99E</color>');
  });
});
