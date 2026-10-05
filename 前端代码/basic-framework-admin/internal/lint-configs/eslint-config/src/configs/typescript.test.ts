// @vitest-environment node
/** 通过真实仓库配置验证 TS 与 Vue 共同拒绝显式 any 和禁用类型检查的指令。 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL as NodeURL } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

/** 前端工程根，同时作为 ESLint 解析配置的基准目录。 */
const frontend = fileURLToPath(new NodeURL('../../../../../', import.meta.url));

/** 进程外消费者脚本：在独立 Node 进程内加载真实配置并检查源码。 */
const CONSUMER = fileURLToPath(
  new NodeURL('../../tests/eslint-consumer.mjs', import.meta.url),
);

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

/** 需要从真实配置里取出并断言的规则名。 */
const RULE_NAMES = [
  '@typescript-eslint/ban-ts-comment',
  '@typescript-eslint/no-explicit-any',
];

/** 需要交给真实配置解析的目标文件，顺序与断言一一对应。 */
const CONFIG_FILES = ANY_PROBES.map(
  /** 只取夹具路径，源码由 lintText 单独驱动。 */ ([filePath]) => filePath,
);

/** 一次交给子进程检查的全部源码，索引供断言回查。 */
const LINT_TEXTS = [
  ...ANY_PROBES.map(
    /** 显式 any 夹具沿用各自的真实文件路径。 */ ([filePath, source]) => ({
      filePath,
      source,
    }),
  ),
  ...COMMENT_DIRECTIVES.map(
    /** 指令夹具统一挂在 TS 探针路径下，只比较目标规则的诊断。 */ (
      directive,
    ) => ({
      filePath: PROBE_TS_PATH,
      source: directiveSource(directive),
    }),
  ),
  { filePath: PROBE_TS_PATH, source: ALLOWED_SOURCE },
];

/** 单条诊断的断言用字段。 */
interface Diagnostic {
  message: string;
  messageId: null | string;
  ruleId: null | string;
  severity: number;
}

/** 单个文件结果的断言用摘要。 */
interface LintSummary {
  errorCount: number;
  fatalErrorCount: number;
  messages: Diagnostic[];
}

/** 子进程回传的完整消费者输出。 */
interface ConsumerPayload {
  configs: Record<string, Record<string, unknown>>;
  results: Record<string, LintSummary>;
}

/** 指令夹具在 LINT_TEXTS 中的起始下标。 */
const DIRECTIVE_OFFSET = ANY_PROBES.length;

/** 合法代码夹具在 LINT_TEXTS 中的下标。 */
const ALLOWED_INDEX = LINT_TEXTS.length - 1;

/**
 * 在独立 Node 进程内用仓库真实 ESLint 配置解析规则并检查全部夹具。
 *
 * `@vben/eslint-config` 的入口是提交进仓库的 jiti 桩，在 Vitest 进程内调用它会让 jiti
 * 与 vite-node 在同一 isolate 内各执行一遍配置模块，产生两份脚本坐标并让整包覆盖率
 * 分母被判不可信。子进程不被 `node:inspector` 插桩，因此真实 ESLint 的验证内容不变，
 * 而被测进程只剩 vite-node 一条加载路径。
 *
 * @returns 子进程回传的规则配置与逐条诊断。
 * @throws {Error} 子进程非正常退出或回传内容不是合法输出时抛出，避免用空结果冒充通过。
 */
function runConsumer(): ConsumerPayload {
  const result = spawnSync(process.execPath, [CONSUMER], {
    cwd: frontend,
    encoding: 'utf8',
    input: JSON.stringify({
      configFiles: CONFIG_FILES,
      cwd: frontend,
      lintTexts: LINT_TEXTS,
      ruleNames: RULE_NAMES,
    }),
    maxBuffer: 16 * 1024 * 1024,
    timeout: 180_000,
    windowsHide: true,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `进程外 ESLint 消费者退出码 ${result.status}：${result.stderr || result.stdout}`,
    );
  }
  const payload = JSON.parse(result.stdout) as ConsumerPayload;
  if (!payload?.configs || !payload?.results) {
    throw new Error(
      `进程外 ESLint 消费者输出结构无效：${result.stdout.slice(0, 500)}`,
    );
  }
  return payload;
}

