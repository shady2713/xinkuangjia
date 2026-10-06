/**
 * 单文件格式化入口：按目标文件就近的 Prettier 配置重排文本，
 * 内容没有变化时不回写磁盘，避免无谓的文件时间戳变动。
 *
 * 供 code-workspace 等生成类脚本整理产物；不遍历目录，也不负责提交。
 */
import fs from 'node:fs/promises';

import { format, getFileInfo, resolveConfig } from 'prettier';

/**
 * 按项目 Prettier 配置格式化单个文件，格式无变化时不回写磁盘。
 *
 * @param filepath 目标文件绝对路径
 * @returns 格式化后的文本内容
 * @throws 文件读取失败、Prettier 无法推断解析器或格式化出错时由底层实现抛出
 */
async function prettierFormat(filepath: string) {
  const prettierOptions = await resolveConfig(filepath, {});

  const fileInfo = await getFileInfo(filepath);

  const input = await fs.readFile(filepath, 'utf8');
  // getFileInfo 对无法识别扩展名的文件返回 null 解析器。显式传 null 与不传 parser
  // 在 Prettier 内部走同一条"缺少解析器"分支，因此这里直接省略该键，行为与原来一致。
  const output = await format(input, {
    ...prettierOptions,
    ...(fileInfo.inferredParser ? { parser: fileInfo.inferredParser } : {}),
  });
  if (output !== input) {
    await fs.writeFile(filepath, output, 'utf8');
  }
  return output;
}

export { prettierFormat };
