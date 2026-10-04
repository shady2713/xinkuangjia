/**
 * 构建期 import map 插件（internal/vite-config 的 plugins/importmap）真实行为回归。
 *
 * 该插件在非 SSR 的生产构建里把 importmap 选项与 inputMap 中的依赖交给 jspm 生成器安装，
 * 由 external 插件把这些依赖标记为 external，最后把生成的 import map 与 es-module-shims
 * 注入 HTML：external 判定集合漏项会让依赖被打进产物、多项会让业务模块被误判为外部依赖；
 * 非构建或 SSR 构建仍改写解析会让开发与 SSR 产物丢失本地模块；安装失败时未中止构建会产出
 * 缺少依赖映射的产物；HTML 注入顺序写错会让 import map 晚于业务模块解析；未压缩 HTML 会把
 * 注入脚本原样暴露到产物里。
 *
 * 用例真实驱动插件的 config、resolveId、buildEnd 与 transformIndexHtml 钩子，只把 jspm
 * 依赖安装这一外部网络边界替换为受控替身（真实安装会访问 jspm.io）。
 */
import type { GeneratorOptions } from '@jspm/generator';
import type { Plugin } from 'vite';

import { Generator } from '@jspm/generator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { viteImportMapPlugin } from '../importmap';

/** 插件选项类型，与生产声明保持一致。 */
type PluginOptions = GeneratorOptions & {
  debug?: boolean;
  defaultProvider?: 'esm.sh' | 'jsdelivr' | 'jspm.io';
  importmap?: Array<{ name: string; range?: string }>;
};

/** 外部依赖名，用于核对 external 判定集合。 */
const DEP_NAME = 'DUMMY-DEP';

/** 作用域依赖名，用于核对 inputMap.scopes 也会进入判定集合。 */
const SCOPED_DEP_NAME = 'DUMMY-SCOPED';

/** 带 module 入口的 HTML 夹具，用于核对 shims 与 import map 的注入结果。 */
const HTML_FIXTURE =
  '<html><head></head><body><script type="module" src="/src/main.ts"></script></body></html>';

/** 不含 module 入口的 HTML 夹具，用于核对缺少入口时的兜底渲染。 */
const HTML_WITHOUT_ENTRY =
  '<html><head></head><body><div id="app"></div></body></html>';

/** 插件钩子视图：用例只驱动被测插件声明的钩子。 */
interface PluginHooks {
  /** 构建结束钩子。 */
  buildEnd?: () => void;
  /** 构建配置钩子，用于标记当前命令与是否 SSR 构建。 */
  config?: (
    config: Record<string, unknown>,
    env: { command: string; isSsrBuild?: boolean },
  ) => unknown;
  /** 模块解析钩子。 */
  resolveId?: (id: string) => unknown;
  /** HTML 转换钩子。 */
  transformIndexHtml?: {
    /** 执行 HTML 改写。 */
    handler: (html: string) => Promise<unknown>;
    /** 改写顺序。 */
    order?: string;
  };
}

/** HTML 转换结果视图：只读取注入的标签与压缩后的 HTML。 */
interface TransformResult {
  /** 压缩后的 HTML。 */
  html?: string;
  /** 注入的标签列表。 */
  tags?: Array<{
    attrs?: Record<string, string>;
    children?: string;
    tag?: string;
  }>;
}

/**
 * 把 Vite 插件收窄为可驱动的钩子视图。
 * @param plugin Vite 插件对象；调用方在缺项时传入空对象，只读取存在的钩子。
 * @returns 钩子视图。
 */
function hooksOf(plugin: Partial<Plugin>) {
  return plugin as unknown as PluginHooks;
}

/**
 * 按名称取出插件组中的插件。
 * @param plugins 插件组。
 * @param name 插件名。
 * @returns 命中的插件钩子视图。
 * @throws Error 找不到该插件时抛出，避免用例静默地什么都不验证。
 */
function pluginNamed(plugins: Plugin[], name: string) {
  const plugin = plugins.find(
    /** 只挑出目标插件，其余插件与本断言无关。 */ (item) => item.name === name,
  );
  if (!plugin) {
    throw new Error(`插件组缺少：${name}`);
  }
  return hooksOf(plugin);
}

