// eslint.config.js
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import unicorn from "eslint-plugin-unicorn";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "public/**",
      "build/**",
      ".next/**",
      "out/**",
      "test-results/**",
      "playwright-report/**",
      "*.min.js",
      "*.min.css",
      "full_test_output.log",
      "temp/**",
      "*.sqlite",
      "*.db",
      ".vscode/**",
      ".idea/**",
      ".DS_Store",
      "*.swp",
      "*.swo",
      "*~",
      ".env",
      ".env.local",
      ".env.*.local",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: ["./tsconfig.json", "./tsconfig.eslint.json"],
        tsconfigRootDir: __dirname,
      },
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
      "@typescript-eslint/prefer-readonly": "error",
      "unicorn/prefer-number-properties": "error",
      "unicorn/prefer-at": "error",
      "unicorn/prefer-string-slice": "error",
      "unicorn/prefer-node-protocol": "error",
      "unicorn/prefer-string-raw": "error",
    },
  },
];
