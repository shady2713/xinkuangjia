// @vitest-environment node
/**
 * 暂存区文件查询（node-utils 的 git）的真实行为回归。
 *
 * 该函数是提交前检查的输入来源：git 参数写错会把未暂存改动、未跟踪文件或子模块变更
 * 混进检查范围，过滤条件写错会把删除文件也当成待检查对象；不在 Git 仓库中执行时必须
 * 收敛为空列表而不是让提交钩子崩溃。用例在独立临时目录里建立真实 Git 仓库并调用真实
 * git 子进程，不替换 execa 或文件系统。
 *
 * 本文件是构建工具链代码，必须用 Node 环境：DOM 环境会替换全局 AbortController，
 * 而 execa 的 setMaxListeners 只接受 Node 的 EventTarget，替换后会直接抛类型错误，
 * 无法触达真实成功路径。环境按仓库既有做法用文件级 docblock 声明，不改动覆盖率配置。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getStagedFiles } from '../git';

/**
 * 在指定目录执行 git 子命令并等待完成。
 * @param cwd 临时仓库目录。
 * @param args git 子命令及其参数。
 */
function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

describe('getStagedFiles', /** 真实 git 仓库中的暂存范围与失败兜底。 */ () => {
  let originalCwd: string;
  let workspace: string;

  beforeEach(
    /** 每例建立独立临时目录，并把工作目录切到该目录。 */ () => {
      originalCwd = process.cwd();
      workspace = mkdtempSync(path.join(tmpdir(), 'bf-staged-'));
      process.chdir(workspace);
    },
  );

  afterEach(
    /** 恢复工作目录并删除临时目录，避免留下仓库残留。 */ () => {
      process.chdir(originalCwd);
      rmSync(workspace, { force: true, recursive: true });
    },
  );

  it('只返回已暂存的变更文件绝对路径', /** 未暂存与未跟踪文件混入会让提交前检查覆盖到本次不提交的内容。 */ async () => {
    git(workspace, 'init', '-q', '.');
    writeFileSync(path.join(workspace, 'kept.ts'), 'export const kept = 1;\n');
    writeFileSync(
      path.join(workspace, 'deleted.ts'),
      'export const deleted = 1;\n',
    );
    git(workspace, 'add', 'kept.ts', 'deleted.ts');
    git(
      workspace,
      '-c',
      'user.email=test@example.test',
      '-c',
      'user.name=测试',
      'commit',
      '-qm',
      '基准提交',
    );
    // 暂存的删除不属于 ACMR，不能进入检查范围。
    git(workspace, 'rm', '-q', 'deleted.ts');
    writeFileSync(path.join(workspace, 'staged.ts'), 'export const a = 1;\n');
    writeFileSync(
      path.join(workspace, 'untracked.ts'),
      'export const b = 1;\n',
    );
    git(workspace, 'add', 'staged.ts');

    await expect(getStagedFiles()).resolves.toEqual([
      path.resolve(workspace, 'staged.ts'),
    ]);
  });

  it('暂存区为空时返回空列表', /** 空仓库或没有暂存内容时必须如实返回空，不能凭猜测扩大范围。 */ async () => {
    git(workspace, 'init', '-q', '.');

    await expect(getStagedFiles()).resolves.toEqual([]);
  });

  it('不在 Git 仓库中时告警并返回空列表', /** 命令失败时提交钩子不能因此崩溃，也不能把失败当成没有变更。 */ async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(
        /** 静默预期内的失败日志，避免污染测试输出。 */ () => {},
      );

    await expect(getStagedFiles()).resolves.toEqual([]);
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to get staged files:',
      expect.any(Error),
    );

    consoleError.mockRestore();
  });
});
