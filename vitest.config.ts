import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import path from 'node:path';

const __dirname = path.resolve();

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'shared'),
      '@': path.resolve(__dirname, 'client', 'src'),
      'monaco-editor': path.resolve(__dirname, 'tests', 'mocks', 'monaco-editor.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        // Use in-memory storage instead of file-based to avoid --localstorage-file warning
        // This ensures localStorage is not persisted to disk during tests
        url: 'http://localhost',
        storageQuota: 10000000, // 10MB quota
        pretendToBeVisual: true,
      },
    },
    setupFiles: ['./tests/setup.ts'],
    threads: false,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc}.config.*',
      'e2e/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html', 'lcov'],
      reportBase: 'coverage',
      exclude: [
        'tests/**',
        'e2e/**',
        '**/node_modules/**',
        '**/dist/**',
      ],
    },
    // Policy-Konformität: Flush-on-Failure Mechanismus
    // Bei Test-Fehlschlag wird Debug-Buffer auf Konsole geflushert
    silent: false,
    testTimeout: 30000,
    hookTimeout: 10000,
  },
});