// @vitest-environment node
/**
 * 应用与库构建插件装配（vite-config 的 plugins/index）真实行为回归。
 *
 * 该模块按条件把通用插件、分析插件、首屏 loading 与 HTML 处理插件装进构建流程：
 * 条件判断写错会把分析产物混进生产构建、让首屏动画缺失或让运行时配置插件进入库构建。
 * 用例调用真实装配函数，解析其中的异步插件项后断言插件名称顺序与关键取值，并核对
 * `isBuild=false` 时运行时配置插件确实不安装。
 *
 * 本文件是构建工具链代码，按仓库既有做法声明 Node 环境；`@vben/node-utils` 只替换为
 * 局部替身：它的 dist 经 jiti 二次装载会再次加载同一份源码，使 node-utils 的覆盖率
 * 测量出现两套不兼容的映射，属工具侧已知缺陷，测试侧不得触发。
 */
import type { PluginOption, UserConfig } from 'vite';

import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { loadApplicationPlugins, loadLibraryPlugins } from '../index';

vi.mock(
  '@vben/node-utils',
  /** 只替换构建工具包的读取与着色边界，插件装配逻辑保持真实实现。 */ () => ({
    /** 原样返回文本，使断言不依赖 ANSI 转义序列。 */
    colors: {
      /** 原样返回，避免断言包含颜色控制符。 */
      cyan: (value: string) => value,
      /** 原样返回，避免断言包含颜色控制符。 */
      red: (value: string) => value,
    },
    /** 固定内容摘要，避免断言依赖真实哈希实现。 */
    generatorContentHash: () => 'DUMMYHASH',
    /** 返回带版本号的包清单，覆盖运行时配置文件名里的版本片段。 */
    readPackageJSON: async () => ({ version: '0.0.0' }),
  }),
);

/** 解析后的插件对象上本文件需要读取的字段。 */
interface ResolvedPlugin {
  /** 插件暴露的配置钩子，用于核对分析插件的报告目录。 */
  config?: () => UserConfig;
  /** 插件名称。 */
  name?: string;
}

/**
 * 解析装配结果里的异步插件项。
 *
 * 通用插件把运行时配置插件以 Promise 形式放进数组（Vite 允许异步插件项），
 * 断言前必须按真实方式等待，否则只能看到 Promise 本身。
 *
 * @param plugins 装配函数返回的插件列表，可能包含 Promise 项。
 * @returns 已解析并去掉空值后的插件对象列表。
 */
async function resolvePlugins(plugins: PluginOption[]) {
  const resolved = await Promise.all(plugins as Promise<unknown>[]);
  return resolved.filter(Boolean) as ResolvedPlugin[];
}

/**
 * 取出插件名称，按装配顺序断言启用集合。
 * @param plugins 已解析的插件对象列表。
 * @returns 各插件的名称；未声明名称的插件用空字符串占位。
 */
function namesOf(plugins: ResolvedPlugin[]) {
  return plugins.map(
    /** 名称缺失时用空串占位，便于断言暴露未命名插件。 */ (plugin) =>
      plugin.name ?? '',
  );
}

/** 当前工作目录即前端工作区根，与真实构建时传入的 root 一致。 */
const workspaceRoot = process.cwd();

describe('loadApplicationPlugins', /** 条件插件集合决定哪些构建能力进入产物。 */ () => {
  it('按顺序装配通用插件、分析插件、首屏 loading、HTML 与许可材料插件', /** 顺序与集合同时写错时最容易被忽略，必须整体核对。 */ async () => {
    const plugins = await resolvePlugins(
      await loadApplicationPlugins({
        html: true,
        injectAppLoading: true,
        isBuild: true,
        mode: 'analyze',
        root: workspaceRoot,
      }),
    );

    // vite-plugin-html 开启压缩后同时注册管道的 vite:html 与压缩环节 vite:minify-html，
    // 两者都要出现在插件表里，缺一说明该条件分支没有按真实工厂装配。
    // 许可材料两个插件按 isBuild 条件装配，且排在最后：它们改写产物内容，必须晚于上面所有插件。
    expect(namesOf(plugins)).toEqual([
      'vite:vue',
      'vite:vue-jsx',
      'vite:extra-app-config',
      'weetion:bundle-analysis',
      'vite:inject-app-loading',
      'vite:html',
      'vite:minify-html',
      'vite:license',
      'vite:third-party-notices',
    ]);
  });

  it('生产构建装配许可材料插件且不装配分析与首屏插件', /** 许可材料必须随发布产物产出，而分析报告与首屏动画只属于各自的模式。 */ async () => {
    const plugins = await resolvePlugins(
      await loadApplicationPlugins({
        html: true,
        injectAppLoading: false,
        isBuild: true,
        mode: 'production',
        root: workspaceRoot,
      }),
    );

    expect(namesOf(plugins)).toEqual([
      'vite:vue',
      'vite:vue-jsx',
      'vite:extra-app-config',
      'vite:html',
      'vite:minify-html',
      'vite:license',
      'vite:third-party-notices',
    ]);
  });

  it('分析插件的报告目录由传入的应用根推导', /** 根目录没透传会让分析产物落到错误位置或覆盖生产 dist。 */ async () => {
    const plugins = await resolvePlugins(
      await loadApplicationPlugins({
        isBuild: true,
        mode: 'analyze',
        root: workspaceRoot,
      }),
    );
    const analyzePlugin = plugins.find(
      /** 只取分析构建专用插件，避免其它插件的同名钩子干扰。 */ (plugin) =>
        plugin.name === 'weetion:bundle-analysis',
    );

    expect(analyzePlugin?.config?.().build?.outDir).toBe(
      resolve(workspaceRoot, '../../.cache/analyze'),
    );
  });

  it('开发服务不安装许可材料与分析插件', /** 开发服务不产出静态资源，装上许可材料插件只会反复写许可证文本。 */ async () => {
    const plugins = await resolvePlugins(
      await loadApplicationPlugins({
        html: false,
        injectAppLoading: false,
        isBuild: false,
        mode: 'production',
        root: workspaceRoot,
      }),
    );

    expect(namesOf(plugins)).toEqual(['vite:vue', 'vite:vue-jsx']);
  });
});

describe('loadLibraryPlugins', /** 库构建只装通用插件，不引入应用专用能力。 */ () => {
  it('只装配通用插件', /** 库构建混入首屏 loading 或 HTML 处理会让产物依赖应用入口。 */ async () => {
    const plugins = await resolvePlugins(
      await loadLibraryPlugins({ isBuild: true, root: workspaceRoot }),
    );

    expect(namesOf(plugins)).toEqual([
      'vite:vue',
      'vite:vue-jsx',
      'vite:extra-app-config',
    ]);
  });
});
