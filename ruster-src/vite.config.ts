import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// GitHub Pages (legacy, Jekyll) drops anything starting with "_".
const stripLeadingUnderscores = (name: string): string => name.replace(/^_+/, '');

export default defineConfig({
  base: '/ruster/',
  build: {
    outDir: fileURLToPath(new URL('../ruster', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
        sanitizeFileName: stripLeadingUnderscores,
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'jsdom',
  },
});
