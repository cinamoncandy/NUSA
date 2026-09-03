import { describe, expect, it } from "vitest";
import fs from "node:fs";

const themeProvider = fs.readFileSync("apps/mobile/src/ThemeProvider.tsx", "utf8");
const androidTheme = fs.readFileSync("apps/mobile/src/androidInstitutionalTheme.ts", "utf8");
const homeRouter = fs.readFileSync("apps/mobile/src/homeView.tsx", "utf8");
const androidHome = fs.readFileSync("apps/mobile/src/androidNowView.tsx", "utf8");
const aiRouter = fs.readFileSync("apps/mobile/src/aiView.tsx", "utf8");
const androidAi = fs.readFileSync("apps/mobile/src/androidNusaDecisionView.tsx", "utf8");
const markets = fs.readFileSync("apps/mobile/src/marketsView.tsx", "utf8");
const nativeTheme = fs.readFileSync("apps/mobile/android/app/src/main/res/values/styles.xml", "utf8");
const nativeColors = fs.readFileSync("apps/mobile/android/app/src/main/res/values/colors.xml", "utf8");

describe("Android temporary concept C", () => {
  it("routes concept C only on Android while preserving legacy iOS surfaces", () => {
    expect(themeProvider).toContain('Platform.OS === "android" ? applyAndroidInstitutionalTheme(base) : base');
    expect(homeRouter).toContain('Platform.OS === "android"');
    expect(homeRouter).toContain("AndroidNowView");
    expect(aiRouter).toContain('Platform.OS === "android"');
    expect(aiRouter).toContain("AndroidNusaDecisionView");
    expect(homeRouter).toContain("LegacyHomeView");
    expect(aiRouter).toContain("LegacyAiView");
  });

  it("implements the C supervisory hierarchy without fabricated finance truth", () => {
    expect(androidHome).toContain("SYSTEM TRUTH");
    expect(androidHome).toContain("지금 가장 중요한 것");
    expect(androidHome).toContain("핵심 근거");
    expect(androidHome).toContain("가장 강한 반대 근거");
    expect(androidHome).toContain("REAL CONSTRAINTS ONLY");
    expect(androidHome).toContain("TEMP C");
    expect(androidAi).toContain("KEY EVIDENCE");
    expect(androidAi).toContain("COUNTER EVIDENCE");
    expect(androidAi).toContain("전용 invalidation 필드가 없습니다");
    expect(androidAi).toContain("AI는 판단 보조이며 주문·이체·출금·운영 변경 권한이 없습니다");
  });

  it("keeps presentation overlays free of authority/runtime ownership", () => {
    for (const source of [androidTheme, androidHome, androidAi]) {
      for (const forbidden of ["submitOrder", "productionMutationAllowed = true", "liveAuthority =", "credentialProvider", "axios", "WebSocket("]) {
        expect(source).not.toContain(forbidden);
      }
    }
  });

  it("preserves the 48dp interaction floor and native Android chrome", () => {
    expect(markets).toContain("minHeight: androidInstitutional ? 48 : 48");
    expect(androidHome).toContain("minHeight: 48");
    expect(nativeTheme).toContain("android:windowBackground");
    expect(nativeTheme).toContain("android:statusBarColor");
    expect(nativeTheme).toContain("android:navigationBarColor");
    expect(nativeColors).toContain('<color name="nusa_accent">#0BB8B0</color>');
  });
});