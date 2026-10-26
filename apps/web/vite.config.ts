import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  // Giữ cache ngoài OneDrive để tránh đồng bộ file tạm
  cacheDir: process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'AutoPostMKT', 'cache', 'vite') : undefined,
  server: { host: '127.0.0.1', strictPort: true },
  build: { outDir: join(root, 'dist'), emptyOutDir: true },
});
