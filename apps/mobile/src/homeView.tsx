import React from "react";
import { Platform } from "react-native";
import { AndroidDHomeView } from "./androidDHomeView";
import { HomeView as LegacyHomeView } from "./homeViewLegacy";

export type { HomeDestination } from "./homeViewLegacy";

export function HomeView(props: React.ComponentProps<typeof LegacyHomeView>) {
  return Platform.OS === "android"
    ? <AndroidDHomeView {...props} />
    : <LegacyHomeView {...props} />;
}
