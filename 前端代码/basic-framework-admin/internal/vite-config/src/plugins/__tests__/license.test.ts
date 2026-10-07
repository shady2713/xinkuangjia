/**
 * Vite 许可证头插件（vite-config 的 plugins/license）真实行为回归。
 *
 * 该插件在构建产物生成阶段把版权头写入入口 chunk，并把工作区已有的 LICENSE 原文作为
 * 静态资源输出：作者既可能是字符串也可能是对象，包清单缺字段时必须有稳定兜底，
 * 非入口 chunk 与静态资源不能被改写，否则会把版权头插到资源文件里破坏产物。
 * 版权头的许可行取自包清单自身声明的 `license`，清单未声明时如实写"未声明"，
 * 插件不硬编码任何许可证。用例只把包清单读取与日期工具替换为局部替身：它们来自
 * `@vben/node-utils`，其 dist 经 jiti 二次装载会污染该包源码的覆盖率测量；
 * 工作区 LICENSE 的存在性与原文改用系统临时目录中的真实文件核对，不替身文件系统。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { EOL, tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { viteLicensePlugin } from '../license';

/** 用例可设置的包清单内容与日期字符串；由模块替身读取。 */
const boundary = vi.hoisted(
  /** 建立包清单与日期替身的可设置容器。 */ () => ({
    date: '2026-01-02',
    packageJSON: {} as Record<string, unknown>,
  }),
);

vi.mock(
  '@vben/node-utils',
  /** 只替换包清单读取与日期格式化边界，插件自身的拼装与遍历逻辑保持真实实现。 */ () => ({
    /** 返回用例设置的包清单内容；用例可临时改为拒绝以验证失败传播。 */
    readPackageJSON: vi.fn(
      /** 静态返回当前包清单替身。 */ async () => boundary.packageJSON,
    ),
    /** 返回只实现 format 的日期替身，并记录调用参数。 */
    dateUtil: () => ({
      format: vi.fn(
        /** 返回固定日期，使断言不依赖运行时刻。 */ () => boundary.date,
      ),
    }),
  }),
);

/** Rollup 插件上下文替身：只保留静态资源输出，其余钩子本用例不驱动。 */
type EmitContext = {
  /** 记录插件输出的一条静态资源。 */
  emitFile: (file: Record<string, unknown>) => void;
};

/** 插件对象中本用例需要驱动的字段；Vite 的联合返回类型此处按实际结构收窄。 */
type LicensePlugin = {
  /** 插件执行阶段标记。 */
  apply?: string;
  /** 插件执行时机标记。 */
  enforce?: string;
  /** 产物生成钩子；order 决定它在其它钩子之后运行。 */
  generateBundle: {
    /**
     * 驱动一次产物生成。
     * @param options 归一化后的产物输出选项，本替身不解释。
     * @param bundle 产物清单，含入口 chunk、非入口 chunk 与静态资源。
     * @this Rollup 插件上下文，替身只提供 emitFile 以接住静态资源输出。
     */
    handler: (
      this: EmitContext,
      options: unknown,
      bundle: Record<string, unknown>,
    ) => void;
    order?: string;
  };
  /** 插件名称，用于 Vite 内部识别与用户排查。 */
  name?: string;
};

/** 产物替身：入口 chunk、非入口 chunk 与静态资源各一份。 */
function createBundle() {
  return {
    'assets/logo.svg': { source: '<svg />', type: 'asset' },
    'index.js': { code: 'console.log(1);', isEntry: true, type: 'chunk' },
    'vendor.js': { code: 'export const a = 1;', isEntry: false, type: 'chunk' },
  };
}

/** 清单未声明许可时版权头如实写出的说明文案。 */
const UNDECLARED = '未在包清单中声明（待有权者决定）';

/**
 * 生成期望的版权头文本，与插件声明的字段顺序保持一致。
 * @param declaredLicense 清单声明的许可；未声明时传空串，预期落到如实说明文案。
 * @returns 期望的完整版权头文本。
 */
function expectedCopyright(declaredLicense = '') {
  return `/*!
  * 演示应用
  * Version: 1.2.3
  * Author: 张三
  * Declared License: ${declaredLicense || UNDECLARED}
  * Description: 演示描述
  * Date Created: ${boundary.date}
  * Homepage: https://example.com
  * Contact: zhangsan@example.com
*/`;
}

/**
 * 构造带 emitFile 记录的插件上下文。
 * @returns 上下文对象与记录静态资源输出的调用列表。
 */
