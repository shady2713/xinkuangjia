/**
 * 运行时配置插件：构建时产出一份独立于 bundle 的 _app.config.js，
 * 并把带版本与内容 hash 的 script 标签注入 index.html。
 *
 * 应用提供 docker/app.config.js 时原样搬运，否则按环境变量生成
 * 冻结的 window 配置对象；非构建阶段直接返回 undefined。
 */
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

  const config = await loadEnv(root, mode);
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

export { viteExtraAppConfigPlugin };
