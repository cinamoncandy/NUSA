import React from "react";
import { Platform } from "react-native";
import { AndroidNusaDecisionView } from "./androidNusaDecisionView";
import { AiView as LegacyAiView } from "./aiViewLegacy";

export function AiView(props: React.ComponentProps<typeof LegacyAiView>) {
  return Platform.OS === "android"
    ? <AndroidNusaDecisionView {...props} />
    : <LegacyAiView {...props} />;
}
