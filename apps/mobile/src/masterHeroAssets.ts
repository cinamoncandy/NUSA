export const MASTER_VISUAL_ASSET_NOTE = "Decorative assets from user-approved MASTER; no market or authority semantics.";

export const masterHeroAssets = Object.freeze({
  // homePlanet is intentionally absent. The supplied home-planet.jpg carried a JFIF header and an
  // EOI marker but no SOF segment, so it had no frame and no dimensions: Metro rejected it with
  // "Invalid jpg image asset" and the Android bundle could not be built at all. Nothing rendered
  // it, so HOME keeps its painted hero and no screen changed. Restore this entry together with a
  // decodable image; tests/mobile-master-hero-assets.test.js checks every registered asset decodes.
  marketGlobe: require("../assets/master/market-globe.jpg"),
  signalTerrain: require("../assets/master/signal-terrain.jpg"),
  signalDetail: require("../assets/master/signal-detail.jpg"),
  riskSphere: require("../assets/master/risk-sphere.jpg"),
  moreLandscape: require("../assets/master/more-landscape.jpg"),
});

export type MasterHeroAssetKey = keyof typeof masterHeroAssets;
