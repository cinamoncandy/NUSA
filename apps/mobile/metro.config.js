const path = require("node:path");
const { getDefaultConfig } = require("@react-native/metro-config");

const config = getDefaultConfig(__dirname);

module.exports = {
  ...config,
  watchFolders: [path.resolve(__dirname, "../..")],
  resolver: {
    ...config.resolver,
    nodeModulesPaths: [path.resolve(__dirname, "node_modules"), path.resolve(__dirname, "../../node_modules")],
    extraNodeModules: {
      ...config.resolver.extraNodeModules,
      "@babel/runtime": path.resolve(__dirname, "node_modules/@babel/runtime"),
    },
    unstable_enableSymlinks: true,
  },
};
