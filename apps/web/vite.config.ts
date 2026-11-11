import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, rollupOptions:{output:{manualChunks:{react:['react','react-dom'],schema:['zod']}}} },
  server: { host: '127.0.0.1' },
});
