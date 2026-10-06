/**
 * Git 辅助工具：读取暂存区文件，并转发 @changesets/git 的能力。
 * getStagedFiles 只取新增、复制、修改、重命名四类路径，转绝对路径后去重；
 * 出错时打印日志并返回空数组。提交、推送等写操作不在本模块内。
 */
import path from 'node:path';

import { execa } from 'execa';

export * from '@changesets/git';

/**
 * 获取暂存区文件
 * @returns 暂存区中新增、复制、修改与重命名文件的绝对路径去重列表；git 执行失败时为空数组。
 */
async function getStagedFiles(): Promise<string[]> {
  try {
    const { stdout } = await execa('git', [
      '-c',
      'submodule.recurse=false',
      'diff',
      '--staged',
      '--diff-filter=ACMR',
      '--name-only',
      '--ignore-submodules',
      '-z',
    ]);

    let changedList = stdout ? stdout.replace(/\0$/, '').split('\0') : [];
    changedList = changedList.map((item) => path.resolve(process.cwd(), item));
    const changedSet = new Set(changedList);
    changedSet.delete('');
    return [...changedSet];
  } catch (error) {
    console.error('Failed to get staged files:', error);
    return [];
  }
}

export { getStagedFiles };
