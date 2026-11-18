import type { PluginOption } from 'vite';

import type {
  ApplicationPluginOptions,
  CommonPluginOptions,
  ConditionPlugin,
  LibraryPluginOptions,
} from '../typing.ts';

import viteVue from '@vitejs/plugin-vue';
import viteVueJsx from '@vitejs/plugin-vue-jsx';
import { createHtmlPlugin as viteHtmlPlugin } from 'vite-plugin-html';

import { bundleAnalysis } from './bundle-analysis.mjs';
import { viteExtraAppConfigPlugin } from './extra-app-config.ts';
import { viteInjectAppLoadingPlugin } from './inject-app-loading/index.ts';
import { viteVxeTableImportsPlugin } from './vxe-table.ts';

/**
 * 按启用条件顺序展开 Vite 插件列表。
 *
 * @param conditionPlugins 条件插件数组
 * @returns 已启用的扁平化 Vite 插件列表
 */
async function loadConditionPlugins(conditionPlugins: ConditionPlugin[]) {
  const plugins: PluginOption[] = [];
  for (const conditionPlugin of conditionPlugins) {
    if (conditionPlugin.condition) {
      const realPlugins = await conditionPlugin.plugins();
      plugins.push(...realPlugins);
    }
  }
  return plugins.flat();
}

/**
 * 组装应用与组件库共用的基础 Vite 插件集合。
 *
 * @param options 公共插件选项
 * @returns 带启用条件的插件定义列表
 */
async function loadCommonPlugins(
  options: CommonPluginOptions,
): Promise<ConditionPlugin[]> {
  return [
    {
      condition: true,
      /**
       * 加载通用 Vue 编译与运行时配置注入插件。
       *
       * @returns 通用插件实例列表
       */
      plugins: async () => [
        viteVue({
          script: {
            defineModel: true,
          },
        }),
        viteVueJsx(),
        await viteExtraAppConfigPlugin({
          isBuild: options.isBuild ?? false,
          root: options.root ?? process.cwd(),
        }),
      ],
    },
  ];
}

/**
 * 按应用构建选项加载通用插件、vxe-table 按需解析、首屏 loading 和 HTML 模板处理插件。
 *
 * @param options 应用构建插件选项
 * @returns 当前构建启用的 Vite 插件列表
 */
async function loadApplicationPlugins(
  options: ApplicationPluginOptions,
): Promise<PluginOption[]> {
  const commonPlugins = await loadCommonPlugins(options);
  return await loadConditionPlugins([
    ...commonPlugins,
    {
      condition: options.vxeTableLazyImport !== false,
      /**
       * 加载 vxe-table 与 vxe-pc-ui 按需导入重写插件。
       *
       * @returns 插件实例列表
       */
      plugins: async () => [await viteVxeTableImportsPlugin()],
    },
    {
      condition: options.mode === 'analyze',
      // 分析构建与生产产物分目录，避免带报告的输出被误用于发布。
      plugins: () => [
        bundleAnalysis(options.root ?? process.cwd()) as PluginOption,
      ],
    },
    {
      condition: options.injectAppLoading,
      plugins: async () => [await viteInjectAppLoadingPlugin()],
    },
    {
      condition: options.html,
      plugins: () => [viteHtmlPlugin({ minify: true })],
    },
  ]);
}

/** 加载工作区内部库构建插件。 */
async function loadLibraryPlugins(
  options: LibraryPluginOptions,
): Promise<PluginOption[]> {
  return await loadConditionPlugins(await loadCommonPlugins(options));
}

export { loadApplicationPlugins, loadLibraryPlugins };
