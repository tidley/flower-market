import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'flowerRuntime',
      fileName: (format) => `flower-runtime.${format}.js`,
    },
    rollupOptions: {
      external: [],
      output: { globals: {} },
    },
    outDir: 'dist',
  },
  test: {
    environment: 'node',
  },
});
