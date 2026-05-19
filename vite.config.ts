import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: 'public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    // Include standalone pages (default Vite entry is only index.html).
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'public/index.html'),
        login: path.resolve(__dirname, 'public/login.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './public/src'),
      '@server': path.resolve(__dirname, './server')
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
});
