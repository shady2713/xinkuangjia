// @vitest-environment node
/**
 * 应用型 Vite 配置（vite-config 的 config/application）真实行为回归。
 *
 * `defineApplicationConfig` 是管理端应用的构建入口：它按环境加载插件、合并公共配置与
 * 调用方覆盖，并决定全局 SCSS 是否注入 `@vben/styles/global`。用例用真实配置函数驱动
 * `command`/`mode`，断言构建目标、产物命名、esbuild 裁剪、开发服务器预热清单、合并优先级
 * 以及各个插件条件分支。
 *
 * 关于全局 SCSS 注入的结论（第八轮定位"根目录取错"，本轮补出第二个原因，均按真实行为
 * 断言、不改生产源码）：
 * 1. `findMonorepoRoot()` 取到的是 `<前端根>/internal`（源码目录 `src/config` 上溯三级），
 *    而不是工作区根，判定基准本身就偏了一层；
 * 2. `__dirnameSafe()` 用 `new URL(import.meta.url).pathname` 取路径，**不做百分号解码**
 *    （应使用 `fileURLToPath`）。本仓库路径含中文目录，于是根字符串是
 *    `/home/weetion/%E6%A1%8C%E9%9D%A2/.../internal` 这样的编码形式，与磁盘上的真实路径
 *    逐字符都不相同，`relative(root, filepath)` 得到 `../../桌面/...`，`startsWith('apps' + 分隔符)`
 *    恒为假。**结论：`@use "@vben/styles/global"` 在本机（含任何非 ASCII 路径的部署）
 *    的生产构建中从不注入**；只有在纯 ASCII 路径、且被编译文件位于
 *    `<前端根>/internal/apps/**` 时命中分支才可能成立。
 *
 * 本文件是构建工具链代码，按仓库既有做法声明 Node 环境；`@vben/node-utils` 只替换为
 * 局部替身，避免其 dist 经 jiti 二次装载污染该包源码的覆盖率测量。
 */
import type { ESBuildOptions, UserConfig } from 'vite';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { defineApplicationConfig } from '../application';

