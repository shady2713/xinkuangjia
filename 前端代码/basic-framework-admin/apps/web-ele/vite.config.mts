import process from 'node:process';

import { defineConfig } from '@vben/vite-config';

import ElementPlus from 'unplugin-element-plus/vite';
import { loadEnv } from 'vite';

/**
 * 开发代理默认目标：与后端 `SERVER_PORT` 默认值 48080 对应。
 *
 * 后端换端口或不在本机时用 `VITE_DEV_API_TARGET` 覆盖，不要修改这个被跟踪的源文件：
 * 真实进程环境变量优先，其次读应用目录下 `.env`、`.env.local`、`.env.<mode>`、`.env.<mode>.local`
 * 中的同名键（与 [.env.local.example](.env.local.example) 说明一致）。
 */
const DEFAULT_DEVELOPMENT_API_TARGET = 'http://127.0.0.1:48080/admin-api';

/**
 * 解析 `/admin-api` 的开发代理目标地址。
 *
 * 真实进程环境变量 `VITE_DEV_API_TARGET` 优先于 `.env*` 文件；两者都没有或只有空白时回退到
 * {@link DEFAULT_DEVELOPMENT_API_TARGET}，保证不设置任何键时行为与硬编码默认值一致。
 *
 * @param mode Vite 运行模式，决定加载哪个 `.env.<mode>` 文件（开发为 development）。
 * @returns 形如 `http://主机:端口/admin-api` 的代理目标；不校验可达性，非法地址由 `new URL()` 抛出。
 */
function resolveDevelopmentApiTarget(mode: string): string {
  const fromProcess = process.env.VITE_DEV_API_TARGET;
  const fromFile = loadEnv(mode, process.cwd(), 'VITE_').VITE_DEV_API_TARGET;
  const target = (fromProcess ?? fromFile ?? '').trim();
  return target === '' ? DEFAULT_DEVELOPMENT_API_TARGET : target;
}

export default defineConfig(async (config) => {
  const developmentApiTarget = resolveDevelopmentApiTarget(
    config?.mode ?? 'development',
  );
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
              // 浏览器访问开发服务时会携带前端 Origin，代理改写为后端自身来源，避免被后端 CORS 拒绝。
              Origin: new URL(developmentApiTarget).origin,
            },
            rewrite: (path) => path.replace(/^\/admin-api/, ''),
            // 本地后端代理目标地址，默认 48080，可用 VITE_DEV_API_TARGET 覆盖。
            target: developmentApiTarget,
            ws: true,
          },
        },
      },
    },
  };
});
