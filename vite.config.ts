import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * Chrome Manifest V3 Build Configuration
 *
 * Content scripts cannot use ES module syntax (import/export).
 * We use format: 'iife' with inlineDynamicImports: true to produce a single
 * self-contained file per entry — no shared chunks, no export statements.
 *
 * The BUILD_ENTRY env var selects which entry to compile:
 *   BUILD_ENTRY=content  → dist/content.js
 *   BUILD_ENTRY=background → dist/background.js (default if unset)
 */
const entry = process.env.BUILD_ENTRY || 'background';

const entries = {
  content: {
    path: resolve(__dirname, 'src/content/index.ts'),
    name: 'MeetVaultContent',
    outFile: 'content.js',
  },
  background: {
    path: resolve(__dirname, 'src/background.ts'),
    name: 'MeetVaultBackground',
    outFile: 'background.js',
  },
};

const target = entries[entry] ?? entries.background;

export default defineConfig({
  build: {
    outDir: 'dist',
    // Only wipe dist on the first build (content); background appends after
    emptyOutDir: entry === 'content',
    target: 'chrome114',
    chunkSizeWarningLimit: 1500,
    lib: {
      entry: target.path,
      name: target.name,
      // iife = Immediately Invoked Function Expression
      // All imports are inlined; zero "export" keywords emitted.
      formats: ['iife'],
      fileName: () => target.outFile,
    },
  },
});
