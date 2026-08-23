import React from "react";
import { AppRegistry } from "react-native";
import App from "./App";
import { AppErrorBoundary } from "./src/AppErrorBoundary";
import { name as appName } from "./app.json";

function Root() {
  return <AppErrorBoundary><App /></AppErrorBoundary>;
}

AppRegistry.registerComponent(appName, () => Root);
