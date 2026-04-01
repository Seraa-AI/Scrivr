import react from '@vitejs/plugin-react';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import mdx from 'fumadocs-mdx/vite';
import { nitro } from 'nitro/vite';
import { resolve } from 'path';

export default defineConfig({
  server: {
    port: 3000,
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
      preset: 'vercel',
    }),
  ],
  resolve: {
    tsconfigPaths: true,
    alias: {
      tslib: 'tslib/tslib.es6.js',
      '@scrivr/core': resolve(__dirname, '../../packages/core/src/index.ts'),
      '@scrivr/plugins': resolve(__dirname, '../../packages/plugins/src/index.ts'),
      '@scrivr/export': resolve(__dirname, '../../packages/export/src/index.ts'),
      '@scrivr/react': resolve(__dirname, '../../packages/react/src/index.ts'),
    },
  },
});
