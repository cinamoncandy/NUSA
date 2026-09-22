export const MASTER_VISUAL_ASSET_NOTE = "Decorative assets from user-approved MASTER; no market or authority semantics.";

export const masterHeroAssets = Object.freeze({
  homePlanet: require("../assets/master/home-planet.jpg"),
  marketGlobe: require("../assets/master/market-globe.jpg"),
  signalTerrain: require("../assets/master/signal-terrain.jpg"),
  signalDetail: require("../assets/master/signal-detail.jpg"),
  riskSphere: require("../assets/master/risk-sphere.jpg"),
  moreLandscape: require("../assets/master/more-landscape.jpg"),
});

export type MasterHeroAssetKey = keyof typeof masterHeroAssets;
