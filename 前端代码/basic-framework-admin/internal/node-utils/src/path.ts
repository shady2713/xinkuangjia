/**
 * 路径工具：把 Windows 风格的反斜杠统一换为 POSIX 分隔符。
 * 供跨平台拼接导入路径与构建产物路径时复用；
 * 不做解析、规范化与存在性校验。
 */
import { posix } from 'node:path';

/**
 * 将给定的文件路径转换为 POSIX 风格。
 * @param {string} pathname - 原始文件路径。
 */
function toPosixPath(pathname: string) {
  return pathname.split(`\\`).join(posix.sep);
}

export { toPosixPath };
