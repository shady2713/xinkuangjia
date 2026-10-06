/**
 * 应用型工程的 Vite 配置工厂：装配通用构建选项、环境变量与按需插件，
 * 最后叠加使用方在 vite 字段里给出的自定义配置。
 *
 * base、server.port 与首屏 loading 开关来自 .env 解析结果；
 * 全局 SCSS 变量只注入 apps 下的源码，库构建不走这条路径。
 */
import type { CSSOptions, UserConfig } from 'vite';

import type { DefineApplicationOptions } from '../typing.ts';

import path, { relative } from 'node:path';

import { defineConfig, mergeConfig } from 'vite';

import { loadApplicationPlugins } from '../plugins/index.ts';
import { loadAndConvertEnv } from '../utils/env.ts';
import { getCommonConfig } from './common.ts';

/**
 * 创建应用型前端的 Vite 配置，并按环境加载构建插件。
 *
 * @param userConfigPromise 应用自定义配置工厂
 * @returns 可由 Vite 直接加载的异步配置
 */
function defineApplicationConfig(userConfigPromise?: DefineApplicationOptions) {
  return defineConfig(async (config) => {
    const options = await userConfigPromise?.(config);
    const envConfig = await loadAndConvertEnv(process.cwd(), config.mode);
    const { base, injectAppLoading, port } = envConfig;
    const { command, mode } = config;
    const { application = {}, vite = {} } = options || {};
    const isBuild = command === 'build';

    const plugins = await loadApplicationPlugins({
      devtools: false,
      html: true,
      i18n: false,
      injectAppLoading,
      injectGlobalScss: true,
      isBuild,
      mode,
      pwa: false,
      root: process.cwd(),
      ...application,
    });

    const { injectGlobalScss = true } = application;
    const applicationConfig: UserConfig = {
      base,
      build: {
        rollupOptions: {
          output: {
            assetFileNames: '[ext]/[name]-[hash].[ext]',
            chunkFileNames: 'js/[name]-[hash].js',
            entryFileNames: 'js/[name]-[hash].js',
          },
        },
        target: 'es2015',
      },
      css: createCssOptions(injectGlobalScss),
      esbuild: {
        drop: isBuild ? ['debugger'] : [],
        legalComments: 'none',
      },
      plugins,
      server: {
        host: true,
        port,
        warmup: {
          clientFiles: [
            './index.html',
            './src/bootstrap.ts',
            './src/{views,layouts,router,store,api,adapter}/*',
          ],
        },
      },
    };

    return mergeConfig(
      mergeConfig(await getCommonConfig(), applicationConfig),
      vite,
    );
  });
}

/**
 * 取注入全局 SCSS 时使用的路径基准：本模块所在目录向上三级。
 * 按源码路径加载时该基准落在工作区下的 internal 目录，而不是工作区根。
 */
function findMonorepoRoot() {
  return path.resolve(__dirnameSafe(), '../../..');
}

/**
 * 用 import.meta.url 还原当前模块所在目录，替代 ESM 中不存在的 __dirname。
 * 取的是 URL 的 pathname，非 ASCII 目录会保留百分号编码，是否解码由调用方决定。
 */
function __dirnameSafe() {
  return path.dirname(new URL(import.meta.url).pathname);
}

/**
 * 生成 CSS 预处理配置：按需把全局 SCSS 变量注入 apps 下的样式文件。
 * @param injectGlobalScss - 为 false 时不注入，返回空的 preprocessorOptions。
 * @returns Vite 的 CSSOptions；注入时只有相对基准路径以 apps 开头的文件会被加上 @use 前置语句。
 */
function createCssOptions(injectGlobalScss = true): CSSOptions {
  const root = findMonorepoRoot();
  return {
    preprocessorOptions: injectGlobalScss
      ? {
          scss: {
            /** 只给 apps 目录下的样式文件前置全局 SCSS 变量，其余文件原样返回。 */
            additionalData: (content: string, filepath: string) => {
              const relativePath = relative(root, filepath);
              if (relativePath.startsWith(`apps${path.sep}`)) {
                return `@use "@vben/styles/global" as *;\n${content}`;
              }
              return content;
            },
          },
        }
      : {},
  };
}

export { defineApplicationConfig };
