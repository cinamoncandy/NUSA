const path = require("node:path");
const { getDefaultConfig } = require("@react-native/metro-config");

const config = getDefaultConfig(__dirname);

module.exports = {
  ...config,
  watchFolders: [path.resolve(__dirname, "../..")],
  resolver: {
    ...config.resolver,
    nodeModulesPaths: [path.resolve(__dirname, "node_modules")],
    unstable_enableSymlinks: true,
  },
};
