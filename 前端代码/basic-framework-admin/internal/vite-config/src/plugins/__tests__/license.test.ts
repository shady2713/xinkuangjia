/**
 * Vite 许可证头插件（vite-config 的 plugins/license）真实行为回归。
 *
 * 该插件在构建产物生成阶段把版权头写入入口 chunk：作者既可能是字符串也可能是对象，
 * 包清单缺字段时必须有稳定兜底，非入口 chunk 与静态资源不能被改写，否则会把版权头
 * 插到资源文件里破坏产物。用例只把包清单读取与日期工具替换为局部替身：它们来自
 * `@vben/node-utils`，其 dist 经 jiti 二次装载会污染该包源码的覆盖率测量。
 */
import { EOL } from 'node:os';

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
     */
    handler: (options: unknown, bundle: Record<string, unknown>) => void;
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

/** 生成期望的版权头文本，与插件声明的字段顺序保持一致。 */
function expectedCopyright() {
  return `/*!
  * 演示应用
  * Version: 1.2.3
  * Author: 张三
  * License: MIT License
  * Description: 演示描述
  * Date Created: ${boundary.date}
  * Homepage: https://example.com
  * Contact: zhangsan@example.com
*/`;
}

describe('许可证头写入', /** 版权头只应写入入口 chunk，且字段与作者形态都要正确落值。 */ () => {
  it('把版权头插入入口 chunk 且不改动其它产物', /** 改写非入口 chunk 或资源会破坏产物内容与资源完整性。 */ async () => {
    boundary.packageJSON = {
      author: { email: 'zhangsan@example.com', name: '张三' },
      description: '演示描述',
      homepage: 'https://example.com',
      name: '演示应用',
      version: '1.2.3',
    };
    const plugin = (await viteLicensePlugin('/probe')) as LicensePlugin;
    const bundle = createBundle();

    plugin.generateBundle.handler({}, bundle);

    expect((bundle['index.js'] as { code: string }).code).toBe(
      `${expectedCopyright()}${EOL}console.log(1);`,
    );
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
    const plugin = (await viteLicensePlugin('/probe')) as LicensePlugin;
    const bundle = createBundle();

    plugin.generateBundle.handler({}, bundle);

    const code = (bundle['index.js'] as { code: string }).code;
    expect(code).toContain('  * Author: 李四');
    expect(code).toContain('  * Contact: ');
    expect(code).toContain('  * Version: 0.0.1');
  });

  it('包清单缺少作者、名称等字段时使用稳定兜底', /** 缺少字段时输出 undefined 会让版权头不完整且难以追责。 */ async () => {
    boundary.packageJSON = {};
    const plugin = (await viteLicensePlugin('/probe')) as LicensePlugin;
    const bundle = createBundle();

    plugin.generateBundle.handler({}, bundle);

    const code = (bundle['index.js'] as { code: string }).code;
    expect(code).toContain('  * Admin Console');
    expect(code).toContain('  * Author: project-team');
    expect(code).toContain('  * Version: ');
    expect(code).toContain('  * Description: ');
    expect(code).toContain('  * Homepage: ');
    expect(code).toContain('  * Contact: ');
  });

  it('作者对象缺少姓名与邮箱时按兜底值写入', /** 对象形态的作者缺少字段时不能输出 undefined。 */ async () => {
    boundary.packageJSON = { author: {}, name: '演示应用', version: '2.0.0' };
    const plugin = (await viteLicensePlugin('/probe')) as LicensePlugin;
    const bundle = createBundle();

    plugin.generateBundle.handler({}, bundle);

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
    const plugin = (await viteLicensePlugin('/probe')) as LicensePlugin;

    expect(plugin.name).toBe('vite:license');
    expect(plugin.apply).toBe('build');
    expect(plugin.enforce).toBe('post');
    expect(plugin.generateBundle.order).toBe('post');
  });
});
