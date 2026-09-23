"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "marketsView.tsx"), "utf8");

test("Markets uses observation-first navigation language and authority framing", () => {
  assert.match(source, /testID="markets-authority-rail"/);
  assert.match(source, /PUBLIC READ ONLY · PAPER SEPARATE · AI ZERO AUTHORITY/);
  // The board replaced the command hero with a reference header. The observation framing moved
  // into that header's subtitle, and it names the real scope: Upbit KRW public markets.
  assert.match(source, /testID="market-reference-header"/);
  assert.match(source, /Upbit KRW public markets at a glance/);
  assert.doesNotMatch(source, /Global markets/);
  assert.match(source, /UPBIT PUBLIC · VERIFIED/);
  // The summary strip was replaced by the authority rail, which carries the same declaration. It
  // must render in full: clamped to one line it read "PUBLIC READ ONLY · PAPER SEP…" on a 360dp
  // phone, dropping AI ZERO AUTHORITY off the end of a safety claim.
  const os = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "intelligenceOs.tsx"), "utf8");
  assert.match(os, /styles\.authorityDetail[^>]*\]\}>\{detail\}/);
  assert.doesNotMatch(os, /styles\.authorityDetail[^>]*\]\} numberOfLines=\{1\}/);
  assert.match(os, /authorityBrandRow: \{ flexWrap: "wrap"/);
  assert.match(source, /segment\("CHART", "차트", "markets-chart-tab"\)/);
  assert.match(source, /segment\("WATCHLIST", "시장 목록", "markets-watchlist-tab"\)/);
  assert.match(source, /backgroundColor: pressed \? theme\.colors\.primarySoft : "transparent"/);
  assert.match(source, /borderBottomColor: selected \? theme\.colors\.primary : "transparent"/);
  assert.doesNotMatch(source, /backgroundColor: selected \? theme\.colors\.primarySoft : "transparent"/);
});

test("Markets makes verified public terrain the visual hero without inventing prediction semantics", () => {
  assert.match(source, /function MarketTerrain/);
  assert.match(source, /testID="markets-terrain"/);
  assert.match(source, /MARKET TERRAIN/);
  assert.match(source, /VERIFIED UPBIT PUBLIC MOVE · NO PREDICTION/);
  assert.match(source, /<TerrainSignal variant="market" signalStrength=\{strength\}/);
  assert.match(source, /item\.market\.replace\("KRW-",\s*""\)/);
  assert.match(source, /rate\(item\.changeRate\)/);
  assert.doesNotMatch(source, /Risk|Neutral|Opportunity|confidence score|profit probability/i);
});

test("Markets does not overclaim that a selected market is an AI decision or PAPER symbol", () => {
  assert.match(source, /testID="market-observation-context"/);
  assert.match(source, /시장 관측과 PAPER 판단은 분리됩니다/);
  assert.match(source, /공개 시세는 읽기 전용입니다\. 이 데이터만으로 전략 신호나 주문 권한이 생기지 않습니다/);
  assert.doesNotMatch(source, /PUBLIC OBSERVATION/);
  assert.doesNotMatch(source, /AI CONFIDENCE|PROFIT PROBABILITY/);
});

test("the MARKETS hero cannot push its source badge off the right edge", () => {
  // Verified against a rendered Pixel 6 frame, not inferred: on f020102d the badge read
  // "UPBIT PUBLI" because heroTitle carried maxWidth 330 while the row is ~320dp wide on a 360dp
  // screen, so the lead column claimed more than the row had and the badge overflowed the screen.
  // The hero was replaced, but the overflow class is the same: a lead column that can claim more
  // than the row has, beside a source badge that can then be squeezed off the edge.
  assert.doesNotMatch(source, /marketReferenceTitle:\{[^}]*maxWidth:/);
  assert.match(source, /marketReferenceHeader:\{[^}]*flexWrap:"wrap"/);
  assert.match(source, /marketReferenceLead: \{ flex: 1, minWidth: 0 \}/);
  assert.match(source, /marketReferenceSource:\{[^}]*flexShrink:0/);
  assert.match(source, /<View style=\{styles\.marketReferenceLead\}>/);
  // The same class of overflow on the terrain header, fixed earlier and kept fixed.
  assert.match(source, /terrainHeaderLead: \{ flex: 1, minWidth: 0 \}/);
  assert.match(source, /terrainSource: \{[^}]*flexShrink: 0/);
});
