import { describe, expect, it } from "vitest";
import fs from "node:fs";

const themeProvider = fs.readFileSync("apps/mobile/src/ThemeProvider.tsx", "utf8");
const androidTheme = fs.readFileSync("apps/mobile/src/androidInstitutionalTheme.ts", "utf8");
const homeRouter = fs.readFileSync("apps/mobile/src/homeView.tsx", "utf8");
const androidHome = fs.readFileSync("apps/mobile/src/androidReferenceHomeView.tsx", "utf8");
const aiRouter = fs.readFileSync("apps/mobile/src/aiView.tsx", "utf8");
const androidAi = fs.readFileSync("apps/mobile/src/androidReferenceAiView.tsx", "utf8");
const markets = fs.readFileSync("apps/mobile/src/marketsView.tsx", "utf8");
const nativeTheme = fs.readFileSync("apps/mobile/android/app/src/main/res/values/styles.xml", "utf8");
const nativeColors = fs.readFileSync("apps/mobile/android/app/src/main/res/values/colors.xml", "utf8");

describe("Android editorial investment OS reference", () => {
  it("routes the new reference surfaces only on Android", () => {
    expect(themeProvider).toContain('Platform.OS === "android" ? applyAndroidInstitutionalTheme(base) : base');
    expect(homeRouter).toContain('Platform.OS === "android"');
    expect(homeRouter).toContain("AndroidReferenceHomeView");
    expect(aiRouter).toContain('Platform.OS === "android"');
    expect(aiRouter).toContain("AndroidReferenceAiView");
    expect(homeRouter).toContain("LegacyHomeView");
    expect(aiRouter).toContain("LegacyAiView");
  });

  it("uses the approved luxury editorial palette instead of neon dashboard chrome", () => {
    expect(androidTheme).toContain('background: dark ? "#020405"');
    expect(androidTheme).toContain('text: dark ? "#E7E2DA"');
    expect(androidTheme).toContain('primary: dark ? "#0BB8B0"');
    expect(androidTheme).toContain('warning: dark ? "#C89236"');
    expect(androidTheme).toContain('danger: dark ? "#D75F65"');
    expect(androidTheme).toContain('rgba(11, 184, 176, 0.06)');
  });

  it("implements asset state, decision stage, evidence and authority without inventing unavailable finance truth", () => {
    expect(androidHome).toContain("ASSET STATE");
    expect(androidHome).toContain("DECISION STAGE");
    expect(androidHome).toContain("canonical risk score");
    expect(androidHome).toContain("그래프를 임의 생성하지 않습니다");
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
    expect(androidHome).toContain("minHeight: 52");
    expect(nativeTheme).toContain("android:windowBackground");
    expect(nativeTheme).toContain("android:statusBarColor");
    expect(nativeTheme).toContain("android:navigationBarColor");
    expect(nativeColors).toContain('<color name="nusa_accent">#0BB8B0</color>');
  });
});
