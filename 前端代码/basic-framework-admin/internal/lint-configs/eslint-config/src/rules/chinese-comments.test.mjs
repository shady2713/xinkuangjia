// @vitest-environment node
/**
 * 本工程 ESLint 中文注释规则接入的真实行为回归。
 *
 * `chinese-comments.mjs` 把离线注释检查接进 ESLint，并由 `eslint.config.mjs` 生产使用。
 * 用例直接 import 该模块：一条断言它导出的扁平配置真实内容，其余用**该配置本身**驱动
 * ESLint 的 Linter 检查真实文件与探针正文。之所以不借助 `new ESLint()` 间接加载，是因为
 * `@vben/eslint-config` 的入口是提交进仓库的 jiti 桩，会在同一进程内产生第二份脚本坐标，
 * 让覆盖率分母被判不可信；这里只用配置对象，不做进程内二次加载。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, URL as NodeURL } from 'node:url';

import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';

import { commentConfig } from './chinese-comments.mjs';

/** 前端工程根，作为规则配置的基准目录。 */
const frontend = fileURLToPath(new NodeURL('../../../../../', import.meta.url));

/** 真实被跟踪且当前未被改动的文件，用于核对增量范围的两个方向。 */
const TRACKED_RELATIVE =
  '前端代码/basic-framework-admin/internal/lint-configs/eslint-config/src/rules/web-comments.mjs';

/** 真实被跟踪文件的绝对路径。 */
const TRACKED = fileURLToPath(
  new NodeURL('./web-comments.mjs', import.meta.url),
);

/** 未改动正文里追加的未注释函数，用于制造真实的增量改动行。 */
const APPENDED_FUNCTION = '\nfunction undocumentedProbe() {}\n';

/** 真实模块对同一规则配置的实例，供全量模式断言复用。 */
const config = commentConfig(frontend);

/**
 * 用模块自己导出的配置驱动一次真实检查。
 * @param source 待检查的正文。
 * @param filename 传给 ESLint 的文件名，决定依据的物理路径。
 * @param options 可选覆盖：`all` 表示全量检查，`root` 覆盖 Git 基准目录。
 * @returns ESLint 的真实诊断列表。
 */
function lint(source, filename, options = {}) {
  const merged = {
    ...config,
    ...(options.root
      ? { settings: { ...config.settings, weetionRoot: options.root } }
      : {}),
    rules: {
      'weetion/comments': ['error', options.all ? 'all' : 'changed'],
    },
  };
  return new Linter().verify(source, [merged], { filename });
}

describe('本工程注释规则接入', /** 配置或规则漏装会让整个前端失去中文职责与契约门禁。 */ () => {
  it('导出的扁平配置声明了真实范围、插件与错误级规则', /** 配置被改窄或降级都会让注释门禁静默失效。 */ () => {
    expect(config.name).toBe('weetion/web-comments');
    expect(config.files).toEqual(['**/*.{ts,tsx,js,jsx,mjs,cjs,vue}']);
    expect(config.ignores).toEqual(['**/*.d.ts']);
    expect(config.plugins.weetion.rules.comments).toBeTruthy();
    // 增量基线必须以 Git 仓库根解析：被跟踪文件路径正是相对该根记录的。
    expect(
      existsSync(join(config.settings.weetionRoot, TRACKED_RELATIVE)),
    ).toBe(true);
    expect(config.settings.weetionHead).toMatch(/^[0-9a-f]{7,40}$/u);
    expect(config.rules['weetion/comments']).toEqual(['error', 'changed']);
  });

  it('全量检查报告缺失职责说明的真实行号', /** 行号错位会让门禁指向无关代码，无法定位缺失的说明。 */ () => {
    const messages = lint(
      'export function run() {}\n',
      `${frontend}/probe-module.mjs`,
      { all: true },
    );

    expect(
      messages.some(
        /** 缺少函数职责说明必须产生阻断级诊断。 */ (message) =>
          message.ruleId === 'weetion/comments' &&
          message.severity === 2 &&
          message.message.includes('web-doc'),
      ),
    ).toBe(true);
  });

  it('全量检查接受带职责说明的声明', /** 合法写法不应被误报，否则门禁会逼出无意义注释。 */ () => {
    const messages = lint(
      '/** 执行任务。 */\nexport function run() {}\n',
      `${frontend}/probe-module.mjs`,
      { all: true },
    );

    expect(messages).toEqual([]);
  });

  it('声明文件与虚拟文件名不参与检查', /** 类型声明没有可执行体，虚拟文件名没有对应物理文件。 */ () => {
    const declarationMessages = lint(
      'export function run() {}\n',
      `${frontend}/probe-module.d.ts`,
      { all: true },
    );
    expect(
      declarationMessages.some(
        /** 本规则不得对声明文件产生任何诊断。 */ (message) =>
          message.ruleId === 'weetion/comments',
      ),
    ).toBe(false);
    // 形如 `<probe>.mjs` 的虚拟文件名缺少物理路径，规则必须直接跳过而不是抛错。
    expect(
      lint('export function run() {}\n', '<probe>.mjs', { all: true }),
    ).toEqual([]);
  });

  it('增量模式下未改动文件不产生诊断', /** 未改动文件被重复阻断会让增量检查失去意义。 */ () => {
    const current = readFileSync(TRACKED, 'utf8');
    expect(TRACKED_RELATIVE.endsWith('web-comments.mjs')).toBe(true);

    expect(lint(current, TRACKED)).toEqual([]);
  });

  it('增量模式只报告本次改动引入的说明缺失', /** 增量范围必须落到真实改动行上，否则新代码可以绕过门禁。 */ () => {
    const current = readFileSync(TRACKED, 'utf8');
    const messages = lint(`${current}${APPENDED_FUNCTION}`, TRACKED);
    const lines = current.split('\n').length;

    expect(
      messages.some(
        /** 追加的函数位于文件末尾之后，诊断行号必须指向它。 */ (message) =>
          message.message.includes('web-doc') && (message.line ?? 0) >= lines,
      ),
    ).toBe(true);
  });
});
