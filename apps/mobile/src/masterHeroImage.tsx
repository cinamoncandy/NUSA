import React from "react";
import { ImageBackground, StyleSheet, View, type ImageStyle, type StyleProp, type ViewStyle } from "react-native";
import { masterHeroAssets, type MasterHeroAssetKey } from "./masterHeroAssets";

interface MasterHeroImageProps {
  readonly asset: MasterHeroAssetKey;
  readonly children?: React.ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  readonly imageStyle?: StyleProp<ImageStyle>;
  readonly testID?: string;
  readonly scrimOpacity?: number;
}

export function MasterHeroImage({ asset, children, style, imageStyle, testID, scrimOpacity = 0.22 }: MasterHeroImageProps) {
  return <ImageBackground
    source={masterHeroAssets[asset]}
    resizeMode="cover"
    style={[styles.hero, style]}
    imageStyle={imageStyle}
    testID={testID}
  >
    <View pointerEvents="none" style={[styles.scrim, { opacity: scrimOpacity }]} />
    {children}
  </ImageBackground>;
}

const styles = StyleSheet.create({
  hero: { position: "relative", overflow: "hidden", backgroundColor: "#05080C" },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "#020509" },
});
