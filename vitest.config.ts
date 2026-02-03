import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': '/Users/to/sciebo/TT_Web/UNOWEBSIM_github_dupe/shared',
      '@': '/Users/to/sciebo/TT_Web/UNOWEBSIM_github_dupe/client/src',
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