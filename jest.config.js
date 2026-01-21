export default {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  roots: ["<rootDir>/tests"],
  setupFilesAfterEnv: ["<rootDir>/tests/setup.ts"],
  coveragePathIgnorePatterns: ["<rootDir>/server/services/sandbox-runner.ts"],
  moduleNameMapper: {
    // ← Richtig (mit "r")
    "^@/(.*)$": "<rootDir>/client/src/$1",
    "^@shared/(.*)$": "<rootDir>/shared/$1",
  },
};
