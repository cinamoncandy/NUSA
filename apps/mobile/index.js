import React from "react";
import { AppRegistry, StyleSheet, Text, View } from "react-native";
import App from "./App";
import { AppErrorBoundary } from "./src/AppErrorBoundary";
import { RUNTIME_BUILD_IDENTITY } from "./src/runtimeBuildIdentity";
import { name as appName } from "./app.json";

function Root() {
  return <AppErrorBoundary>
    <View style={styles.root}>
      <App />
      <View pointerEvents="none" style={styles.runtimeBadge} testID="runtime-build-identity">
        <Text style={styles.runtimeBadgeText}>{RUNTIME_BUILD_IDENTITY}</Text>
      </View>
    </View>
  </AppErrorBoundary>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  runtimeBadge: {
    position: "absolute",
    top: 2,
    left: 6,
    zIndex: 9999,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  runtimeBadgeText: { color: "#fff", fontSize: 8, fontWeight: "700" },
});

AppRegistry.registerComponent(appName, () => Root);