/**
 * 驱动插件的构建配置钩子，标记当前命令与是否 SSR 构建。
 * @param plugins 插件组。
 * @param env 构建环境：命令与是否 SSR 构建。
 */
async function configure(
  plugins: Plugin[],
  env: { command: string; isSsrBuild?: boolean },
) {
  await pluginNamed(plugins, 'importmap:external').config?.({}, env);
}

/**
 * 构造带外部依赖的插件选项。
 * @param extra 需要额外覆盖的插件选项。
 * @returns 插件选项。
 */
function optionsWithDeps(extra: PluginOptions = {}): PluginOptions {
  return {
    inputMap: {
      imports: { [DEP_NAME]: 'https://example.invalid/dep.js' },
      scopes: {
        'https://example.invalid/': {
          [SCOPED_DEP_NAME]: 'https://example.invalid/s.js',
        },
      },
    },
    ...extra,
  } as PluginOptions;
}

/**
 * 取出 HTML 转换结果。
 * @param result 钩子返回的未知结果。
 * @returns 转换结果视图。
 * @throws TypeError 结果不是对象时抛出，避免用例静默地什么都不验证。
 */
function transformResult(result: unknown) {
  if (result === null || typeof result !== 'object') {
    throw new TypeError('HTML 转换未返回结果对象');
  }
  return result as TransformResult;
}

beforeEach(
  /** 每例拦截控制台输出，避免插件与生成器的日志污染测试报告。 */ () => {
    vi.spyOn(console, 'error').mockImplementation(
      /** 丢弃错误输出，断言通过调用记录完成。 */ () => {},
    );
    vi.spyOn(console, 'log').mockImplementation(
      /** 丢弃普通输出，断言通过调用记录完成。 */ () => {},
    );
  },
);

afterEach(
  /** 恢复控制台输出与依赖安装替身，避免影响其它用例。 */ () => {
    vi.restoreAllMocks();
  },
);

describe('import map 插件装配', /** 插件顺序与生效阶段决定依赖何时被标记为 external。 */ () => {
  it('按 pre 与 post 顺序返回三个插件', /** 顺序写错会让依赖在标记前就被打包或被误判为外部依赖。 */ async () => {
    const plugins = await viteImportMapPlugin();

    expect(
      plugins.map(/** 取出插件名用于核对顺序。 */ (item) => item.name),
    ).toEqual(['importmap:external', 'importmap:install', 'importmap:html']);
    expect(plugins[0]?.enforce).toBe('pre');
    expect(plugins[1]?.enforce).toBe('post');
    expect(plugins[2]?.enforce).toBe('post');
    expect(hooksOf(plugins[2] ?? {}).transformIndexHtml?.order).toBe('post');
  });

  it('把 importmap 选项与输入映射合并为 external 判定集合', /** 漏项会让依赖被打进产物，多项会让业务模块被误判为外部依赖。 */ async () => {
    const plugins = await viteImportMapPlugin(
      optionsWithDeps({
        importmap: [{ name: 'DUMMY-EXTRA', range: '^1.0.0' }],
      }),
    );
    const external = pluginNamed(plugins, 'importmap:external');

    await configure(plugins, { command: 'build' });

    for (const id of [DEP_NAME, SCOPED_DEP_NAME, 'DUMMY-EXTRA']) {
      expect(external.resolveId?.(id)).toEqual({ external: true, id });
    }
    expect(external.resolveId?.('./local-module')).toBeNull();
  });

  it('非构建阶段不改写模块解析', /** 开发阶段改写解析会让本地模块被当成外部依赖。 */ async () => {
    const plugins = await viteImportMapPlugin(optionsWithDeps());
    const external = pluginNamed(plugins, 'importmap:external');

    await configure(plugins, { command: 'serve' });

    expect(external.resolveId?.(DEP_NAME)).toBeNull();
  });

  it('sSR 构建不改写模块解析', /** SSR 产物把依赖标记为外部会让服务端缺少依赖。 */ async () => {
    const plugins = await viteImportMapPlugin(optionsWithDeps());
    const external = pluginNamed(plugins, 'importmap:external');

    await configure(plugins, { command: 'build', isSsrBuild: true });

    expect(external.resolveId?.(DEP_NAME)).toBeNull();
  });
});

