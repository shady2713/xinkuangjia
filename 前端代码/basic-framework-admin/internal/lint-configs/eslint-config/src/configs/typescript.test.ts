// @vitest-environment node
/** 通过真实仓库配置验证 TS 与 Vue 共同拒绝显式 any 和禁用类型检查的指令。 */
import { fileURLToPath, URL as NodeURL } from 'node:url';

import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const cwd = fileURLToPath(new NodeURL('../../../../../', import.meta.url));
const eslint = new ESLint({ cwd });

/** TypeScript 探针文件路径，同时用于指令与合法代码用例。 */
const PROBE_TS_PATH = 'apps/web-ele/src/api/core/type-rule-probe.ts';

/** 显式 any 夹具：路径与源码，预热与断言共用同一份数据。 */
const ANY_PROBES: [string, string][] = [
  [PROBE_TS_PATH, 'export const item: any = null;'],
  [
    'apps/web-ele/src/views/type-rule-probe.vue',
    '<script setup lang="ts">const item: any = null;</script><template><span>{{ item }}</span></template>',
  ],
];

/** 禁用类型检查的指令夹具：描述不能把整段类型检查关闭变成合法例外。 */
const COMMENT_DIRECTIVES = ['ts-ignore', 'ts-nocheck'];

/** 指令用例的真实源码，按指令名拼接注释行。 */
function directiveSource(directive: string): string {
  return `// @${directive} 临时隐藏类型错误的说明\nexport const value: number = 'bad';`;
}

/** 合法边界源码：显式收窄 unknown，不应触发类型门禁。 */
const ALLOWED_SOURCE =
  'export function text(value: unknown): string { return typeof value === "string" ? value : ""; }';

describe('严格类型规则的真实消费者', /** 防止规则只安装到 TS 而漏掉 Vue SFC。 */ () => {
  // 完整仓库配置会加载所有插件，冷启动独立于规则执行；并行构建时可能超过单例默认时限。
  beforeAll(
    /** 先完成真实工具链冷启动，并预热每条断言用到的真实 lint 路径，不给规则断言增加跳过路径。 */ async () => {
      for (const [filePath, source] of ANY_PROBES) {
        await eslint.calculateConfigForFile(filePath);
        await eslint.lintText(source, { filePath });
      }
      for (const directive of COMMENT_DIRECTIVES) {
        await eslint.lintText(directiveSource(directive), {
          filePath: PROBE_TS_PATH,
        });
      }
      await eslint.lintText(ALLOWED_SOURCE, { filePath: PROBE_TS_PATH });
    },
    60_000,
  );

  it.each(ANY_PROBES)(
    '拒绝 %s 的显式 any',
    /** 使用真实配置解析目标文件，核对诊断来自目标规则。 */ async (
      filePath,
      source,
    ) => {
      const config = await eslint.calculateConfigForFile(filePath);
      expect(config.rules['@typescript-eslint/no-explicit-any']).toEqual([2]);
      const results = await eslint.lintText(source, { filePath });
      expect(
        results
          .flatMap(
            /** 从全部消息中独立选取类型门禁结果。 */ (result) =>
              result.messages,
          )
          .filter(
            /** 只断言本规则拒绝，不受格式诊断影响。 */ (message) =>
              message.ruleId === '@typescript-eslint/no-explicit-any',
          ),
      ).toHaveLength(1);
    },
  );

  it.each(COMMENT_DIRECTIVES)(
    '即使附带描述也拒绝 %s',
    /** 描述不能将整段类型检查关闭变成合法例外。 */ async (directive) => {
      const results = await eslint.lintText(directiveSource(directive), {
        filePath: PROBE_TS_PATH,
      });
      expect(
        results
          .flatMap(/** 收集实际配置的指令诊断。 */ (result) => result.messages)
          .some(
            /** 确认禁令由 TS 插件执行。 */ (message) =>
              message.ruleId === '@typescript-eslint/ban-ts-comment',
          ),
      ).toBe(true);
    },
  );

  it('允许有类型且显式收窄未知输入的正常代码', /** 合法边界不应为了强制门禁而产生误报。 */ async () => {
    const results = await eslint.lintText(ALLOWED_SOURCE, {
      filePath: PROBE_TS_PATH,
    });
    expect(
      results
        .flatMap(/** 收集真实消息。 */ (result) => result.messages)
        .filter(
          /** 只筛选本次规则的失败。 */ (message) =>
            [
              '@typescript-eslint/ban-ts-comment',
              '@typescript-eslint/no-explicit-any',
            ].includes(message.ruleId ?? ''),
        ),
    ).toEqual([]);
  });
});
