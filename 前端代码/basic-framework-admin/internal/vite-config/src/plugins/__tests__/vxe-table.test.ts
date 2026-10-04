/**
 * vxe-table 按需引入插件（plugins/vxe-table.ts）的真实行为回归。
 *
 * 该插件把 `vxe-table` 与 `vxe-pc-ui` 的具名导入改写成组件级路径与样式导入，从而减小构建体积。
 * 用例调用真实的 `transform` 钩子，断言两个组件库各自被改写、其他依赖不受影响。
 * 插件上下文是 Rollup/Vite 提供的外部对象，测试只提供该钩子实际使用的最小接口。
 */
import type { Plugin, PluginOption } from 'vite';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { viteVxeTableImportsPlugin } from '../vxe-table';

/** transform 钩子的调用签名：接收源码与模块路径，返回改写结果。 */
type TransformFn = (code: string, id: string) => unknown;

/** 可绑定上下文的 transform 钩子形状；Vite 插件对象由此提供改写入口。 */
type BindableTransform = {
  /** 绑定插件上下文后得到可调用的改写函数。 */
  bind: (context: unknown) => TransformFn;
};

/**
 * 构造 transform 钩子所需的最小插件上下文。
 * @returns 只提供错误上报与告警的上下文替身。
 */
function pluginContext(): unknown {
  return {
    /** 钩子报告错误时直接抛出，让用例看到真实失败而不是被吞掉。 */
    error: (error: unknown) => {
      throw error instanceof Error ? error : new Error(String(error));
    },
    warn: vi.fn(),
  };
}

/**
 * 取出插件返回的唯一 lazy-import 插件。
 * @param options 被测入口返回的插件集合，可以是异步工厂的 Promise。
 * @returns 提供 transform 钩子的插件。
 * @throws Error 返回形状不符合 Vite 插件约定时抛出，避免用例静默地什么都不验证。
 */
async function transformPlugin(
  options: PluginOption | Promise<PluginOption>,
): Promise<Plugin> {
  const list = (await options) as PluginOption[];
  if (!Array.isArray(list) || list.length === 0) {
    throw new TypeError('vxe-table 插件必须返回非空的插件数组');
  }
  const plugin = list[0] as Plugin;
  if (typeof plugin?.transform !== 'function') {
    throw new TypeError('vxe-table 插件必须提供 transform 钩子');
  }
  return plugin;
}

/**
 * 对该模块执行一次真实的导入改写。
 * @param code 待改写的模块源码。
 * @returns 改写后的源码；未命中改写时返回原始结果对象或 null。
 */
async function runTransform(code: string): Promise<unknown> {
  const plugin = await transformPlugin(viteVxeTableImportsPlugin());
  /** 绑定插件上下文后的改写入口。 */
  const transform = (plugin.transform as BindableTransform).bind(
    pluginContext(),
  );
  return transform(code, '/src/views/demo/index.vue');
}

describe('导入改写（viteVxeTableImportsPlugin）', /** 两个组件库的组件级引入与样式注入。 */ () => {
  beforeAll(
    /**
     * 等待 es-module-lexer 就绪后再断言语义化改写结果。
     * 该词法分析器的 WASM 未初始化时 `parse()` 同步返回 Promise，
     * 第三方插件直接解构会抛「Invalid attempt to destructure non-iterable instance」；
     * 首次失败同时会启动初始化，这里按明确条件轮询等待，不依赖固定休眠，
     * 避免同一文件在不同工作进程调度下偶发失败。
     */
    async () => {
      await vi.waitFor(
        /** 首个改写请求成功返回即表示词法分析器已就绪。 */ async () => {
          await expect(
            runTransform("import { ref } from 'vue';\nconsole.log(ref);\n"),
          ).resolves.toBe(null);
        },
        { interval: 20, timeout: 5000 },
      );
    },
  );

  it('返回单个 lazy-import 插件', /** 插件必须按 Vite 约定返回可注册的插件数组。 */ async () => {
    const list = (await viteVxeTableImportsPlugin()) as Plugin[];

    expect(Array.isArray(list)).toBe(true);
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('vite:lazy-import');
  });

  it('vxe-table 具名导入改写为组件路径与样式', /** 组件级路径是按需引入的核心，缺失会把整库打进产物。 */ async () => {
    const result = (await runTransform(
      "import { VxeGrid } from 'vxe-table';\nconsole.log(VxeGrid);\n",
    )) as { code: string };

    expect(result.code).toContain('vxe-table/es/vxe-grid/index.js');
    expect(result.code).toContain('vxe-table/es/vxe-grid/style.css');
  });

  it('vxe-pc-ui 具名导入同样改写', /** 第二个解析器缺失时该库仍会整包引入。 */ async () => {
    const result = (await runTransform(
      "import { VxeButton } from 'vxe-pc-ui';\nconsole.log(VxeButton);\n",
    )) as { code: string };

    expect(result.code).toContain('vxe-pc-ui/es/vxe-button/index.js');
    expect(result.code).toContain('vxe-pc-ui/es/vxe-button/style.css');
  });

  it('其他依赖的导入不被改写', /** 改写范围必须限制在两个组件库内，避免误伤业务依赖。 */ async () => {
    const result = await runTransform(
      "import { ref } from 'vue';\nconsole.log(ref);\n",
    );

    expect(result).toBe(null);
  });

  it('同一模块内两个组件库的导入都被改写', /** 页面同时使用表格与基础组件时必须都按需引入。 */ async () => {
    const result = (await runTransform(
      "import { VxeGrid, VxeInput } from 'vxe-table';\nimport { VxeButton } from 'vxe-pc-ui';\n",
    )) as { code: string };

    expect(result.code).toContain('vxe-table/es/vxe-grid/index.js');
    expect(result.code).toContain('vxe-table/es/vxe-input/index.js');
    expect(result.code).toContain('vxe-pc-ui/es/vxe-button/index.js');
  });
});
