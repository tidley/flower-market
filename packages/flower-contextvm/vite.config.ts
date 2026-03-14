import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'flowerContextvm',
      fileName: (format) => `flower-contextvm.${format}.js`,
    },
    rollupOptions: {
      external: [],
      output: { globals: {} },
    },
    outDir: 'dist',
  },
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 95,
        statements: 95,
      },
    },
  },
});
