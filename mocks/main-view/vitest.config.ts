import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Test runner config. Kept separate from vite.config.ts so dev/build
// stays minimal and the test environment is explicit.
//
// Engine tests are pure-function and run under the default 'node' env.
// Component / UC integration tests use jsdom — opt in per-file via
// the `// @vitest-environment jsdom` directive, OR by living under
// src/components/ (which the `environmentMatchGlobs` setting covers).
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    // Default env. Pure engine/store tests don't care; DOM tests need
    // jsdom. Files that want a faster pure-node env can declare it
    // per-file with `// @vitest-environment node` at the top.
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/main.tsx',
        'src/test/**',
        'src/**/*.test.{ts,tsx}',
        'src/seed.ts',
      ],
    },
  },
});
