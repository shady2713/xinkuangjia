/**
 * 终端加载指示封装：用 ora 包裹一段异步任务，成功或失败时
 * 打印调用方给定的文案，并把原异常继续抛给调用方。
 *
 * 供构建脚本提示长耗时步骤；不重试、不吞异常，文案缺省时才用英文兜底。
 */
import type { Ora } from 'ora';

import ora from 'ora';

interface SpinnerOptions {
  failedText?: string;
  successText?: string;
  title: string;
}
export async function spinner<T>(
  { failedText, successText, title }: SpinnerOptions,
  callback: () => Promise<T>,
): Promise<T> {
  const loading: Ora = ora(title).start();

  try {
    const result = await callback();
    loading.succeed(successText || 'Success!');
    return result;
  } catch (error) {
    loading.fail(failedText || 'Failed!');
    throw error;
  } finally {
    loading.stop();
  }
}
