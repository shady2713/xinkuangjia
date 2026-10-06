/**
 * vsh code-workspace 子命令：收集 monorepo 内各包目录，写入仓库根的
 * vben-admin.code-workspace，并用 prettier 统一该文件格式。
 *
 * --spaces 控制缩进宽度，--auto-commit 额外把生成结果加入 git 暂存；
 * 不生成 settings、extensions 等其它工作区字段。
 */
import type { CAC } from 'cac';

import { join, relative } from 'node:path';

import {
  colors,
  consola,
  findMonorepoRoot,
  getPackages,
  gitAdd,
  outputJSON,
  prettierFormat,
  toPosixPath,
} from '@vben/node-utils';

const CODE_WORKSPACE_FILE = join('vben-admin.code-workspace');

/** 子命令选项：spaces 为工作区文件的缩进宽度，autoCommit 决定生成后是否加入 git 暂存。 */
interface CodeWorkspaceCommandOptions {
  autoCommit?: boolean;
  spaces?: number;
}

/**
 * 生成工作区文件：把各包目录写成 folders 条目，输出到 monorepo 根并统一格式。
 * @param options - 子命令选项；解构出的 spaces 为缩进宽度，autoCommit 为真时把结果加入 git 暂存。
 * @returns 写入与格式化完成后的 Promise，没有业务返回值。
 */
async function createCodeWorkspace({
  autoCommit = false,
  spaces = 2,
}: CodeWorkspaceCommandOptions) {
  const { packages, rootDir } = await getPackages();

  // 只保留包名与相对 monorepo 根的 POSIX 路径，VS Code 不认反斜杠。
  let folders = packages.map((pkg) => {
    const { dir, packageJson } = pkg;
    return {
      name: packageJson.name,
      path: toPosixPath(relative(rootDir, dir)),
    };
  });

  folders = folders.filter(Boolean);

  const monorepoRoot = findMonorepoRoot();
  const outputPath = join(monorepoRoot, CODE_WORKSPACE_FILE);
  await outputJSON(outputPath, { folders }, spaces);

  await prettierFormat(outputPath);
  if (autoCommit) {
    await gitAdd(CODE_WORKSPACE_FILE, monorepoRoot);
  }
}

/**
 * 子命令入口：生成工作区文件，未开启 autoCommit 时额外打印一条成功提示。
 * @param options - 子命令选项，原样透传给 createCodeWorkspace。
 * @returns 流程结束后的 Promise；autoCommit 为真时提前返回，不打印提示。
 */
async function runCodeWorkspace({
  autoCommit,
  spaces,
}: CodeWorkspaceCommandOptions) {
  await createCodeWorkspace({
    autoCommit,
    spaces,
  });
  if (autoCommit) {
    return;
  }
  consola.log('');
  consola.success(colors.green(`${CODE_WORKSPACE_FILE} is updated!`));
  consola.log('');
}

/** 把 code-workspace 子命令注册到 cac 实例上，命令名与选项在这里固定。 */
function defineCodeWorkspaceCommand(cac: CAC) {
  cac
    .command('code-workspace')
    .usage('Update the `.code-workspace` file')
    .option('--spaces [number]', '.code-workspace JSON file spaces.', {
      default: 2,
    })
    .option('--auto-commit', 'auto commit .code-workspace JSON file.', {
      default: false,
    })
    .action(runCodeWorkspace);
}

export { defineCodeWorkspaceCommand };
