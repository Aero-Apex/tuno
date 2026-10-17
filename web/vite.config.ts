import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Libraries change rarely, so they get their own long-cached chunk.
        manualChunks(id) {
          if (/node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|@tanstack|zustand)[\\/]/.test(id)) return 'vendor';
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      // TUNO_API points the dev server at another backend, e.g. a local test server.
      '/api': { target: process.env.TUNO_API ?? 'http://localhost:7070', changeOrigin: false },
    },
  },
});
