import React from "react";
import { AppRegistry, StyleSheet, Text, View } from "react-native";
import App from "./App";
import { AppErrorBoundary } from "./src/AppErrorBoundary";
import { BUILD_SOURCE_SHA } from "./src/generatedBuildConfig";
import { name as appName } from "./app.json";

const shortBuildSha = BUILD_SOURCE_SHA && BUILD_SOURCE_SHA !== "unprepared"
  ? BUILD_SOURCE_SHA.slice(0, 8)
  : "DEV";

function Root() {
  return <AppErrorBoundary>
    <View style={styles.root}>
      <App />
      <View pointerEvents="none" style={styles.runtimeFingerprint} testID="runtime-build-fingerprint">
        <Text style={styles.runtimeFingerprintText}>NUSA BUILD {shortBuildSha}</Text>
      </View>
    </View>
  </AppErrorBoundary>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  runtimeFingerprint: {
    position: "absolute",
    top: 4,
    left: 4,
    zIndex: 10000,
    elevation: 10000,
    borderRadius: 4,
    backgroundColor: "rgba(0,0,0,0.78)",
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  runtimeFingerprintText: {
    color: "#ffffff",
    fontSize: 8,
    lineHeight: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
});

AppRegistry.registerComponent(appName, () => Root);
