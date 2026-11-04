import { afterEach, describe, expect, it, vi } from 'vitest';

import { AES } from '../encrypt';

const KEY = '1234567890abcdef';
const PLAIN_TEXT = JSON.stringify({ username: 'admin', password: 'CHANGE_ME' });
const KNOWN_AES_CBC_PAYLOAD =
  'AAAAAAAAAAAAAAAAAAAAAMndqyRAbvt2NUrQYOSZ2W7/0Fv1ZQF7tHxJ0wLA8RB8hW5YCMzncizTIoWlMgVogw==';

afterEach(() => {
  vi.restoreAllMocks();
});

/** 验证同一明文两次加密结果不同且可还原。 */
function encryptsAndDecrypts() {
  const encrypted = AES.encrypt(PLAIN_TEXT, KEY);
  const encryptedAgain = AES.encrypt(PLAIN_TEXT, KEY);

  expect(encrypted).not.toBe(PLAIN_TEXT);
  expect(encryptedAgain).not.toBe(encrypted);
  expect(AES.decrypt(encrypted, KEY)).toBe(PLAIN_TEXT);
}

/** 验证兼容共享的 AES-CBC 固定载荷。 */
function decryptsSharedPayload() {
  expect(AES.decrypt(KNOWN_AES_CBC_PAYLOAD, KEY)).toBe(PLAIN_TEXT);
}

/** 忽略预期的控制台错误输出。 */
function ignoreConsoleError() {
  // 被测代码在拒绝非法密钥时会记录错误，测试只验证异常本身。
}

/** 使用非法长度密钥调用 AES 加密。 */
function encryptWithShortKey() {
  AES.encrypt('data', 'short');
}

/** 验证非法 AES 密钥长度被拒绝。 */
function rejectsInvalidKey() {
  vi.spyOn(console, 'error').mockImplementation(ignoreConsoleError);

  expect(encryptWithShortKey).toThrow('AES 加密密钥长度必须为 16、24 或 32 位');
}

/** AES API 加密测试套件。 */
function aesApiEncryptionSuite() {
  it('encrypts and decrypts with AES-CBC payload format', encryptsAndDecrypts);
  it('decrypts the shared AES-CBC payload format', decryptsSharedPayload);
  it('rejects invalid AES key length', rejectsInvalidKey);
}

describe('aes API encryption', aesApiEncryptionSuite);
