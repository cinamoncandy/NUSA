import React from "react";
import { Platform } from "react-native";
import { AndroidAHomeView } from "./androidAHomeView";
import { HomeView as LegacyHomeView } from "./homeViewLegacy";

export type { HomeDestination } from "./homeViewLegacy";

export function HomeView(props: React.ComponentProps<typeof LegacyHomeView>) {
  return Platform.OS === "android"
    ? <AndroidAHomeView {...props} />
    : <LegacyHomeView {...props} />;
}
