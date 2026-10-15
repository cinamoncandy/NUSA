import { Platform } from "react-native";

/**
 * Field typography. Sora (display) and IBM Plex Mono (codes) are bundled for Android under
 * android/app/src/main/assets/fonts (SIL OFL 1.1). Other platforms fall back to the system font,
 * so an unregistered family is never requested.
 */
const android = Platform.OS === "android";

export const fieldFonts = Object.freeze({
  displayLight: android ? { fontFamily: "Sora_300Light" } : { fontWeight: "300" as const },
  display: android ? { fontFamily: "Sora_400Regular" } : { fontWeight: "400" as const },
  displayStrong: android ? { fontFamily: "Sora_600SemiBold" } : { fontWeight: "600" as const },
  mono: android ? { fontFamily: "IBMPlexMono_400Regular" } : {},
  monoMedium: android ? { fontFamily: "IBMPlexMono_500Medium" } : { fontWeight: "500" as const },
});
