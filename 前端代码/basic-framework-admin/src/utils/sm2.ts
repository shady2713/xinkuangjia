/**
 * 密码传输 SM2 加密工具：负责公钥获取、会话级缓存与 p/t/n 载荷 C1C3C2 加密。
 */
import { sm2 } from 'sm-crypto';

import { getSm2PublicKey } from '@/api/auth';

const SM2_CIPHER_MODE_C1C3C2 = 1 as const;

let publicKeyPromise: Promise<string> | undefined;

/**
 * 规范化服务端返回的未压缩十六进制 SM2 公钥。
 */
export function normalizePublicKey(publicKey: string): string {
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

function createNonce(): string {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('当前运行环境缺少安全随机数生成器 crypto.getRandomValues');
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 构造与后端约定一致的密码传输明文载荷（p=密码, t=毫秒时间戳, n=随机串）。
 */
export function buildPasswordPayload(plain: string): string {
  return JSON.stringify({
    n: createNonce(),
    p: plain,
    t: Date.now(),
  });
}

/**
 * 使用指定 SM2 公钥加密明文密码，返回带 04 前缀的 C1C3C2 十六进制密文。
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
  return `04${encrypted}`;
}

async function resolvePublicKey(): Promise<string> {
  const result = await getSm2PublicKey();
  if (result.cipherMode !== SM2_CIPHER_MODE_C1C3C2) {
    throw new Error('服务端 SM2 密文模式不受支持');
  }
  return normalizePublicKey(result.publicKey);
}

/**
 * 拉取（或复用缓存）公钥并加密密码。
 */
export async function encryptPassword(plain: string): Promise<string> {
  publicKeyPromise ??= resolvePublicKey();
  let publicKey: string;
  try {
    publicKey = await publicKeyPromise;
  } catch (error) {
    publicKeyPromise = undefined;
    throw error;
  }
  return encryptPasswordWithPublicKey(plain, publicKey);
}

/**
 * 清空公钥缓存，用于密钥轮换或单元测试隔离。
 */
export function resetSm2PublicKeyCache(): void {
  publicKeyPromise = undefined;
}
