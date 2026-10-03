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

export async function ensureFile(filePath: string) {
  try {
    const dir = dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
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
