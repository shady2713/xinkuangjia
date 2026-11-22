import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const base = env.VITE_BASE || '/';
  const apiTarget = env.VITE_PROXY_TARGET || 'http://127.0.0.1:48080';

  return {
    base,
    plugins: [vue(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      host: true,
      port: 5175,
      proxy: {
        '/admin-api': {
          target: apiTarget,
          changeOrigin: true,
        },
        '/system/oauth2': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    build: {
      target: 'es2020',
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-vue': ['vue', 'vue-router', 'pinia'],
            'vendor-element': ['element-plus', '@element-plus/icons-vue'],
          },
        },
      },
    },
    test: {
      environment: 'happy-dom',
      globals: true,
      include: ['src/**/*.test.ts'],
    },
  };
});
