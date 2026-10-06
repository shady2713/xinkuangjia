/**
 * 终端加载指示封装：用 ora 包裹一段异步任务，成功或失败时
 * 打印调用方给定的文案，并把原异常继续抛给调用方。
 *
 * 供构建脚本提示长耗时步骤；不重试、不吞异常，文案缺省时才用英文兜底。
 */
import type { Ora } from 'ora';

import ora from 'ora';

/** 终端加载指示的选项：title 必填，成功与失败文案缺省时用英文兜底。 */
interface SpinnerOptions {
  failedText?: string;
  successText?: string;
  title: string;
}
/**
 * 用 ora 包裹一段异步任务：开始时显示 title，结束或失败时打印对应文案。
 * 任务结果原样返回，异常在打印失败文案后继续抛出，不重试也不吞掉。
 * @param options - 终端提示文案；title 为进行中的标题，successText 与 failedText 为结束文案。
 * @param callback - 真正要执行并等待的异步任务，其解析结果会被原样透传。
 * @returns callback 的解析结果。
 * @throws callback 抛出的任何异常都会在打印失败文案后原样继续抛出。
 */
export async function spinner<T>(
  { failedText, successText, title }: SpinnerOptions,
  callback: /* 真正要执行并等待的异步任务，其解析结果会被原样透传。 */ () => Promise<T>,
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
