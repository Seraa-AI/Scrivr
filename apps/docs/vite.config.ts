import react from '@vitejs/plugin-react';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import mdx from 'fumadocs-mdx/vite';
import { nitro } from 'nitro/vite';
import { resolve } from 'path';

export default defineConfig({
  server: {
    port: 8000,
  },
  plugins: [
    mdx(await import('./source.config')),
    tailwindcss(),
    tanstackStart({
      prerender: {
        enabled: true,
      },
    }),
    react(),
    // please see https://tanstack.com/start/latest/docs/framework/react/guide/hosting#nitro for guides on hosting
    nitro({
      preset: 'node-server',
    }),
  ],
  resolve: {
    tsconfigPaths: true,
    alias: {
      tslib: 'tslib/tslib.es6.js',
      // Subpath exports must come BEFORE the bare-name alias — Vite resolves
      // aliases by prefix match in insertion order, and the bare-name alias
      // points at a file (index.ts), so without these explicit entries
      // `@scrivr/react/styles.css` would resolve to `src/index.ts/styles.css`
      // (ENOTDIR). Mirror every subpath export declared in the package.json.
      '@scrivr/react/styles.css': resolve(__dirname, '../../packages/react/src/styles.css'),
      '@scrivr/core': resolve(__dirname, '../../packages/core/src/index.ts'),
      '@scrivr/plugins': resolve(__dirname, '../../packages/plugins/src/index.ts'),
      '@scrivr/export-pdf': resolve(__dirname, '../../packages/export-pdf/src/index.ts'),
      '@scrivr/export-markdown': resolve(__dirname, '../../packages/export-markdown/src/index.ts'),
      '@scrivr/react': resolve(__dirname, '../../packages/react/src/index.ts'),
    },
  },
});