vi.mock(
  '@vben/node-utils',
  /** 只替换构建工具包的读取与着色边界，配置组装逻辑保持真实实现。 */ () => ({
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

/** 本测试文件所在目录，用于推导前端工作区根的绝对路径。 */
const testDir = path.dirname(fileURLToPath(import.meta.url));
/** 前端工作区根目录，等于真实构建时应用目录的上两级。 */
const workspaceRoot = path.resolve(testDir, '../../../../..');
/**
 * 与生产实现完全相同的 SCSS 根口径：`URL.pathname` 不做百分号解码。
 *
 * 用同一口径从本测试文件（`src/config/__tests__`）上溯四级得到 `<前端根>/internal`，
 * 因此这里的字符串与 `findMonorepoRoot()` 的返回值逐字符一致；换成 `fileURLToPath`
 * 就变成磁盘真实路径，也正是生产实现与真实文件路径对不上的原因。
 */
const encodedScssRoot = new URL('../../../../', import.meta.url).pathname;

/** 驱动配置函数时使用的真实 Vite 环境。 */
interface FactoryEnv {
  /** Vite 命令，build 时才启用生产裁剪。 */
  command: 'build' | 'serve';
  /** Vite 模式，决定加载哪些环境文件与插件条件。 */
  mode: string;
}

/** 配置工厂的真实签名，与 Vite 的调用方式一致。 */
type ConfigFactory = (env: FactoryEnv) => Promise<UserConfig>;

/** 样式预处理器里本文件需要读取的字段。 */
interface ScssPreprocessorOptions {
  /** 真实注入回调：接收原始内容与文件路径，返回处理后的内容。 */
  additionalData?: (content: string, filepath: string) => string;
}

/** 调用方覆盖项，字段与真实应用 vite.config 的形状一致。 */
interface ConfigOverrides {
  /** 应用级插件选项，会覆盖入口里的默认值。 */
  application?: Record<string, unknown>;
  /** 调用方 Vite 配置，优先级最高。 */
  vite?: UserConfig;
}

/**
 * 读取 esbuild 配置；Vite 用 `esbuild: false` 表示显式关闭，断言只关心真实对象结构。
 * @param config 被测配置函数返回的完整 Vite 配置。
 * @returns esbuild 配置；显式关闭时为 undefined。
 */
function esbuildOptions(config: UserConfig): ESBuildOptions | undefined {
  const { esbuild } = config;
  return esbuild === false ? undefined : esbuild;
}

/**
 * 驱动真实配置入口，取出合并后的最终配置。
 * @param overrides 调用方需要覆盖的应用插件选项与 Vite 配置。
 * @param config 真实构建环境；command 决定构建裁剪，mode 决定加载的环境文件。
 * @param config.command Vite 命令，build 时才启用生产裁剪。
 * @param config.mode Vite 模式，用于解析环境变量与插件条件。
 * @returns 合并后的完整 Vite 配置。
 */
async function resolveConfig(
  overrides: ConfigOverrides,
  config: FactoryEnv,
): Promise<UserConfig> {
  // defineConfig 原样返回传入的配置函数，这里按 Vite 的真实调用方式收窄类型后驱动它。
  const factory = defineApplicationConfig(
    /** 返回本用例的覆盖项，配置组装逻辑本身保持真实实现。 */
    async () => overrides,
  ) as unknown as ConfigFactory;
  return await factory(config);
}

/**
 * 取出配置里启用插件名称，便于按条件断言启用集合。
 * @param config 合并后的 Vite 配置。
 * @returns 已解析的插件名称列表；异步插件项按真实方式等待。
 */
async function pluginNames(config: UserConfig) {
  const resolved = await Promise.all(
    (config.plugins ?? []) as unknown as Promise<unknown>[],
  );
  return resolved
    .filter(Boolean)
    .map(
      /** 名称缺失时用空串占位，便于断言暴露未命名插件。 */ (plugin) =>
        (plugin as { name?: string }).name ?? '',
    );
}

/**
 * 取出样式预处理器里的 SCSS 附加数据回调。
 * @param config 合并后的 Vite 配置。
 * @returns 真实注入回调；未启用注入时报告契约变化。
 * @throws 配置没有按预期暴露 additionalData 时抛出，避免断言静默跳过。
 */
function getAdditionalData(config: UserConfig) {
  const scss = config.css?.preprocessorOptions?.scss as
    | ScssPreprocessorOptions
    | undefined;
  const additionalData = scss?.additionalData;
  if (typeof additionalData !== 'function') {
    throw new TypeError(
      'css.preprocessorOptions.scss.additionalData 未按契约暴露',
    );
  }
  return additionalData;
}

describe('defineApplicationConfig', /** 构建入口的产物契约与条件分支。 */ () => {
  it('生产构建写出固定的产物命名与 esbuild 裁剪', /** 命名或裁剪写错会让缓存失效或把调试语句带进产物。 */ async () => {
    const config = await resolveConfig(
      {},
      { command: 'build', mode: 'production' },
    );

    expect(config.base).toBe('/');
    expect(config.build?.target).toBe('es2015');
    expect(config.build?.rollupOptions?.output).toEqual({
      assetFileNames: '[ext]/[name]-[hash].[ext]',
      chunkFileNames: 'js/[name]-[hash].js',
      entryFileNames: 'js/[name]-[hash].js',
    });
    expect(esbuildOptions(config)?.drop).toEqual(['debugger']);
    // 公共配置最后参与合并，压缩体积与 sourcemap 口径不能被应用配置覆盖。
    expect(config.build?.chunkSizeWarningLimit).toBe(2000);
    expect(config.build?.reportCompressedSize).toBe(false);
    expect(config.build?.sourcemap).toBe(false);
  });

  it('开发服务器使用环境变量的端口并预热应用源码目录', /** 端口与预热清单写错会让开发环境端口冲突或首屏编译变慢。 */ async () => {
    const config = await resolveConfig(
      {},
      { command: 'serve', mode: 'development' },
    );

    expect(config.server?.host).toBe(true);
    // 工作区根没有 .env，端口回落到默认值。
    expect(config.server?.port).toBe(5173);
    expect(config.server?.warmup?.clientFiles).toEqual([
      './index.html',
      './src/bootstrap.ts',
      './src/{views,layouts,router,store,api,adapter}/*',
    ]);
    expect(esbuildOptions(config)?.drop).toEqual([]);
  });

  it('调用方的 vite 配置覆盖应用默认值', /** 覆盖顺序写反会让应用的个性化配置失效。 */ async () => {
    const config = await resolveConfig(
      { vite: { build: { target: 'es2020' }, server: { port: 6100 } } },
      { command: 'build', mode: 'production' },
    );

    expect(config.build?.target).toBe('es2020');
    expect(config.server?.port).toBe(6100);
  });

  it('应用选项覆盖入口默认值并驱动插件条件', /** 选项展开顺序写错会让调用方无法关闭或打开构建能力。 */ async () => {
    const defaultConfig = await resolveConfig(
      {},
      { command: 'build', mode: 'production' },
    );
    const analyzeConfig = await resolveConfig(
      { application: { mode: 'analyze' } },
      { command: 'build', mode: 'production' },
    );

    // 生产构建按 isBuild 装配许可材料两个插件：横幅改写入口分块、第三方材料写入产物文件，
    // 两者都排在 HTML 压缩之后，改写内容必须晚于全部产出环节。
    expect(await pluginNames(defaultConfig)).toEqual([
      'vite:vue',
      'vite:vue-jsx',
      'vite:extra-app-config',
      'vite:html',
      'vite:minify-html',
      'vite:license',
      'vite:third-party-notices',
    ]);
    // 分析模式同样产出许可材料，并额外装配分析插件；用全量比对钉住集合与顺序。
    expect(await pluginNames(analyzeConfig)).toEqual([
      'vite:vue',
      'vite:vue-jsx',
      'vite:extra-app-config',
      'weetion:bundle-analysis',
      'vite:html',
      'vite:minify-html',
      'vite:license',
      'vite:third-party-notices',
    ]);
  });

  it('关闭全局 SCSS 注入时不产生预处理器配置', /** 关闭后仍写入 scss 配置会改变不使用全局样式的应用产物。 */ async () => {
    const config = await resolveConfig(
      { application: { injectGlobalScss: false } },
      { command: 'build', mode: 'production' },
    );

    expect(config.css).toEqual({ preprocessorOptions: {} });
  });
});

describe('全局 SCSS 注入路径判定', /** 附加数据回调对工程路径的真实判定结果。 */ () => {
  it('真实应用源码路径不注入全局样式', /** 这就是生产构建的真实结果：全局样式前缀恒不生效，不能当成已生效的契约。 */ async () => {
    const config = await resolveConfig(
      {},
      { command: 'build', mode: 'production' },
    );
    const additionalData = getAdditionalData(config);
    const appScss = path.join(
      workspaceRoot,
      'apps',
      'web-ele',
      'src',
      'app.scss',
    );

    expect(additionalData('body { color: red; }', appScss)).toBe(
      'body { color: red; }',
    );
  });

  it('磁盘上位于 internal/apps 的真实路径同样不注入', /** 根字符串带百分号编码，连 `internal/apps` 这类"看起来命中"的磁盘路径也对不上。 */ async () => {
    const config = await resolveConfig(
      {},
      { command: 'build', mode: 'production' },
    );
    const additionalData = getAdditionalData(config);
    const diskInternalAppScss = path.join(
      workspaceRoot,
      'internal',
      'apps',
      'web-ele',
      'src',
      'app.scss',
    );

    expect(additionalData('body { color: red; }', diskInternalAppScss)).toBe(
      'body { color: red; }',
    );
  });

  it('按同一编码根书写的 apps 路径才注入全局样式', /** 命中分支只比对字符串前缀，说明判定基准是编码后的根而不是磁盘真实根。 */ async () => {
    const config = await resolveConfig(
      {},
      { command: 'build', mode: 'production' },
    );
    const additionalData = getAdditionalData(config);
    const encodedAppScss = path.join(
      encodedScssRoot,
      'apps',
      'web-ele',
      'src',
      'app.scss',
    );

    expect(additionalData('body { color: red; }', encodedAppScss)).toBe(
      '@use "@vben/styles/global" as *;\nbody { color: red; }',
    );
  });
});
