import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The collector serves the built files from dist/. During development, run the
// collector and proxy API calls to it.
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
    assetsInlineLimit: 0,
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:7391' },
  },
});
