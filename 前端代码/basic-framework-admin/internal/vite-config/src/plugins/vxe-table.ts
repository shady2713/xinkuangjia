import type { PluginOption } from 'vite';

import { lazyImport, VxeResolver } from 'vite-plugin-lazy-import';

/**
 * 按需加载 vxe-table 与 vxe-pc-ui 组件的 Vite 插件封装。
 *
 * @returns 兼容当前工作区 Vite 实例类型的插件选项
 */
async function viteVxeTableImportsPlugin(): Promise<PluginOption> {
  return [
    // 第三方插件对等依赖解析出的 Vite Plugin 私有字段同构但名义不兼容，在此收敛到当前 Vite PluginOption。
    lazyImport({
      resolvers: [
        VxeResolver({
          libraryName: 'vxe-table',
        }),
        VxeResolver({
          libraryName: 'vxe-pc-ui',
        }),
      ],
    }) as unknown as PluginOption,
  ];
}

export { viteVxeTableImportsPlugin };