describe('import map 依赖安装', /** 安装阶段决定 import map 能否在构建期生成。 */ () => {
  it('首次解析时安装每个 importmap 依赖且只安装一次', /** 漏装会让 import map 缺少映射，重复安装会拖慢构建。 */ async () => {
    const installSpy = vi.spyOn(Generator.prototype, 'install');
    installSpy.mockImplementation(
      /** 让安装在本地立即成功，避免访问真实依赖源。 */ async () => ({
        dynamicDeps: [],
        staticDeps: [],
      }),
    );
    const plugins = await viteImportMapPlugin({
      importmap: [{ name: 'DUMMY-EXTRA', range: '^1.0.0' }],
    });
    const install = pluginNamed(plugins, 'importmap:install');

    await configure(plugins, { command: 'build' });
    expect(await install.resolveId?.('DUMMY-EXTRA')).toBeNull();
    expect(installSpy).toHaveBeenCalledTimes(1);
    expect(installSpy).toHaveBeenCalledWith({
      range: '^1.0.0',
      target: 'DUMMY-EXTRA',
    });

    await install.resolveId?.('DUMMY-EXTRA');
    expect(installSpy).toHaveBeenCalledTimes(1);
  });

  it('未配置 importmap 依赖时不发起安装', /** 无依赖时仍安装会发起无意义的网络请求。 */ async () => {
    const installSpy = vi.spyOn(Generator.prototype, 'install');
    const plugins = await viteImportMapPlugin(optionsWithDeps());
    const install = pluginNamed(plugins, 'importmap:install');

    await configure(plugins, { command: 'build' });
    await install.resolveId?.('anything');

    expect(installSpy).not.toHaveBeenCalled();
    // 安装阶段完成标记由 html 插件的 buildEnd 校验，未安装才需要中止构建。
    expect(
      /** 已完成安装或 SSR 构建时不应中止构建。 */ () =>
        pluginNamed(plugins, 'importmap:html').buildEnd?.(),
    ).not.toThrow();
  });

  it('安装同步失败时记录原始错误并中止构建', /** 未中止构建会产出缺少依赖映射的产物，丢失原始错误会让排查困难。 */ async () => {
    const failure = new Error('DUMMY-安装失败');
    const installSpy = vi.spyOn(Generator.prototype, 'install');
    installSpy.mockImplementation(
      /** 让安装在本地同步失败，复刻生成器不可用时的错误处理契约。 */ () => {
        throw failure;
      },
    );
    const plugins = await viteImportMapPlugin({
      importmap: [{ name: 'DUMMY-EXTRA' }],
    });
    const install = pluginNamed(plugins, 'importmap:install');

    await configure(plugins, { command: 'build' });
    await install.resolveId?.('DUMMY-EXTRA');

    expect(
      /** 未完成安装时必须中止构建。 */ () =>
        pluginNamed(plugins, 'importmap:html').buildEnd?.(),
    ).toThrow('Importmap installation failed.');
    expect(console.error).toHaveBeenCalledWith(failure);
  });

  it('sSR 构建不校验安装结果', /** SSR 构建本就不注入 import map，误中止会让 SSR 无法产出。 */ async () => {
    const plugins = await viteImportMapPlugin();

    await configure(plugins, { command: 'build', isSsrBuild: true });

    expect(
      /** 已完成安装或 SSR 构建时不应中止构建。 */ () =>
        pluginNamed(plugins, 'importmap:html').buildEnd?.(),
    ).not.toThrow();
  });

  it('开启调试时插件仍能正常解析与结束构建', /** 调试分支写错会让构建在开启 debug 后无法结束。 */ async () => {
    const plugins = await viteImportMapPlugin(optionsWithDeps({ debug: true }));
    const install = pluginNamed(plugins, 'importmap:install');

    await configure(plugins, { command: 'build' });
    await install.resolveId?.('anything');

    expect(
      /** 已完成安装或 SSR 构建时不应中止构建。 */ () =>
        pluginNamed(plugins, 'importmap:html').buildEnd?.(),
    ).not.toThrow();
  });
});

