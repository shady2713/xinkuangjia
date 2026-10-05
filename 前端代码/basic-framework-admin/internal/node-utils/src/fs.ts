import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

/**
 * 将数据序列化为 JSON 并写入文件，父目录不存在时先创建。
 *
 * @param filePath 目标文件路径，父目录会按需递归创建
 * @param data 任意可被 JSON.stringify 序列化的数据；无法序列化时由 JSON.stringify 抛错
 * @param spaces 缩进空格数，默认 2
 * @throws 目录创建或文件写入失败时由底层 fs 抛出，调用方需自行捕获
 */
export async function outputJSON(
  filePath: string,
  data: unknown,
  spaces: number = 2,
) {
  try {
    const dir = dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    const jsonData = JSON.stringify(data, null, spaces);
    await fs.writeFile(filePath, jsonData, 'utf8');
  } catch (error) {
    console.error('Error writing JSON file:', error);
    throw error;
  }
}

/**
 * 构造目标不是普通文件的占位文件错误，使该契约在全部平台返回同一错误码。
 *
 * 目录目标在 POSIX 上由内核以 EISDIR 拒绝，但 Windows 允许以
 * FILE_FLAG_BACKUP_SEMANTICS 打开目录句柄，错误码随系统调用变化；调用方
 * （例如 publint 缓存先 ensureFile 再 readJSON）需要稳定的 EISDIR 才能把
 * "目标的类型不对"与不可恢复的写入失败区分开，因此这里统一在写入前拒绝。
 *
 * @param filePath 被拒绝的占位文件路径。
 * @returns 带 EISDIR 错误码、写入调用名与目标路径的错误对象。
 */
function notAFileError(filePath: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(
    `EISDIR: illegal operation on a directory, write '${filePath}'`,
  );
  error.code = 'EISDIR';
  error.syscall = 'write';
  error.path = filePath;
  return error;
}

/**
 * 建立占位文件；父目录不存在时先创建，目标已存在时保留原有内容。
 *
 * 占位文件用于把构建输出路径提前登记到版本库，调用方随后按普通文件读取，
 * 因此目标已存在但不是普通文件（目录、FIFO 或设备节点）时必须失败：写入目录
 * 在不同平台会得到不同结果，管道还会让写入阻塞。其余失败保持原样抛出底层
 * fs 错误，调用方据此区分目标类型错误与权限、磁盘等系统错误。
 *
 * @param filePath 目标占位文件路径，父目录会按需递归创建。
 * @throws {NodeJS.ErrnoException} 目标已存在且不是普通文件时抛出 code 为 EISDIR 的错误。
 * @throws 目录创建、目标探测或写入失败时由底层 fs 抛出原错误。
 */
export async function ensureFile(filePath: string) {
  try {
    const dir = dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    // 目标不存在（ENOENT）时按新建处理；探测失败的其他原因交给写入阶段抛出，
    // 保证调用方看到的仍是底层 fs 错误而不是被吞掉。
    const existing = await fs
      .stat(filePath)
      .catch(
        /** 探测不到目标时返回 null，由写入阶段给出真实失败原因。 */ () => null,
      );
    if (existing && !existing.isFile()) {
      throw notAFileError(filePath);
    }
    await fs.writeFile(filePath, '', { flag: 'a' });
  } catch (error) {
    console.error('Error ensuring file:', error);
    throw error;
  }
}

export async function readJSON(filePath: string) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading JSON file:', error);
    throw error;
  }
}
