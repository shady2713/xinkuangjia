/**
 * 构建期 import map 插件的防御分支（internal/vite-config 的 plugins/importmap）真实行为回归。
 *
 * 插件在三处对上游产出做防御：debug 模式下把 jspm 生成器的日志流打印到控制台；生成器没有
 * 产出 importmap 时原样返回 HTML，避免把空映射注入产物；HTML 里选不到 module 入口时不做
 * shims 注入。这三处都以第三方库的返回值为输入，正常输入下不会触发，因此这里按依赖契约注入
 * 受控边界：只替换 jspm 生成器与 cheerio 的返回值，插件自身的装配、钩子链路与 HTML 压缩仍走
 * 真实实现。边界缺失会让 debug 日志静默丢失、把空 importmap 注入产物，或对空选择器继续改写
 * HTML。
 */
import type { Plugin } from 'vite';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { viteImportMapPlugin } from '../importmap';

/** 受控边界状态：用例通过它决定生成器与选择器的返回值。 */
const boundary = vi.hoisted(
  /** 汇总受控边界状态，供各 mock 工厂在求值时读取。 */ () => ({
    /** 生成器日志流要产出的消息；空数组表示本次不产出任何日志。 */
    logMessages: [] as Array<{ message: string; type: string }>,
    /** getMap 的返回值；undefined 表示生成器没有产出 importmap。 */
    importMap: {
      imports: { 'DUMMY-DEP': 'https://example.invalid/dep.js' },
    } as unknown,
    /** 选择器替身是否返回"没有命中"的空值。 */
    emptySelection: false,
  }),
);

vi.mock(
  '@jspm/generator',
  /**
   * jspm 生成器是外部网络边界：真实实现会访问 jspm.io。这里只替换它的返回值，
   * 让"生成器没有产出 importmap"与"生成器产出日志"这两个上游契约可以被显式构造。
   */ () => ({
    /** 生成器替身：只实现被测插件真正调用的三个入口。 */
    Generator: class {
      /**
       * 产出受控的 importmap。
       * @returns 用例设定的 importmap 取值。
       */
      getMap() {
        return boundary.importMap;
      }

      /**
       * 安装依赖；本替身不发起网络访问。
       * @returns 立即兑现的 Promise。
       */
      install() {
        return Promise.resolve();
      }

      /**
       * 产出受控的日志流。
       * @returns 逐条产出用例设定日志的异步迭代器。
       */
      async *logStream() {
        for (const entry of boundary.logMessages) {
          yield entry;
        }
      }
    },
  }),
);

vi.mock(
  'cheerio',
  /**
   * cheerio 是 HTML 解析边界：真实 load 在任何输入下都返回可用的选择器函数。
   * 这里保留真实实现，只让选择器在"没有命中"时返回空值，用于驱动插件的兜底早退。
   */
  async (importOriginal) => {
    const actual = await importOriginal<typeof import('cheerio')>();
    return {
      ...actual,
      /**
       * 保留真实解析，只按用例开关决定选择器是否交出空值。
       * @param html 待解析的 HTML。
       * @returns 真实选择器，或返回空值的选择器替身。
       */
      load: (html: string) => {
        const $ = actual.load(html);
        if (!boundary.emptySelection) {
          return $;
        }
        /** 返回"没有命中"的空值，驱动插件的兜底早退。 */
        const emptySelection = () => undefined;
        return emptySelection as unknown as typeof $;
      },
    };
  },
);

/** 带 module 入口的 HTML 夹具，用于核对注入结果与压缩结果。 */
const HTML_FIXTURE =
  '<html><head></head><body><script type="module" src="/src/main.ts"></script></body></html>';

/** HTML 转换结果视图：只读取注入的标签与压缩后的 HTML。 */
interface TransformResult {
  /** 压缩后的 HTML。 */
  html?: string;
  /** 注入的标签列表。 */
  tags?: Array<{ attrs?: Record<string, string>; tag?: string }>;
}

/** 插件钩子视图：只声明用例真正驱动的钩子，避免在调用点反复写类型断言。 */
interface PluginHooks {
  /** 构建配置钩子，用于标记当前命令与是否 SSR 构建。 */
  config?: (
    config: Record<string, unknown>,
    env: { command: string; isSsrBuild?: boolean },
  ) => unknown;
  /** HTML 转换钩子，handler 执行真实改写。 */
  transformIndexHtml?: {
    /** 执行 HTML 改写。 */
    handler: (html: string) => Promise<unknown>;
    /** 改写顺序。 */
    order?: string;
  };
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
  // Vite 的钩子类型按联合声明，这里按用例真正驱动的钩子收窄。
  return plugin as unknown as PluginHooks;
}

/**
 * 驱动插件的构建配置钩子，标记当前命令为构建。
 * @param plugins 插件组。
 */
async function configureBuild(plugins: Plugin[]) {
  await pluginNamed(plugins, 'importmap:external').config?.(
    {},
    {
      command: 'build',
    },
  );
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
  /** 重置受控边界并拦截控制台输出，避免插件日志污染测试报告。 */ () => {
    boundary.logMessages = [];
    boundary.importMap = {
      imports: { 'DUMMY-DEP': 'https://example.invalid/dep.js' },
    };
    boundary.emptySelection = false;
    vi.spyOn(console, 'log').mockImplementation(
      /** 丢弃普通输出，断言通过调用记录完成。 */ () => {},
    );
    vi.spyOn(console, 'error').mockImplementation(
      /** 丢弃错误输出，断言通过调用记录完成。 */ () => {},
    );
  },
);

afterEach(
  /** 恢复控制台输出，避免影响其它用例。 */ () => {
    vi.restoreAllMocks();
  },
);

describe('import map 插件的上游产出防御', /** 上游边界缺失时的处置决定产物里会不会留下空映射或丢日志。 */ () => {
  it('开启调试时把生成器日志流打印到控制台', /** 日志流未消费会让 debug 模式静默失效，构建问题无从定位。 */ async () => {
    boundary.logMessages = [{ message: 'DUMMY-安装信息', type: 'info' }];

    await viteImportMapPlugin({ debug: true });

    // 日志由插件创建时启动的异步消费循环读取，等它真实跑完一轮。
    await vi.waitFor(
      /** 等待异步日志循环把消息交给控制台。 */ () => {
        expect(console.log).toHaveBeenCalledWith('info: DUMMY-安装信息');
      },
    );
  });

  it('生成器没有产出 importmap 时原样返回 HTML', /** 空映射被注入产物会让浏览器按错误的映射解析裸模块名。 */ async () => {
    boundary.importMap = undefined;
    const plugins = await viteImportMapPlugin();
    await configureBuild(plugins);

    await expect(
      pluginNamed(plugins, 'importmap:html').transformIndexHtml?.handler(
        HTML_FIXTURE,
      ),
    ).resolves.toBe(HTML_FIXTURE);
  });

  it('选不到 module 入口时跳过 shims 注入但仍注入 importmap', /** 对空选择器继续改写会抛错，整块 HTML 注入失败。 */ async () => {
    boundary.emptySelection = true;
    const plugins = await viteImportMapPlugin();
    await configureBuild(plugins);

    const result = transformResult(
      await pluginNamed(plugins, 'importmap:html').transformIndexHtml?.handler(
        HTML_FIXTURE,
      ),
    );

    // shims 无处挂载：不注入 polyfill，但 importmap 本身仍然注入。
    expect(result.html).toContain('main.ts');
    expect(result.html).not.toContain('importShim');
    expect(result.tags).toHaveLength(1);
    expect(result.tags?.[0]?.attrs?.type).toBe('importmap');
  });
});
