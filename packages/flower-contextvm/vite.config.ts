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
  },
});
