import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import path from 'path';

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
      reporter: ['text', 'json', 'html'],
    },
  },
});