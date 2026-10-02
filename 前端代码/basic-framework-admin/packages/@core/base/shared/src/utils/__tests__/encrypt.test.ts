import { afterEach, describe, expect, it, vi } from 'vitest';

import { AES } from '../encrypt';

const KEY = '1234567890abcdef';
const PLAIN_TEXT = JSON.stringify({ username: 'admin', password: 'Abcd12' });
const KNOWN_AES_CBC_PAYLOAD =
  'AAAAAAAAAAAAAAAAAAAAAMndqyRAbvt2NUrQYOSZ2W7/0Fv1ZQF7tHxJ0wLA8RB8I4QcL7tokfrda9W3GEaxjA==';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AES API encryption', () => {
  it('encrypts and decrypts with AES-CBC payload format', () => {
    const encrypted = AES.encrypt(PLAIN_TEXT, KEY);
    const encryptedAgain = AES.encrypt(PLAIN_TEXT, KEY);

    expect(encrypted).not.toBe(PLAIN_TEXT);
    expect(encryptedAgain).not.toBe(encrypted);
    expect(AES.decrypt(encrypted, KEY)).toBe(PLAIN_TEXT);
  });

  it('decrypts the shared AES-CBC payload format', () => {
    expect(AES.decrypt(KNOWN_AES_CBC_PAYLOAD, KEY)).toBe(PLAIN_TEXT);
  });

  it('rejects invalid AES key length', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => AES.encrypt('data', 'short')).toThrow('AES 加密密钥长度必须为 16、24 或 32 位');
  });
});