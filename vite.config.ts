import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const SERVER_PORT = process.env.PORT || 3001;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'client/src'),
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: `http://localhost:${SERVER_PORT}`, changeOrigin: true },
      '/ws': { target: `ws://localhost:${SERVER_PORT}`, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
