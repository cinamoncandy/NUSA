export default [
  {
    ignores: ["dist/**", "node_modules/**"]
  },
  {
    files: ["apps/desktop/renderer/**/*.js"],
    ignores: ["apps/desktop/renderer/components/**/*.stories.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        document: "readonly",
        window: "readonly",
        Element: "readonly",
        HTMLDialogElement: "readonly",
        HTMLInputElement: "readonly",
        HTMLTextAreaElement: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        getComputedStyle: "readonly"
      }
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
      "no-var": "error",
      "prefer-const": "error"
    }
  },
  {
    files: ["apps/desktop/renderer/components/**/*.stories.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module"
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
      "no-var": "error",
      "prefer-const": "error"
    }
  }
];
