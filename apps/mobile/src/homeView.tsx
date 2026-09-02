import React from "react";
import { Platform } from "react-native";
import { AndroidReferenceHomeView } from "./androidReferenceHomeView";
import { HomeView as LegacyHomeView } from "./homeViewLegacy";

export type { HomeDestination } from "./homeViewLegacy";

export function HomeView(props: React.ComponentProps<typeof LegacyHomeView>) {
  return Platform.OS === "android"
    ? <AndroidReferenceHomeView {...props} />
    : <LegacyHomeView {...props} />;
}
