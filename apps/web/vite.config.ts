import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { getDataDir, getServerPort } from '#config';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  // Runtime cache follows the same project-local data directory as DB/media/profiles.
  cacheDir: join(getDataDir(), 'cache', 'vite'),
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${getServerPort()}` },
  },
  // Preview is a local development check, not production hosting.
  preview: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${getServerPort()}` },
  },
  build: { outDir: join(root, 'dist'), emptyOutDir: true },
});