/**
 * 取出必须存在的文件摘要，缺失时直接失败并完成类型收窄。
 *
 * `expect()` 不构成类型收窄，摘要读出来仍带 undefined；这里显式判空后再返回确定值，让后续
 * 诊断断言直接读 `messages`，不需要靠可选链回避取值，也不会把缺失当成空诊断而误判通过。
 *
 * @param summary 子进程回传的单个文件摘要，缺失说明对应夹具没有产出结果。
 * @param label 失败信息里的定位标识，用夹具路径或指令名指出缺失的是哪一条。
 * @returns 已确认存在的文件摘要，供后续断言直接读取诊断明细。
 * @throws {Error} 摘要缺失时抛出，避免探针未产出结果被当成规则未命中。
 */
function requireSummary(
  summary: LintSummary | undefined,
  label: string,
): LintSummary {
  if (!summary) {
    throw new Error(`进程外 ESLint 消费者缺少 ${label} 的文件摘要`);
  }
  return summary;
}

describe('严格类型规则的真实消费者', /** 防止规则只安装到 TS 而漏掉 Vue SFC。 */ () => {
  let payload: ConsumerPayload;

  // 完整仓库配置会加载所有插件，冷启动独立于规则执行；并行构建时可能超过单例默认时限。
  beforeAll(
    /** 先让子进程完成真实工具链冷启动，并一次性跑完全部断言用到的真实 lint 路径。 */ () => {
      payload = runConsumer();
    },
    180_000,
  );

  it.each(ANY_PROBES)(
    '拒绝 %s 的显式 any',
    /** 使用真实配置解析目标文件，核对诊断来自目标规则。 */ (
      filePath,
      _source,
    ) => {
      const index = CONFIG_FILES.indexOf(filePath);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(
        payload.configs[filePath]?.['@typescript-eslint/no-explicit-any'],
      ).toEqual([2]);
      const summary = requireSummary(payload.results[index], filePath);
      expect(summary?.fatalErrorCount).toBe(0);
      expect(
        summary.messages.filter(
          /** 只断言本规则拒绝，不受格式诊断影响。 */ (message) =>
            message.ruleId === '@typescript-eslint/no-explicit-any',
        ),
      ).toHaveLength(1);
    },
  );

  it.each(COMMENT_DIRECTIVES)(
    '即使附带描述也拒绝 %s',
    /** 描述不能将整段类型检查关闭变成合法例外。 */ (directive) => {
      const index = COMMENT_DIRECTIVES.indexOf(directive);
      expect(index).toBeGreaterThanOrEqual(0);
      const summary = requireSummary(
        payload.results[DIRECTIVE_OFFSET + index],
        directive,
      );
      expect(summary?.fatalErrorCount).toBe(0);
      expect(
        summary.messages.some(
          /** 确认禁令由 TS 插件执行。 */ (message) =>
            message.ruleId === '@typescript-eslint/ban-ts-comment',
        ),
      ).toBe(true);
    },
  );

  it('允许有类型且显式收窄未知输入的正常代码', /** 合法边界不应为了强制门禁而产生误报。 */ () => {
    const summary = requireSummary(
      payload.results[ALLOWED_INDEX],
      '合法代码夹具',
    );
    expect(summary?.fatalErrorCount).toBe(0);
    expect(
      summary.messages.filter(
        /** 只筛选本次规则的失败。 */ (message) =>
          RULE_NAMES.includes(message.ruleId ?? ''),
      ),
    ).toEqual([]);
  });
});
