/** @type {import('@storybook/web-components-vite').StorybookConfig} */
module.exports = {
  stories: ["../apps/desktop/renderer/components/**/*.stories.js"],
  addons: ["@storybook/addon-a11y"],
  framework: "@storybook/web-components-vite"
};
