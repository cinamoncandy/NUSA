const path = require("node:path");
const { getDefaultConfig } = require("@react-native/metro-config");

const config = getDefaultConfig(__dirname);

module.exports = {
  ...config,
  watchFolders: [path.resolve(__dirname, "../..")],
  resolver: {
    ...config.resolver,
    unstable_enableSymlinks: true,
  },
};
