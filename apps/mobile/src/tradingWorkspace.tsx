import React from "react";
import { StyleSheet, View } from "react-native";
import { SegmentedControl } from "./uxPrimitives";

export type TradingSection = "Markets" | "Paper";

const SECTIONS: readonly Readonly<{ key: TradingSection; label: string; testID: string }>[] = Object.freeze([
  Object.freeze({ key: "Markets", label: "MARKETS · 시장", testID: "trading-section-Markets" }),
  Object.freeze({ key: "Paper", label: "PAPER", testID: "trading-section-Paper" }),
]);

export function isTradingSection(value: string): value is TradingSection {
  return value === "Markets" || value === "Paper";
}

/**
 * The single TRADING destination. It converges the former MARKETS and PAPER tabs by presentation
 * only: the section switch picks which existing screen (MarketsView or the PAPER TradingView)
 * renders, and each keeps its own data source -- public market observation and PAPER accounting
 * are never merged here. LIVE is deliberately not a section: it is its own destination.
 */
export function TradingWorkspace({ section, onSectionChange, children }: Readonly<{ section: TradingSection; onSectionChange: (section: TradingSection) => void; children: React.ReactNode }>) {
  return <View style={styles.workspace} testID="trading-workspace">
    <View style={styles.switcher}>
      <SegmentedControl
        items={SECTIONS}
        selectedKey={section}
        onChange={(key) => { if (isTradingSection(key)) onSectionChange(key); }}
        testID="trading-section-switch"
      />
    </View>
    <View style={styles.body}>{children}</View>
  </View>;
}

const styles = StyleSheet.create({
  workspace: { flex: 1 },
  switcher: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  body: { flex: 1 },
});
