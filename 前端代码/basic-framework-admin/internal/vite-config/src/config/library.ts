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

async function readLocalPackageJson(root: string) {
  const content = await readFile(join(root, 'package.json'), 'utf8');
  return JSON.parse(content) as {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
}

export { defineLibraryConfig };
