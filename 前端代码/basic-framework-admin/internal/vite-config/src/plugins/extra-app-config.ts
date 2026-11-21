import type { PluginOption } from 'vite';

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  colors,
  generatorContentHash,
  readPackageJSON,
} from '@vben/node-utils';

import { loadEnv } from '../utils/env.ts';

interface PluginOptions {
  isBuild: boolean;
  root: string;
}

const GLOBAL_CONFIG_FILE_NAME = '_app.config.js';
const VBEN_ADMIN_PRO_APP_CONF = '_VBEN_ADMIN_PRO_APP_CONF_';
const RUNTIME_CONFIG_FILE_NAME = 'app.config.js';

/**
 * 通用构建回退到环境变量生成 `_app.config.js` 时允许暴露到浏览器的公开配置键白名单。
 *
 * 默认登录凭据、客户端加密密钥、持久化混淆密钥及其他服务端环境变量均不进入白名单，
 * 避免未提供 `docker/app.config.js` 的应用在生产构建时把 `.env`/`.env.local` 中的敏感变量打入前端静态产物。
 */
const PUBLIC_RUNTIME_CONFIG_KEYS = [
  'VITE_APP_TITLE',
  'VITE_APP_NAMESPACE',
  'VITE_APP_CAPTCHA_ENABLE',
  'VITE_GLOB_API_URL',
  'VITE_UPLOAD_TYPE',
  'VITE_APP_AUTH_PAGE_LAYOUT',
  'VITE_APP_ENABLE_PREFERENCES',
  'VITE_APP_GLOBAL_SEARCH_ENABLE',
  'VITE_APP_THEME_BUILTIN_TYPE',
  'VITE_APP_THEME_COLOR_PRIMARY',
  'VITE_APP_THEME_MODE',
  'VITE_APP_THEME_TOGGLE_ENABLE',
  'VITE_APP_API_ENCRYPT_ENABLE',
  'VITE_APP_API_ENCRYPT_HEADER',
  'VITE_APP_API_ENCRYPT_ALGORITHM',
] as const;

/**
 * 按公开键白名单过滤回退环境变量，避免将非公开配置或凭据写入浏览器运行时脚本。
 *
 * @param env 合并后的环境变量键值表
 * @returns 仅包含白名单内字符串配置项的公开运行时配置对象
 */
function pickPublicRuntimeConfig(
  env: Record<string, unknown>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of PUBLIC_RUNTIME_CONFIG_KEYS) {
    if (
      Object.prototype.hasOwnProperty.call(env, key) &&
      typeof env[key] === 'string'
    ) {
      result[key] = env[key];
    }
  }
  return result;
}

/**
 * 将应用运行时配置生成独立资源并注入 HTML。
 *
 * @param options 插件选项
 * @param options.isBuild 是否为生产构建
 * @param options.root 应用根目录
 * @returns 仅在生产构建时启用的 Vite 插件
 */
async function viteExtraAppConfigPlugin({
  isBuild,
  root,
}: PluginOptions): Promise<PluginOption | undefined> {
  let publicPath: string;
  let source: string;

  if (!isBuild) {
    return;
  }

  const { version = '' } = await readPackageJSON(root);

  return {
    async configResolved(config) {
      publicPath = ensureTrailingSlash(config.base);
      source = await getConfigSource(root, config.mode);
    },
    async generateBundle() {
      try {
        this.emitFile({
          fileName: GLOBAL_CONFIG_FILE_NAME,
          source,
          type: 'asset',
        });

        console.log(colors.cyan('configuration file is build successfully!'));
      } catch (error) {
        console.log(
          colors.red(`configuration file failed to package:\n${String(error)}`),
        );
      }
    },
    name: 'vite:extra-app-config',
    async transformIndexHtml(html) {
      const hash = `v=${version}-${generatorContentHash(source, 8)}`;
      const appConfigSrc = `${publicPath}${GLOBAL_CONFIG_FILE_NAME}?${hash}`;

      return {
        html,
        tags: [{ attrs: { src: appConfigSrc }, tag: 'script' }],
      };
    },
  };
}

/**
 * 获取运行时配置脚本源码。
 *
 * 应用提供 `docker/app.config.js` 时直接原样使用，保证开发、构建预览和 Docker 部署共用
 * 同一个默认配置文件；未提供该文件的其他应用继续兼容旧的环境变量生成方式。
 *
 * @param root 应用根目录
 * @param mode Vite 构建模式
 * @returns 可直接输出为 `_app.config.js` 的脚本内容
 */
async function getConfigSource(root: string, mode: string | undefined) {
  const runtimeConfigPath = join(root, 'docker', RUNTIME_CONFIG_FILE_NAME);
  if (existsSync(runtimeConfigPath)) {
    return await readFile(runtimeConfigPath, 'utf8');
  }

  const rawEnv = await loadEnv(root, mode);
  const config = pickPublicRuntimeConfig(rawEnv);
  const windowVariable = `window.${VBEN_ADMIN_PRO_APP_CONF}`;
  let source = `${windowVariable}=${JSON.stringify(config)};`;
  source += `
    Object.freeze(${windowVariable});
    Object.defineProperty(window, "${VBEN_ADMIN_PRO_APP_CONF}", {
      configurable: false,
      writable: false,
    });
  `.replaceAll(/\s/g, '');
  return source;
}

/** 确保公共路径以斜杠结尾。 */
function ensureTrailingSlash(path: string) {
  return path.endsWith('/') ? path : `${path}/`;
}

export {
  getConfigSource,
  pickPublicRuntimeConfig,
  PUBLIC_RUNTIME_CONFIG_KEYS,
  viteExtraAppConfigPlugin,
};
