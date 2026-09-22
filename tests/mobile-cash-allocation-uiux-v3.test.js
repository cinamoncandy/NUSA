const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = (relative) => fs.readFileSync(path.join(__dirname, "..", relative), "utf8");

test("cash allocation remains a first-class PAPER contract without cluttering canonical HOME", () => {
  const settings = read("apps/mobile/src/settings.ts");
  const guard = read("apps/mobile/src/capitalAllocationGuard.ts");
  const app = read("apps/mobile/App.tsx");
  const home = read("apps/mobile/src/homeView.tsx");
  const portfolio = read("apps/mobile/src/portfolioView.tsx");
  const client = read("apps/mobile/src/cloudInvestmentAllocationClient.ts");

  assert.match(settings, /capitalAllocation/);
  assert.match(settings, /investmentPercent: 100/);
  assert.match(settings, /normalizeInvestmentPercent/);
  assert.match(guard, /createCashInvestmentEnvelope/);
  assert.match(guard, /investableCash/);
  assert.match(guard, /reservedCash/);

  assert.match(client, /\/api\/settings\/investment-allocation/);
  assert.match(client, /isPaperConnectionVerified/);
  assert.match(client, /PAPER connection changed while investment allocation/);
  assert.doesNotMatch(client, /EXPO_PUBLIC_NUSA_MONITOR_URL|127\.0\.0\.1:41731/);

  assert.match(app, /const \[investmentPercent, setInvestmentPercent\]/);
  assert.match(app, /onCloudInvestmentPercentSave=\{investmentAllocationClient\.save\}/);
  assert.doesNotMatch(app, /StatusChip label=\{`투자 \$\{investmentPercent\}%`\}/);
  assert.match(app, /investmentPercent=\{investmentPercent\}/);
  assert.match(home, /readonly investmentPercent: number/);
  assert.match(home, /testID="account-hero-card"/);
  assert.match(home, /PAPER Equity/);
  assert.match(home, /testID="home-system-status"/);
  assert.doesNotMatch(home, /testID="home-investable-cash"|testID="home-reserved-cash"|testID="home-capital-limits"/);
  assert.match(portfolio, /portfolio-investable-cash/);
});

test("allocation changes cannot grant LIVE or production authority", () => {
  for (const relative of ["apps/mobile/App.tsx", "apps/mobile/src/settingsView.tsx"]) {
    const source = read(relative);
    assert.doesNotMatch(source, /productionMutationAllowed:\s*true|liveAuthority\s*=\s*["'](?!NONE)/);
  }
});