function createContext() {
  const emitted: Record<string, unknown>[] = [];
  const context: EmitContext = {
    /** 记录插件输出的静态资源。 */
    emitFile: (file) => {
      emitted.push(file);
    },
  };
  return { context, emitted };
}

/**
 * 把插件工厂的返回收窄到本用例驱动所需的字段。
 *
 * 工厂返回的是 Vite 的 `PluginOption` 联合类型，而本用例要驱动的 `generateBundle`
 * 钩子带 Rollup 插件上下文，两者在结构上并不重叠，直接断言转换会被类型检查拒绝；
 * 这与仓库内其它驱动 Vite 钩子的用例一致，先经 `unknown` 收窄再逐字段精确断言。
 *
 * @param plugin 插件工厂返回值。
 * @returns 可直接驱动钩子的窄类型视图。
 */
function toLicensePlugin(plugin: unknown) {
  return plugin as LicensePlugin;
}

/**
 * 在系统临时目录里造一个最小工作区，真实写入或省略工作区根的 LICENSE。
 *
 * 插件按 `应用根/../..` 定位工作区许可证，这里造 `<临时>/apps/app` 作应用根、
 * `<临时>/LICENSE` 作工作区许可证，路径关系与真实构建一致。
 *
 * @param licenseText 工作区 LICENSE 原文；传 null 表示该文件不存在。
 * @returns 应用根目录与清理函数。
 */
function createWorkspace(licenseText: null | string) {
  const root = mkdtempSync(join(tmpdir(), 'vite-license-'));
  const appRoot = join(root, 'apps', 'app');
  mkdirSync(appRoot, { recursive: true });
  if (licenseText !== null) {
    writeFileSync(join(root, 'LICENSE'), licenseText);
  }
  return {
    appRoot,
    /** 删除本次造出的临时工作区。 */
    cleanup: () => rmSync(root, { force: true, recursive: true }),
  };
}

