/**
 * 内容哈希工具：对字符串取 MD5 摘要，可按需截断长度。
 * 供构建缓存键与静态资源指纹复用；不读取文件，
 * 也不具备密码学安全性，勿用于口令或签名。
 */
import { createHash } from 'node:crypto';

/**
 * 生产基于内容的 hash，可自定义长度
 * @param content
 * @param hashLSize
 */
function generatorContentHash(content: string, hashLSize?: number) {
  const hash = createHash('md5').update(content, 'utf8').digest('hex');

  if (hashLSize) {
    return hash.slice(0, hashLSize);
  }

  return hash;
}

export { generatorContentHash };
