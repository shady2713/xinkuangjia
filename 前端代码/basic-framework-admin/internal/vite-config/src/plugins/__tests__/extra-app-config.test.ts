// @vitest-environment node
/**
 * 应用运行时配置插件（vite-config 的 plugins/extra-app-config）真实行为回归。
 *
 * 该插件在生产构建时把运行时配置写成 `_app.config.js` 资源，并在 index.html 里注入带版本
 * 与内容摘要的脚本地址；摘要、公共路径或文件名写错都会让浏览器拿到旧配置或 404。
 * 用例在独立临时目录里准备 `.env` 与可选的 `docker/app.config.js`，调用真实插件并驱动
 * `configResolved`、`generateBundle`、`transformIndexHtml`，最后把生成的脚本放进
 * 真实 `node:vm` 上下文执行，核对它确实冻结并写入了 `window._VBEN_ADMIN_PRO_APP_CONF_`。
 *
 * `@vben/node-utils` 只替换为局部替身：它的 dist 经 jiti 二次装载会污染该包源码的覆盖率
 * 测量（仓库已记录的工具侧缺陷）。因此本文件断言的是"插件如何组合版本号、摘要与公共路径"，
 * 摘要函数与包清单读取本身由 node-utils 自己的测试覆盖。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { viteExtraAppConfigPlugin } from '../extra-app-config';

const nodeUtils = vi.hoisted(
  /** 与控制台边界一起替换工具包能力，插件组合逻辑保持真实实现。 */ () => ({
    /** 固定内容摘要，使断言不依赖真实哈希实现。 */
    generatorContentHash: vi.fn(
      /** 参与摘要的真实源码，用例据此核对插件传入的内容。 */ (
        _content: string,
      ) => 'HASH1234',
    ),
    /** 返回带版本号的包清单，覆盖运行时配置文件名里的版本片段。 */
    readPackageJSON: vi.fn(
      /** 返回固定版本号，使脚本地址可精确断言。 */ async () => ({
        version: '9.9.9',
      }),
    ),
  }),
);

vi.mock(
  '@vben/node-utils',
  /** 只替换内容摘要、包清单读取与着色边界。 */ () => ({
    /** 原样返回文本，使断言不依赖 ANSI 转义序列。 */
    colors: {
      /** 原样返回，避免断言包含颜色控制符。 */
      cyan: (value: string) => value,
      /** 原样返回，避免断言包含颜色控制符。 */
      red: (value: string) => value,
    },
    generatorContentHash: nodeUtils.generatorContentHash,
    readPackageJSON: nodeUtils.readPackageJSON,
  }),
);

/** 运行时配置脚本写入的全局变量名，与插件实现约定一致。 */
const CONFIG_VARIABLE = '_VBEN_ADMIN_PRO_APP_CONF_';

/** 插件中本用例需要驱动的钩子与标识；Vite 的联合类型此处按真实结构收窄。 */
interface ExtraAppConfigPlugin {
  /** 构建配置解析完成时确定公共路径并生成脚本源码。 */
  configResolved?: (config: { base: string; mode: string }) => Promise<void>;
  /** 产物输出阶段写出运行时配置文件。 */
  generateBundle?: (this: {
    /** 记录本次输出的资源，替身只收集调用参数。 */
    emitFile: (file: unknown) => void;
  }) => Promise<void>;
  /** 插件名称。 */
  name?: string;
  /** HTML 处理阶段注入脚本标签。 */
  transformIndexHtml?: (html: string) => Promise<{
    /** 原样返回的 HTML。 */
    html: string;
    /** 需要注入的标签列表。 */
    tags: { attrs: { src: string }; tag: string }[];
  }>;
}

/** 本用例独占的临时应用根目录，用例结束后整体删除。 */
let appRoot: string;

/**
 * 建立只含必要文件的临时应用根目录。
 * @param envFiles 需要写入的环境文件名与内容映射。
 * @returns 临时应用根目录的绝对路径。
 */
function createAppRoot(envFiles: Record<string, string>) {
  for (const [file, content] of Object.entries(envFiles)) {
    writeFileSync(join(appRoot, file), content);
  }
  return appRoot;
}

/**
 * 取出真实插件对象。
 * @param isBuild 是否为生产构建，非构建时插件不安装。
 * @returns 可直接驱动钩子的插件对象。
 * @throws 生产构建下插件未返回对象时报告契约变化。
 */
async function getPlugin(isBuild = true) {
  const plugin = await viteExtraAppConfigPlugin({ isBuild, root: appRoot });
  if (!plugin) {
    throw new Error('生产构建必须返回运行时配置插件');
  }
  return plugin as ExtraAppConfigPlugin;
}

/**
 * 按 Vite 的真实钩子顺序驱动插件，取回生成的脚本文本与注入结果。
 *
 * 摘要只在 HTML 处理阶段计算，因此必须按 `configResolved` → `transformIndexHtml` 的
 * 真实顺序调用，才能拿到插件实际写出的源码。
 *
 * @param plugin 待驱动的真实插件对象。
 * @param base 构建公共路径。
 * @param mode 构建模式，决定合并哪些环境文件。
 * @returns 注入结果、插件实际使用的脚本文本与脚本地址。
 * @throws 摘要函数未被调用时报告插件钩子契约变化。
 */
async function runBuildHooks(
  plugin: ExtraAppConfigPlugin,
  base: string,
  mode: string,
) {
  await plugin.configResolved?.({ base, mode });
  const result = await plugin.transformIndexHtml?.('<html></html>');
  const source = nodeUtils.generatorContentHash.mock.calls.at(-1)?.[0];
  if (typeof source !== 'string') {
    throw new TypeError('HTML 处理阶段必须用真实源码计算内容摘要');
  }
  return { result, source, src: result?.tags[0]?.attrs.src };
}