describe('许可证头写入', /** 版权头只应写入入口 chunk，且字段与作者形态都要正确落值。 */ () => {
  it('把版权头插入入口 chunk 且不改动其它产物', /** 改写非入口 chunk 或资源会破坏产物内容与资源完整性。 */ async () => {
    boundary.packageJSON = {
      author: { email: 'zhangsan@example.com', name: '张三' },
      description: '演示描述',
      homepage: 'https://example.com',
      license: 'Apache-2.0',
      name: '演示应用',
      version: '1.2.3',
    };
    const plugin = toLicensePlugin(await viteLicensePlugin('/probe'));
    const bundle = createBundle();
    const { context, emitted } = createContext();

    plugin.generateBundle.handler.call(context, {}, bundle);

    // 许可行逐字取自包清单声明：插件不硬编码 MIT，清单没写就如实写未声明。
    expect((bundle['index.js'] as { code: string }).code).toBe(
      `${expectedCopyright('Apache-2.0')}${EOL}console.log(1);`,
    );
    expect(emitted).toEqual([]);
    expect((bundle['vendor.js'] as { code: string }).code).toBe(
      'export const a = 1;',
    );
    expect(bundle['assets/logo.svg']).toEqual({
      source: '<svg />',
      type: 'asset',
    });
    expect(bundle['index.js']).toMatchObject({ isEntry: true, type: 'chunk' });
  });

  it('作者写成字符串时按作者名落值且联系方式留空', /** 字符串作者被当成对象会让作者名与联系方式都变成兜底值。 */ async () => {
    boundary.packageJSON = {
      author: '李四',
      description: '',
      homepage: '',
      name: '演示应用',
      version: '0.0.1',
    };
    const plugin = toLicensePlugin(await viteLicensePlugin('/probe'));
    const bundle = createBundle();
    const { context } = createContext();

    plugin.generateBundle.handler.call(context, {}, bundle);

    const code = (bundle['index.js'] as { code: string }).code;
    expect(code).toContain('  * Author: 李四');
    expect(code).toContain('  * Contact: ');
    expect(code).toContain('  * Version: 0.0.1');
  });

  it('清单未声明许可时如实写未声明而不套用任何许可证', /** 硬编码一个看似合理的许可证等于替权利方做许可选择。 */ async () => {
    boundary.packageJSON = {
      author: { email: 'zhangsan@example.com', name: '张三' },
      description: '演示描述',
      homepage: 'https://example.com',
      name: '演示应用',
      version: '1.2.3',
    };
    const plugin = toLicensePlugin(await viteLicensePlugin('/probe'));
    const bundle = createBundle();
    const { context } = createContext();

    plugin.generateBundle.handler.call(context, {}, bundle);

    expect((bundle['index.js'] as { code: string }).code).toBe(
      `${expectedCopyright()}${EOL}console.log(1);`,
    );
    expect((bundle['index.js'] as { code: string }).code).not.toContain('MIT');
  });

  it('工作区存在 LICENSE 时把原文逐字输出为静态资源', /** 交付物要自带许可证文本，缺失上游原文就等于没有随包声明。 */ async () => {
    const source = 'MIT License\n\nCopyright (c) 2024-present, Vben\n';
    const workspace = createWorkspace(source);
    try {
      boundary.packageJSON = {
        license: 'MIT',
        name: '演示应用',
        version: '1.0.0',
      };
      const plugin = toLicensePlugin(
        await viteLicensePlugin(workspace.appRoot),
      );
      const bundle = createBundle();
      const { context, emitted } = createContext();

      plugin.generateBundle.handler.call(context, {}, bundle);

      expect(emitted).toEqual([{ fileName: 'LICENSE', source, type: 'asset' }]);
    } finally {
      workspace.cleanup();
    }
  });

  it('工作区没有 LICENSE 时不产出该静态资源', /** 凭空生成许可证原文会造出不存在的声明。 */ async () => {
    const workspace = createWorkspace(null);
    try {
      boundary.packageJSON = {
        license: 'MIT',
        name: '演示应用',
        version: '1.0.0',
      };
      const plugin = toLicensePlugin(
        await viteLicensePlugin(workspace.appRoot),
      );
      const bundle = createBundle();
      const { context, emitted } = createContext();

      plugin.generateBundle.handler.call(context, {}, bundle);

      expect(emitted).toEqual([]);
    } finally {
      workspace.cleanup();
    }
  });

  it('包清单缺少作者、名称等字段时使用稳定兜底', /** 缺少字段时输出 undefined 会让版权头不完整且难以追责。 */ async () => {
    boundary.packageJSON = {};
    const plugin = toLicensePlugin(await viteLicensePlugin('/probe'));
    const bundle = createBundle();
    const { context } = createContext();

    plugin.generateBundle.handler.call(context, {}, bundle);

    const code = (bundle['index.js'] as { code: string }).code;
    expect(code).toContain('  * Admin Console');
    expect(code).toContain(`  * Declared License: ${UNDECLARED}`);
    expect(code).toContain('  * Author: project-team');
    expect(code).toContain('  * Version: ');
    expect(code).toContain('  * Description: ');
    expect(code).toContain('  * Homepage: ');
    expect(code).toContain('  * Contact: ');
  });

  it('作者对象缺少姓名与邮箱时按兜底值写入', /** 对象形态的作者缺少字段时不能输出 undefined。 */ async () => {
    boundary.packageJSON = { author: {}, name: '演示应用', version: '2.0.0' };
    const plugin = toLicensePlugin(await viteLicensePlugin('/probe'));
    const bundle = createBundle();
    const { context } = createContext();

    plugin.generateBundle.handler.call(context, {}, bundle);

    const code = (bundle['index.js'] as { code: string }).code;
    expect(code).toContain('  * Author: project-team');
    expect(code).toContain('  * Contact: ');
  });

  it('包清单读取失败时插件创建失败', /** 读取失败被吞掉会让产物缺少版权头且构建仍显示成功。 */ async () => {
    const nodeUtils = await import('@vben/node-utils');
    vi.mocked(nodeUtils.readPackageJSON).mockRejectedValueOnce(
      new Error('包清单不存在'),
    );

    await expect(viteLicensePlugin('/probe')).rejects.toThrow('包清单不存在');
  });
});

describe('插件标识', /** 名称、阶段与钩子顺序是 Vite 安装该插件的依据。 */ () => {
  it('固定为构建阶段的后置钩子', /** 阶段或顺序被改动会让版权头在压缩或哈希计算之后写入，产物失效。 */ async () => {
    boundary.packageJSON = { name: '演示应用', version: '1.0.0' };
    const plugin = toLicensePlugin(await viteLicensePlugin('/probe'));

    expect(plugin.name).toBe('vite:license');
    expect(plugin.apply).toBe('build');
    expect(plugin.enforce).toBe('post');
    expect(plugin.generateBundle.order).toBe('post');
  });
});
