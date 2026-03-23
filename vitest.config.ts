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
    },
    // Policy-Konformität: Flush-on-Failure Mechanismus
    // Bei Test-Fehlschlag wird Debug-Buffer auf Konsole geflushert
    silent: false,
    testTimeout: 30000,
    hookTimeout: 10000,
  },
});