// eslint.config.js
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import unicorn from "eslint-plugin-unicorn";

export default [
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", "public/**"],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      unicorn,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
      "unicorn/prefer-number-properties": "error",
      "unicorn/prefer-at": "error",
      "unicorn/prefer-string-slice": "error",
      "unicorn/prefer-node-protocol": "error",
      "unicorn/prefer-string-raw": "error",
    },
  },
];
