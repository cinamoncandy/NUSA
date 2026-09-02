import React from "react";
import { Platform } from "react-native";
import { AndroidReferenceAiView } from "./androidReferenceAiView";
import { AiView as LegacyAiView } from "./aiViewLegacy";

export function AiView(props: React.ComponentProps<typeof LegacyAiView>) {
  return Platform.OS === "android"
    ? <AndroidReferenceAiView {...props} />
    : <LegacyAiView {...props} />;
}
