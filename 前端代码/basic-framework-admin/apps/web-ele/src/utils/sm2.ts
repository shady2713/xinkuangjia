/**
 * 密码传输 SM2 加密工具，负责公钥获取、缓存和 p/t/n 载荷加密。
 *
 * @author shady2713
 */
import { sm2 } from 'sm-crypto';

import { getSm2PublicKey } from '#/api/core/auth';

/** SM2 密文模式：1 表示 C1C3C2，与后端 BouncyCastle 保持一致。 */
const SM2_CIPHER_MODE_C1C3C2 = 1 as const;

/** 公钥缓存；同一次页面会话内复用，避免每次提交密码都请求公钥。 */
let publicKeyPromise: Promise<string> | undefined;

/**
 * 把服务端返回的公钥规范化为 sm-crypto 可用的未压缩十六进制公钥。
 *
 * @param publicKey 服务端下发的 SM2 公钥
 * @returns 带 04 前缀的 130 位十六进制公钥
 * @throws 公钥为空、非十六进制或长度不正确时抛出
 */
function normalizePublicKey(publicKey: string): string {
  const normalized = publicKey.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(normalized)) {
    throw new Error('SM2 公钥格式不正确');
  }
  if (normalized.length === 128) {
    return `04${normalized}`;
  }
  if (normalized.length === 130 && normalized.startsWith('04')) {
    return normalized;
  }
  throw new Error('SM2 公钥长度不正确');
}

/**
 * 生成 16 字节随机 nonce，使用浏览器安全加密随机源。
 *
 * @returns 32 位十六进制随机串
 * @throws 运行环境缺少 `crypto.getRandomValues` 时抛出异常
 */
function createNonce(): string {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('当前运行环境缺少安全随机数生成器 crypto.getRandomValues');
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  const parts: string[] = [];
  for (const value of bytes) {
    parts.push(value.toString(16).padStart(2, '0'));
  }
  return parts.join('');
}

/**
 * 构造密码传输明文载荷，字段与后端约定为 p=密码、t=毫秒时间戳、n=nonce。
 *
 * @param plain 明文密码
 * @returns 紧凑 JSON 字符串
 */
export function buildPasswordPayload(plain: string): string {
  return JSON.stringify({
    n: createNonce(),
    p: plain,
    t: Date.now(),
  });
}

/**
 * 使用指定公钥加密密码，返回带 04 前缀的 C1C3C2 密文。
 *
 * @param plain 明文密码
 * @param publicKey 服务端 SM2 公钥
 * @returns 带 04 前缀的十六进制密文
 * @throws 密码为空或公钥格式非法时抛出
 */
export function encryptPasswordWithPublicKey(
  plain: string,
  publicKey: string,
): string {
  if (!plain) {
    throw new Error('密码不能为空');
  }
  const payload = buildPasswordPayload(plain);
  const encrypted = sm2.doEncrypt(
    payload,
    normalizePublicKey(publicKey),
    SM2_CIPHER_MODE_C1C3C2,
  );
  if (!encrypted) {
    throw new Error('SM2 加密结果为空');
  }
  // sm-crypto 输出省略 C1 的 04 前缀，后端按未压缩点解析，这里统一补齐。
  return `04${encrypted}`;
}

/**
 * 获取公钥并加密密码；公钥请求失败或加密失败时向上抛出，由调用方统一提示。
 *
 * @param plain 明文密码
 * @returns 带 04 前缀的 SM2 密文
 * @throws 公钥请求失败、密文模式不支持或加密失败时抛出
 */
export async function encryptPassword(plain: string): Promise<string> {
  publicKeyPromise ??= resolvePublicKey();
  let publicKey: string;
  try {
    publicKey = await publicKeyPromise;
  } catch (error) {
    // 仅在公钥拉取失败时清空缓存以便重试，不因调用方空密码等入参错误反复请求公钥。
    publicKeyPromise = undefined;
    throw error;
  }
  return encryptPasswordWithPublicKey(plain, publicKey);
}

/**
 * 获取并校验服务端公钥，供加密入口缓存复用。
 *
 * @returns 带 04 前缀的未压缩公钥
 * @throws 服务端密文模式不是 C1C3C2 或公钥格式非法时抛出
 */
async function resolvePublicKey(): Promise<string> {
  const result = await getSm2PublicKey();
  if (result.cipherMode !== SM2_CIPHER_MODE_C1C3C2) {
    throw new Error('服务端 SM2 密文模式不受支持');
  }
  return normalizePublicKey(result.publicKey);
}

/**
 * 清空公钥缓存，供测试和密钥轮换后的页面刷新使用。
 */
export function resetSm2PublicKeyCache(): void {
  publicKeyPromise = undefined;
}