beforeEach(
  /** 每例使用独立目录与独立替身调用记录。 */ () => {
    appRoot = mkdtempSync(join(tmpdir(), 'vite-extra-app-config-'));
    nodeUtils.generatorContentHash.mockClear();
    nodeUtils.readPackageJSON.mockClear();
  },
);

afterEach(
  /** 回收本用例独占的临时目录。 */ () => {
    rmSync(appRoot, { force: true, recursive: true });
  },
);

describe('viteExtraAppConfigPlugin', /** 运行时配置的生成、输出与注入契约。 */ () => {
  it('非生产构建不安装插件', /** 开发态注入额外资源会让本地调试与生产产物不一致。 */ async () => {
    const plugin = await viteExtraAppConfigPlugin({
      isBuild: false,
      root: appRoot,
    });

    expect(plugin).toBeUndefined();
  });

  it('按版本与内容摘要注入脚本地址', /** 摘要写错会让浏览器继续使用旧配置，公共路径写错会 404。 */ async () => {
    createAppRoot({ '.env': 'VITE_APP_TITLE=管理平台\n' });
    const plugin = await getPlugin();

    const { result, source, src } = await runBuildHooks(
      plugin,
      '/admin',
      'production',
    );

    expect(plugin.name).toBe('vite:extra-app-config');
    expect(nodeUtils.readPackageJSON).toHaveBeenCalledWith(appRoot);
    expect(nodeUtils.generatorContentHash).toHaveBeenCalledWith(source, 8);
    expect(src).toBe('/admin/_app.config.js?v=9.9.9-HASH1234');
    expect(result).toEqual({
      html: '<html></html>',
      tags: [
        {
          attrs: { src: '/admin/_app.config.js?v=9.9.9-HASH1234' },
          tag: 'script',
        },
      ],
    });
  });

  it('公共路径已带斜杠时不重复拼接', /** 双斜杠会让静态资源地址失效。 */ async () => {
    createAppRoot({ '.env': 'VITE_APP_TITLE=管理平台\n' });
    const plugin = await getPlugin();

    const { src } = await runBuildHooks(plugin, '/admin/', 'production');

    expect(src).toBe('/admin/_app.config.js?v=9.9.9-HASH1234');
  });

  it('生成的脚本在真实运行时冻结并写入运行时配置', /** 只断言字符串会漏掉"脚本执行后配置不可篡改"这一真实契约。 */ async () => {
    createAppRoot({
      '.env': 'VITE_APP_TITLE=管理平台\nVITE_BASE=/admin/\n',
      '.env.production': 'VITE_PORT=6200\n',
    });
    const plugin = await getPlugin();
    const { source } = await runBuildHooks(plugin, '/admin', 'production');
    const sandbox: { window: Record<string, unknown> } = { window: {} };
    const context = createContext(sandbox);

    runInContext(source, context);

    expect(sandbox.window[CONFIG_VARIABLE]).toEqual({
      VITE_APP_TITLE: '管理平台',
      VITE_BASE: '/admin/',
      VITE_PORT: '6200',
    });
    expect(Object.isFrozen(sandbox.window[CONFIG_VARIABLE])).toBe(true);
    expect(
      Reflect.defineProperty(sandbox.window, CONFIG_VARIABLE, { value: {} }),
    ).toBe(false);
  });

  it('应用提供 docker 配置时原样输出该文件', /** 原样输出被改写会让 Docker 部署与本地预览的默认配置分叉。 */ async () => {
    const runtimeConfig = 'window._VBEN_ADMIN_PRO_APP_CONF_={from:"docker"};';
    createAppRoot({ '.env': 'VITE_APP_TITLE=管理平台\n' });
    mkdirSync(join(appRoot, 'docker'), { recursive: true });
    writeFileSync(join(appRoot, 'docker', 'app.config.js'), runtimeConfig);
    const plugin = await getPlugin();

    const { source } = await runBuildHooks(plugin, '/admin', 'production');

    expect(source).toBe(runtimeConfig);
  });

  it('产物输出阶段写出运行时配置文件', /** 资源不写进产物会让部署缺少运行时配置。 */ async () => {
    createAppRoot({ '.env': 'VITE_APP_TITLE=管理平台\n' });
    const plugin = await getPlugin();
    const { source } = await runBuildHooks(plugin, '/admin', 'production');
    const emitFile = vi.fn();
    const log = vi
      .spyOn(console, 'log')
      .mockImplementation(/** 静默预期内的输出，避免污染测试结果。 */ () => {});

    await plugin.generateBundle?.call({ emitFile });

    expect(emitFile).toHaveBeenCalledWith({
      fileName: '_app.config.js',
      source,
      type: 'asset',
    });
    expect(log).toHaveBeenCalledWith(
      'configuration file is build successfully!',
    );

    log.mockRestore();
  });

  it('写出失败时记录错误且不抛出', /** 输出失败必须留下可定位日志，否则构建会静默缺少配置。 */ async () => {
    createAppRoot({ '.env': 'VITE_APP_TITLE=管理平台\n' });
    const plugin = await getPlugin();
    await plugin.configResolved?.({ base: '/admin', mode: 'production' });
    const failure = new Error('DUMMY-emit-failure');
    const emitFile = vi.fn(
      /** 模拟产物写入边界失败，验证插件的兜底日志。 */ () => {
        throw failure;
      },
    );
    const log = vi
      .spyOn(console, 'log')
      .mockImplementation(/** 静默预期内的输出，避免污染测试结果。 */ () => {});

    await plugin.generateBundle?.call({ emitFile });

    expect(log).toHaveBeenCalledWith(
      `configuration file failed to package:\n${String(failure)}`,
    );

    log.mockRestore();
  });
});
