import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // mupdf and wasm-vips use top-level await; modern browsers support it.
  build: {
    target: 'esnext',
  },
  esbuild: {
    target: 'esnext',
  },
  optimizeDeps: {
    exclude: ['wasm-vips', 'mupdf'],
    esbuildOptions: { target: 'esnext' },
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
