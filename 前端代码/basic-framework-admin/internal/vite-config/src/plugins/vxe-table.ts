import type { PluginOption } from 'vite';

import { lazyImport, VxeResolver } from 'vite-plugin-lazy-import';

/**
 * 组件库按需引入插件。
 *
 * `vite-plugin-lazy-import` 的返回类型来自它自己解析到的另一份 Vite 声明副本
 * （工作区同时安装了两份受 @types/node 版本影响的 vite），与当前程序的
 * `PluginOption` 不是同一份声明；此处按 Vite 插件类型收窄，运行时对象不变。
 *
 * @returns 启用 vxe-table 与 vxe-pc-ui 按需引入的插件列表。
 */
async function viteVxeTableImportsPlugin(): Promise<PluginOption> {
  const lazyImportPlugin = lazyImport({
    resolvers: [
      VxeResolver({
        libraryName: 'vxe-table',
      }),
      VxeResolver({
        libraryName: 'vxe-pc-ui',
      }),
    ],
  }) as PluginOption;
  return [lazyImportPlugin];
}

export { viteVxeTableImportsPlugin };
