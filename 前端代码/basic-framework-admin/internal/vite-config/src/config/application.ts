import type { CSSOptions, UserConfig } from 'vite';

import type { DefineApplicationOptions } from '../typing.ts';

import path, { relative } from 'node:path';

import { defineConfig, mergeConfig } from 'vite';

import { loadApplicationPlugins } from '../plugins/index.ts';
import { loadAndConvertEnv } from '../utils/env.ts';
import { getCommonConfig } from './common.ts';

/**
 * 按依赖域稳定切分长周期缓存 chunk，防止首屏入口分块膨胀。
 *
 * @param id Rollup 模块绝对标识
 * @returns 目标 vendor 分块名；普通业务模块返回 undefined 交由路由懒加载切分
 */
function resolveVendorChunk(id: string): string | undefined {
  if (!id.includes('node_modules')) {
    return undefined;
  }
  if (
    /[/\\]node_modules[/\\](?:vue|@vue|vue-router|pinia|pinia-plugin-persistedstate|vue-i18n|@intlify)[/\\]/u.test(
      id,
    )
  ) {
    return 'vendor-vue';
  }
  if (/[/\\]node_modules[/\\](?:element-plus|@element-plus)[/\\]/u.test(id)) {
    return 'vendor-element-plus';
  }
  if (
    /[/\\]node_modules[/\\](?:vxe-table|vxe-pc-ui|@vxe-ui|xe-utils)[/\\]/u.test(
      id,
    )
  ) {
    return 'vendor-vxe';
  }
  if (/[/\\]node_modules[/\\](?:@iconify|lucide-vue-next)[/\\]/u.test(id)) {
    return 'vendor-icons';
  }
  if (
    /[/\\]node_modules[/\\](?:reka-ui|vee-validate|@vee-validate|zod|sm-crypto|crypto-js|jsencrypt)[/\\]/u.test(
      id,
    )
  ) {
    return 'vendor-ui-core';
  }
  return undefined;
}

/**
 * 创建应用型前端的 Vite 配置，并按环境加载构建插件与分块策略。
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
      html: true,
      injectAppLoading,
      injectGlobalScss: true,
      isBuild,
      mode,
      root: process.cwd(),
      vxeTableLazyImport: true,
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
            manualChunks: resolveVendorChunk,
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

/** 解析前端工作区根目录。 */
function findMonorepoRoot() {
  return path.resolve(__dirnameSafe(), '../../..');
}

/** 获取当前模块目录路径。 */
function __dirnameSafe() {
  return path.dirname(new URL(import.meta.url).pathname);
}

/** 为 apps 下的 SCSS 自动注入全局样式变量。 */
function createCssOptions(injectGlobalScss = true): CSSOptions {
  const root = findMonorepoRoot();
  return {
    preprocessorOptions: injectGlobalScss
      ? {
          scss: {
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
