import { defineConfig } from '@vben/vite-config';

import ElementPlus from 'unplugin-element-plus/vite';

const developmentApiTarget = 'http://127.0.0.1:48080/admin-api';

export default defineConfig(async () => {
  return {
    application: {},
    vite: {
      plugins: [
        ElementPlus({
          format: 'esm',
        }),
      ],
      server: {
        headers: {
          // 禁止浏览器存储后续开发资源，避免刷新时继续携带旧 ETag 触发 304。
          'Cache-Control': 'no-store',
        },
        proxy: {
          '/admin-api': {
            changeOrigin: true,
            headers: {
              // 浏览器访问开发服务时会携带前端 Origin，代理改写为 Docker 后端自身来源，避免被后端 CORS 拒绝。
              Origin: new URL(developmentApiTarget).origin,
            },
            rewrite: (path) => path.replace(/^\/admin-api/, ''),
            // 本地后端代理目标地址
            target: developmentApiTarget,
            ws: true,
          },
        },
      },
    },
  };
});
