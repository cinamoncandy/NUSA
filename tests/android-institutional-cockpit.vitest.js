import { describe, expect, it } from "vitest";
import fs from "node:fs";

const themeProvider = fs.readFileSync("apps/mobile/src/ThemeProvider.tsx", "utf8");
const androidTheme = fs.readFileSync("apps/mobile/src/androidInstitutionalTheme.ts", "utf8");
const homeRouter = fs.readFileSync("apps/mobile/src/homeView.tsx", "utf8");
const androidA = fs.readFileSync("apps/mobile/src/androidAHomeView.tsx", "utf8");
const androidB = fs.readFileSync("apps/mobile/src/androidBHomeView.tsx", "utf8");
const androidC = fs.readFileSync("apps/mobile/src/androidCHomeView.tsx", "utf8");
const aiRouter = fs.readFileSync("apps/mobile/src/aiView.tsx", "utf8");
const androidAi = fs.readFileSync("apps/mobile/src/androidNusaDecisionView.tsx", "utf8");
const markets = fs.readFileSync("apps/mobile/src/marketsView.tsx", "utf8");
const nativeTheme = fs.readFileSync("apps/mobile/android/app/src/main/res/values/styles.xml", "utf8");
const nativeColors = fs.readFileSync("apps/mobile/android/app/src/main/res/values/colors.xml", "utf8");

describe("Android design concepts A, B and C", () => {
  it("routes concept C only on Android while retaining A/B references and legacy iOS surfaces", () => {
    expect(themeProvider).toContain('Platform.OS === "android" ? applyAndroidInstitutionalTheme(base) : base');
    expect(homeRouter).toContain('Platform.OS === "android"');
    expect(homeRouter).toContain("AndroidCHomeView");
    expect(homeRouter).not.toContain("AndroidAHomeView");
    expect(homeRouter).not.toContain("AndroidBHomeView");
    expect(androidA).toContain("ANDROID · A");
    expect(androidB).toContain("PAPER · B");
    expect(aiRouter).toContain('Platform.OS === "android"');
    expect(aiRouter).toContain("AndroidNusaDecisionView");
    expect(homeRouter).toContain("LegacyHomeView");
    expect(aiRouter).toContain("LegacyAiView");
  });

  it("implements C as a platform-grade expressive content-first surface", () => {
    expect(androidC).toContain("지금은 별도 조치가 필요하지 않습니다");
    expect(androidC).toContain("PAPER ONLY");
    expect(androidC).toContain("AI ZERO AUTHORITY");
    expect(androidC).toContain("검증 가능한 판단");
    expect(androidC).toContain("왜 그렇게 판단했는가");
    expect(androidC).toContain("OWNER ACTION");
    expect(androidC).toContain("borderBottomRightRadius: 12");
    expect(androidC).toContain("borderTopRightRadius: 12");
    expect(androidTheme).toContain('background: dark ? "#0B0D10"');
    expect(androidTheme).toContain('primary: dark ? "#65E0C2"');
    expect(androidTheme).toContain('navSurface: dark ? "#11151A"');
  });

  it("does not fabricate unavailable financial or authority truth", () => {
    expect(androidC).toContain("전용 invalidation 필드가 없어 조건을 임의 생성하지 않습니다");
    expect(androidC).toContain("PAPER ONLY");
    expect(androidC).toContain("AI ZERO AUTHORITY");
    expect(androidAi).toContain("KEY EVIDENCE");
    expect(androidAi).toContain("COUNTER EVIDENCE");
    for (const source of [androidTheme, androidA, androidB, androidC, androidAi]) {
      for (const forbidden of ["submitOrder", "productionMutationAllowed = true", "liveAuthority =", "credentialProvider", "axios", "WebSocket("]) {
        expect(source).not.toContain(forbidden);
      }
    }
  });

  it("preserves the Android interaction floor and native chrome", () => {
    expect(markets).toContain("minHeight: androidInstitutional ? 48 : 48");
    expect(androidC).toContain("minHeight: 48");
    expect(nativeTheme).toContain("android:windowBackground");
    expect(nativeTheme).toContain("android:statusBarColor");
    expect(nativeTheme).toContain("android:navigationBarColor");
    expect(nativeColors).toContain('<color name="nusa_accent">#65E0C2</color>');
  });
});
