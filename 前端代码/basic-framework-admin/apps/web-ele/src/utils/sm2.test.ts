/** 验证前端 SM2 密码加密格式、公钥缓存和失败重试。 */
import { sm2 } from 'sm-crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSm2PublicKey } from '#/api/core/auth';

import {
  encryptPassword,
  encryptPasswordWithPublicKey,
  resetSm2PublicKeyCache,
} from './sm2';

/**
 * 模拟公钥接口模块。
 *
 * @returns 带 mock 函数的模块
 */
function mockAuthApi() {
  return { getSm2PublicKey: vi.fn() };
}

vi.mock('#/api/core/auth', mockAuthApi);

/** 仅用于单测的固定 SM2 密钥对，不得用于任何环境。 */
const TEST_PRIVATE_KEY =
  'fab85826985d339820dc4b9914487069e2b67ff67275b67ca00fc1d682d810f6';
/** 仅用于单测的固定 SM2 公钥。 */
const TEST_PUBLIC_KEY =
  '041a42fd4f982db82edeb82998d0580207d3e0b8d761c2870ddccc0f5244b02605533dcb1753c1a07c12eb088118d3ccf1bdf97f01543cfe6ae9f24b14f3cf9c2a';

/** 每个用例前清空公钥缓存和 mock 调用记录。 */
function resetMocks() {
  resetSm2PublicKeyCache();
  vi.clearAllMocks();
}

beforeEach(resetMocks);

/** 验证密文带 04 前缀且能还原 p/t/n 载荷。 */
function encryptsAndDecryptsPayload() {
  const ciphertext = encryptPasswordWithPublicKey(
    'Str0ng#Pass',
    TEST_PUBLIC_KEY,
  );

  expect(ciphertext.startsWith('04')).toBe(true);
  expect(ciphertext.length).toBeGreaterThan(194);

  const plaintext = sm2.doDecrypt(ciphertext.slice(2), TEST_PRIVATE_KEY, 1);
  const payload = JSON.parse(plaintext) as {
    n: string;
    p: string;
    t: number;
  };
  expect(payload.p).toBe('Str0ng#Pass');
  expect(payload.n).toMatch(/^[0-9a-f]{32}$/);
  expect(Math.abs(Date.now() - payload.t)).toBeLessThan(5000);
}

/** 验证连续加密只请求一次公钥。 */
async function cachesPublicKey() {
  vi.mocked(getSm2PublicKey).mockResolvedValue({
    cipherMode: 1,
    publicKey: TEST_PUBLIC_KEY,
  });

  const first = await encryptPassword('Another#1');
  const second = await encryptPassword('Another#1');

  expect(getSm2PublicKey).toHaveBeenCalledTimes(1);
  expect(first).not.toBe(second);
  expect(first.startsWith('04')).toBe(true);
  expect(second.startsWith('04')).toBe(true);
}

/** 验证公钥请求失败后不会被错误缓存。 */
async function retriesAfterPublicKeyFailure() {
  vi.mocked(getSm2PublicKey)
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce({ cipherMode: 1, publicKey: TEST_PUBLIC_KEY });

  await expect(encryptPassword('Another#1')).rejects.toThrow('network');
  await expect(encryptPassword('Another#1')).resolves.toMatch(/^04/);
  expect(getSm2PublicKey).toHaveBeenCalledTimes(2);
}

/** SM2 密码加密测试套件。 */
function sm2EncryptionSuite() {
  it('生成带 04 前缀的密文，并能还原 p/t/n 载荷', encryptsAndDecryptsPayload);
  it('缓存服务端公钥，连续提交只请求一次', cachesPublicKey);
  it(
    '拒绝格式非法的公钥，且失败后不缓存错误状态',
    retriesAfterPublicKeyFailure,
  );
}

describe('sM2 密码加密', sm2EncryptionSuite);
