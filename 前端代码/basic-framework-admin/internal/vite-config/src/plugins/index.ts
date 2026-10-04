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
 * 装载应用与库构建共用的基础插件。
 * @param options 通用插件选项，提供构建标记与工程根目录。
 * @returns 条件插件列表，由装配函数按条件展开。
 */
async function loadCommonPlugins(
  options: CommonPluginOptions,
): Promise<ConditionPlugin[]> {
  return [
    {
      condition: true,
      // 运行时配置插件是异步构造的；未命中条件时它返回 undefined，不能塞进插件列表。
      plugins: async () => {
        const extraAppConfigPlugin = await viteExtraAppConfigPlugin({
          isBuild: options.isBuild ?? false,
          root: options.root ?? process.cwd(),
        });
        return [
          viteVue({
            script: {
              defineModel: true,
            },
          }),
          viteVueJsx(),
          ...(extraAppConfigPlugin ? [extraAppConfigPlugin] : []),
        ];
      },
    },
  ];
}

/**
 * 按应用构建选项加载通用插件、首屏 loading 和 HTML 模板处理插件。
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
      condition: options.mode === 'analyze',
      // 分析构建与生产产物分目录，避免带报告的输出被误用于发布。
      plugins: () => [bundleAnalysis(options.root ?? process.cwd())],
    },
    {
      condition: options.injectAppLoading,
      // 模板缺失时插件返回 undefined，不能把空值塞进插件列表。
      plugins: async () => {
        const injectAppLoadingPlugin = await viteInjectAppLoadingPlugin();
        return injectAppLoadingPlugin ? [injectAppLoadingPlugin] : [];
      },
    },
    {
      condition: options.html,
      // 仅在启用 HTML 处理时装载模板压缩插件。
      plugins: () => [...viteHtmlPlugin({ minify: true })],
    },
  ]);
}

/**
 * 装载共享库构建插件。
 * @param options 库构建插件选项。
 * @returns 当前构建启用的 Vite 插件列表。
 */
async function loadLibraryPlugins(
  options: LibraryPluginOptions,
): Promise<PluginOption[]> {
  return await loadConditionPlugins(await loadCommonPlugins(options));
}

export { loadApplicationPlugins, loadLibraryPlugins };
