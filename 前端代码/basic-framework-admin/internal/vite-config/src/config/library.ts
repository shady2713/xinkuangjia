/**
 * 库型工程的 Vite 配置工厂：固定以 src/index.ts 为入口产出 ESM，
 * 并把本地 package.json 里的依赖与 peer 依赖全部外部化。
 *
 * 目标为 es2018 且不输出 sourcemap；首屏加载、HTML 等应用插件不在此装载。
 */
import type { ConfigEnv, UserConfig } from 'vite';

import type { DefineLibraryOptions } from '../typing.ts';

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { defineConfig, mergeConfig } from 'vite';

import { loadLibraryPlugins } from '../plugins/index.ts';
import { getCommonConfig } from './common.ts';

/**
 * 创建库型工程的 Vite 配置：入口固定 src/index.ts，只产出 ESM，包依赖全部外部化。
 * @param userConfigPromise 库自定义配置工厂，可覆盖插件开关与用户 vite 配置
 * @returns 可由 Vite 直接加载的异步配置
 */
function defineLibraryConfig(userConfigPromise?: DefineLibraryOptions) {
  return defineConfig(async (config: ConfigEnv) => {
    const options = await userConfigPromise?.(config);
    const { command, mode } = config;
    const { library = {}, vite = {} } = options || {};
    const isBuild = command === 'build';

    const plugins = await loadLibraryPlugins({
      dts: false,
      injectMetadata: true,
      isBuild,
      mode,
      ...library,
    });

    const pkg = await readLocalPackageJson(process.cwd());
    const externalPackages = [
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.peerDependencies || {}),
    ];

    const packageConfig: UserConfig = {
      build: {
        lib: {
          entry: 'src/index.ts',
          /** 输出文件名固定为 index.mjs，不随入口名变化。 */
          fileName: () => 'index.mjs',
          formats: ['es'],
        },
        rollupOptions: {
          external: externalPackages,
        },
        sourcemap: false,
        target: 'es2018',
      },
      plugins,
    };

    return mergeConfig(
      mergeConfig(await getCommonConfig(), packageConfig),
      vite,
    );
  });
}

/**
 * 读取指定目录 package.json 里的依赖声明，用于外部化依赖。
 * @param root - 包含 package.json 的目录。
 * @returns 只取 dependencies 与 peerDependencies 两个字段；文件缺失或内容不是合法 JSON 时由读取与解析过程抛错。
 */
async function readLocalPackageJson(root: string) {
  const content = await readFile(join(root, 'package.json'), 'utf8');
  return JSON.parse(content) as {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
}

export { defineLibraryConfig };
