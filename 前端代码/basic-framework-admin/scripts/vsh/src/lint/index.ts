/**
 * vsh lint 子命令：默认并行执行 eslint、prettier --check 和 stylelint 检查；
 * 加 --format 时改为依次运行对应工具的 --fix 自动修复。
 *
 * 只转发命令并继承各工具的退出码，规则配置由 internal/lint-configs 下的包维护。
 */
import type { CAC } from 'cac';

import { execaCommand } from '@vben/node-utils';

/** 子命令选项：format 为真时改为自动修复，而不是只做检查。 */
interface LintCommandOptions {
  /**
   * Format lint problem.
   */
  format?: boolean;
}

/**
 * 执行代码检查：默认并行跑 eslint、prettier --check 与 stylelint，加 --format 时改为依次修复。
 * 命令的退出码由各工具直接继承，本函数不做二次包装。
 * @param options - 子命令选项；解构出的 format 决定走修复还是检查分支。
 */
async function runLint({ format }: LintCommandOptions) {
  // process.env.FORCE_COLOR = '3';

  if (format) {
    await execaCommand(`stylelint "**/*.{vue,css,less,scss}" --cache --fix`, {
      stdio: 'inherit',
    });
    await execaCommand(`eslint . --cache --fix`, {
      stdio: 'inherit',
    });
    await execaCommand(`prettier . --write --cache --log-level warn`, {
      stdio: 'inherit',
    });
    return;
  }
  await Promise.all([
    execaCommand(`eslint . --cache`, {
      stdio: 'inherit',
    }),
    execaCommand(`prettier . --ignore-unknown --check --cache`, {
      stdio: 'inherit',
    }),
    execaCommand(`stylelint "**/*.{vue,css,less,scss}" --cache`, {
      stdio: 'inherit',
    }),
  ]);
}

/** 把 lint 子命令注册到 cac 实例上，命令名与选项在这里固定。 */
function defineLintCommand(cac: CAC) {
  cac
    .command('lint')
    .usage('Batch execute project lint check.')
    .option('--format', 'Format lint problem.')
    .action(runLint);
}

export { defineLintCommand };
