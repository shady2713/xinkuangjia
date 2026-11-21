/**
 * 前端本地验收与 GitHub Actions 共用的检查、测试、构建与产物安全扫描入口。
 *
 * 将共用步骤集中维护在单一清单中，避免 `package.json` 的 `quality:verify` 与
 * `.github/workflows/ci.yml` 的 `frontend` 作业各自维护造成顺序或遗漏漂移。
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const workspaceRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));

/**
 * 本地验收与 CI 共用的前端门禁顺序清单。
 */
const SHARED_FRONTEND_GATE_STEPS = [
  ['api:check', 'OpenAPI 契约校验'],
  ['quality:workspace', '工作区约束审计'],
  ['quality:development', '源码与分层审计'],
  ['graph:modules:check', '模块依赖图对齐校验'],
  ['check:circular', '循环依赖检查'],
  ['check:dep', '幽灵/未声明依赖检查'],
  ['quality:source-scan', '源码安全扫描'],
  ['quality:test', 'ESLint/注释/生产扫描工具测试'],
  ['quality:analysis:test', '构建分析插件测试'],
  ['quality:workspace:test', '工作区约束工具测试'],
  ['quality:development:test', '开发审计工具测试'],
  ['quality:delivery:test', '交付工具测试'],
  ['check:type', '类型检查'],
  ['lint', '代码与样式检查'],
  ['test:unit', '前端单元测试'],
  ['build:ele', '生产构建 web-ele'],
  ['quality:prod-scan', '生产配置与产物安全扫描'],
].map(
  /** 将步骤二元组映射为标准步骤对象。 */
  ([script, label]) => ({ label, script }),
);

/**
 * 解析当前平台可执行的 pnpm 命令名称。
 *
 * @returns Windows 下返回 `pnpm.cmd`，其余平台返回 `pnpm`
 */
function resolvePnpmCommand() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

/**
 * 按顺序执行共用前端门禁步骤，遇首个失败立即以真实退出码终止。
 *
 * @param argv 命令行参数，支持 `--list` 与 `--json`
 * @returns 退出码（0 表示全部通过，非 0 表示首个失败步骤的真实退出码）
 */
function runSharedGates(argv = process.argv.slice(2)) {
  if (argv.includes('--list')) {
    if (argv.includes('--json')) {
      console.log(JSON.stringify(SHARED_FRONTEND_GATE_STEPS, null, 2));
    } else {
      for (const step of SHARED_FRONTEND_GATE_STEPS) {
        console.log(`- pnpm ${step.script} (${step.label})`);
      }
    }
    return 0;
  }

  const pnpmCommand = resolvePnpmCommand();
  for (const step of SHARED_FRONTEND_GATE_STEPS) {
    const startedAt = Date.now();
    console.log(
      `\n==> [frontend-gate] pnpm run ${step.script} (${step.label})`,
    );
    const result = spawnSync(pnpmCommand, ['run', step.script], {
      cwd: workspaceRoot,
      env: { ...process.env, CI: process.env.CI || 'true' },
      shell: process.platform === 'win32',
      stdio: 'inherit',
    });
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    if (result.error) {
      console.error(
        `步骤 pnpm run ${step.script} 启动失败：${result.error.message}`,
      );
      return 2;
    }
    if (result.status !== 0) {
      console.error(
        `步骤 pnpm run ${step.script} 失败（退出码 ${result.status ?? 1}，耗时 ${seconds}s）`,
      );
      return result.status ?? 1;
    }
    console.log(
      `<== [frontend-gate] pnpm run ${step.script} 通过（${seconds}s）`,
    );
  }
  console.log(
    `\n前端共用门禁全部通过（共 ${SHARED_FRONTEND_GATE_STEPS.length} 项）。`,
  );
  return 0;
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  process.exit(runSharedGates());
}

export { runSharedGates, SHARED_FRONTEND_GATE_STEPS };
