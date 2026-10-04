// @vitest-environment node
/** eslint-comments 插件规则配置测试：验证规则被真实装配为错误级，而不是只声明插件。 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { comments } from './comments';

/** 记录被测配置对插件加载入口的实际使用情况。 */
const plugin = vi.hoisted(
  /** 提供最小可用插件替身，用于核对配置把哪个对象装配进 plugins。 */ () => ({
    name: 'eslint-comments',
    rules: {},
  }),
);

vi.mock(
  'eslint-plugin-eslint-comments',
  /** 该包无类型声明；只观察配置结果，不加载真实插件实现。 */ () => ({
    default: plugin,
  }),
);

describe('eslint comments 配置', /** 注释指令类规则必须全部启用为 error，否则禁用注释会静默通过门禁。 */ () => {
  let configs: Awaited<ReturnType<typeof comments>>;

  beforeAll(
    /** 只调用一次真实配置入口，供各条规则断言复用。 */ async () => {
      configs = await comments();
    },
  );

  it('装配 eslint-comments 插件与四条错误级规则', /** 规则缺失或降级为警告都会让无依据的 eslint-disable 进入代码库。 */ () => {
    expect(configs).toHaveLength(1);
    expect(configs[0]).toEqual({
      plugins: {
        'eslint-comments': plugin,
      },
      rules: {
        'eslint-comments/no-aggregating-enable': 'error',
        'eslint-comments/no-duplicate-disable': 'error',
        'eslint-comments/no-unlimited-disable': 'error',
        'eslint-comments/no-unused-enable': 'error',
      },
    });
  });

  it('同一规则不会以更低级别重复配置', /** 最后一处配置生效，重复声明容易掩盖被降级的问题。 */ () => {
    const rules = configs.flatMap(
      /** 汇总实际生效的规则条目。 */ (config) =>
        Object.entries(config.rules ?? {}),
    );
    const names = rules.map(/** 只保留规则名用于查重。 */ ([name]) => name);

    expect(new Set(names).size).toBe(names.length);
    expect(
      rules.every(
        /** 门禁规则不允许出现 warn 或 off。 */ ([, level]) =>
          level === 'error',
      ),
    ).toBe(true);
  });
});