describe('import map 的 HTML 注入', /** 注入结果决定浏览器能否按 import map 解析依赖。 */ () => {
  it('注入 import map 与 es-module-shims 并压缩 HTML', /** 未注入会让浏览器无法解析裸模块名，未压缩会把注入脚本原样暴露。 */ async () => {
    const plugins = await viteImportMapPlugin();
    const html = pluginNamed(plugins, 'importmap:html');

    await configure(plugins, { command: 'build' });
    const result = transformResult(
      await html.transformIndexHtml?.handler(HTML_FIXTURE),
    );

    expect(result.tags).toHaveLength(1);
    expect(result.tags?.[0]).toMatchObject({
      attrs: { type: 'importmap' },
      tag: 'script',
    });
    expect(result.tags?.[0]?.children).toBe(JSON.stringify({}));
    expect(result.html).toContain(
      'es-module-shims@1.10.0/dist/es-module-shims.js',
    );
    expect(result.html).toContain('/src/main.ts');
    expect(result.html).not.toContain('\n  ');
  });

  it('按声明的 provider 选择 shims 来源', /** provider 写错会让浏览器从不可用的 CDN 拉取 shims。 */ async () => {
    const expected = {
      'esm.sh': 'https://esm.sh/es-module-shims@1.10.0',
      jsdelivr: 'https://cdn.jsdelivr.net/npm/es-module-shims@1.10.0',
      'jspm.io': 'https://ga.jspm.io/npm:es-module-shims@1.10.0',
    };

    for (const [provider, prefix] of Object.entries(expected)) {
      const plugins = await viteImportMapPlugin({
        defaultProvider: provider as PluginOptions['defaultProvider'],
      });
      const html = pluginNamed(plugins, 'importmap:html');
      await configure(plugins, { command: 'build' });
      const result = transformResult(
        await html.transformIndexHtml?.handler(HTML_FIXTURE),
      );

      expect(result.html).toContain(prefix);
    }
  });

  it('未声明 provider 时回退到 jspm.io', /** 缺少默认值会让 shims 地址为空，浏览器无法加载 polyfill。 */ async () => {
    const plugins = await viteImportMapPlugin({ defaultProvider: undefined });
    const html = pluginNamed(plugins, 'importmap:html');
    await configure(plugins, { command: 'build' });
    const result = transformResult(
      await html.transformIndexHtml?.handler(HTML_FIXTURE),
    );

    expect(result.html).toContain(
      'https://ga.jspm.io/npm:es-module-shims@1.10.0',
    );
  });

  it('缺少 module 入口时仍注入 import map', /** 缺少入口就跳过注入会让多页产物拿不到依赖映射。 */ async () => {
    const plugins = await viteImportMapPlugin();
    const html = pluginNamed(plugins, 'importmap:html');
    await configure(plugins, { command: 'build' });
    const result = transformResult(
      await html.transformIndexHtml?.handler(HTML_WITHOUT_ENTRY),
    );

    expect(result.tags).toHaveLength(1);
    expect(result.html).toContain('id="app"');
    // 没有 module 入口时无处挂载 shims polyfill，只能注入 import map 本身。
    expect(result.html).not.toContain('importShim');
  });

  it('非构建阶段原样返回 HTML', /** 开发阶段注入会让 Vite 的模块解析被 import map 覆盖。 */ async () => {
    const plugins = await viteImportMapPlugin();
    const html = pluginNamed(plugins, 'importmap:html');
    await configure(plugins, { command: 'serve' });

    await expect(html.transformIndexHtml?.handler(HTML_FIXTURE)).resolves.toBe(
      HTML_FIXTURE,
    );
  });

  it('sSR 构建原样返回 HTML', /** SSR 产物注入 import map 会让服务端渲染结果带上浏览器专用脚本。 */ async () => {
    const plugins = await viteImportMapPlugin();
    const html = pluginNamed(plugins, 'importmap:html');
    await configure(plugins, { command: 'build', isSsrBuild: true });

    await expect(html.transformIndexHtml?.handler(HTML_FIXTURE)).resolves.toBe(
      HTML_FIXTURE,
    );
  });
});
