import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: true,
    proxy: { '/ws': { target: 'ws://localhost:3000', ws: true } },
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 900,
    // three.js — отдельным файлом: при обновлении игры браузер берёт его из кэша, качается только наш код
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
});
