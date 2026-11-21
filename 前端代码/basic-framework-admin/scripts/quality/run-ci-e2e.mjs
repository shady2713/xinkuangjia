/**
 * 在可重复的 CI 环境中执行 web-ele 关键业务浏览器路径 Playwright 校验并记录结果。
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const workspaceRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const appRoot = join(workspaceRoot, 'apps', 'web-ele');
const reportFile = join(appRoot, 'test-results', 'ci-e2e-results.json');

/** 在无外部中间件依赖的 CI 环境中可稳定重复执行的浏览器关键路径规格清单。 */
const CI_PLAYWRIGHT_SPECS = [
  'e2e/production-security.spec.ts',
  'e2e/ci-critical-login.spec.ts',
];

/**
 * 递归统计 Playwright JSON 报告中的实际用例结果与明细。
 *
 * @param suites Playwright JSON 报告的 suites 列表
 * @returns 汇总统计及每条用例的状态明细
 */
function summarizePlaywrightSuites(suites) {
  const details = [];
  const counts = { failed: 0, passed: 0, skipped: 0 };

  /**
   * 遍历单层 suite 并收集规格执行结果。
   *
   * @param suiteList 当前层级 suite 列表
   * @param fallbackFile 上层默认规格文件名
   */
  function visit(suiteList, fallbackFile) {
    for (const suite of suiteList ?? []) {
      const currentFile = suite.title || fallbackFile;
      for (const spec of suite.specs ?? []) {
        const tests = spec.tests?.length ? spec.tests : [null];
        for (const testEntry of tests) {
          const latest = testEntry?.results?.at(-1);
          const status = latest?.status ?? (spec.ok ? 'passed' : 'failed');
          counts[
            status === 'passed' || status === 'skipped' ? status : 'failed'
          ] += 1;
          details.push({
            durationMs: latest?.duration ?? 0,
            file: spec.file ?? currentFile,
            status,
            title: spec.title ?? '',
          });
        }
      }
      visit(suite.suites, currentFile);
    }
  }

  visit(suites, '');
  return { details, ...counts };
}

/**
 * 将浏览器关键路径实际执行结果输出到控制台并按需追加至 GitHub Step Summary。
 *
 * @param summary 统计汇总对象
 * @param exitCode Playwright 实际退出码
 */
function recordExecutionSummary(summary, exitCode) {
  const sha = process.env.GITHUB_SHA || 'local-worktree';
  const rows = summary.details.map(
    (item) =>
      `| \`${item.file}\` | ${item.title} | ${item.status} | ${item.durationMs} |`,
  );
  const markdown = [
    '### CI 关键业务浏览器路径执行记录（Playwright）',
    '',
    `- 受验版本：\`${sha}\``,
    `- 执行规格：${CI_PLAYWRIGHT_SPECS.map((item) => `\`${item}\``).join('、')}`,
    `- 统计结果：通过 ${summary.passed} / 失败 ${summary.failed} / 跳过 ${summary.skipped}（退出码 ${exitCode}）`,
    '',
    '| 规格文件 | 用例名称 | 结果 | 耗时 (ms) |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
  console.log(`\n${markdown}`);
  const summaryPath = process.env.GITHUB_STEP_SUMMARY?.trim();
  if (summaryPath) appendFileSync(summaryPath, `${markdown}\n`, 'utf8');
}

/**
 * 执行 CI 关键路径 Playwright 用例并保留真实失败退出码。
 *
 * @returns Playwright 真实退出码
 */
function runCiE2e() {
  mkdirSync(join(appRoot, 'test-results'), { recursive: true });
  const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const result = spawnSync(
    pnpmCommand,
    [
      'exec',
      'playwright',
      'test',
      ...CI_PLAYWRIGHT_SPECS,
      '--reporter=list,json',
    ],
    {
      cwd: appRoot,
      env: {
        ...process.env,
        NO_PROXY: '127.0.0.1,localhost',
        PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile,
      },
      shell: process.platform === 'win32',
      stdio: 'inherit',
    },
  );
  const exitCode = result.error ? 2 : (result.status ?? 1);
  if (existsSync(reportFile)) {
    const raw = JSON.parse(readFileSync(reportFile, 'utf8'));
    recordExecutionSummary(summarizePlaywrightSuites(raw.suites), exitCode);
  } else {
    console.error(`未生成 Playwright JSON 报告：${reportFile}`);
  }
  return exitCode;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exit(runCiE2e());
}

export { CI_PLAYWRIGHT_SPECS, runCiE2e, summarizePlaywrightSuites };
