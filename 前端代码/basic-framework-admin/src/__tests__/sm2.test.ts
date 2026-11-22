import { sm2 } from 'sm-crypto';
import { describe, expect, it } from 'vitest';

import {
  buildPasswordPayload,
  encryptPasswordWithPublicKey,
  normalizePublicKey,
} from '@/utils/sm2';

describe('sm2 password transport encryption', () => {
  it('encrypts password payload with dynamic SM2 keypair in C1C3C2 mode', () => {
    const { publicKey, privateKey } = sm2.generateKeyPairHex();
    const cipher = encryptPasswordWithPublicKey('Admin@2026!', publicKey);

    expect(cipher.startsWith('04')).toBe(true);
    // sm-crypto 解密输入不带前导 04
    const decrypted = sm2.doDecrypt(cipher.slice(2), privateKey, 1);
    const parsed = JSON.parse(decrypted) as { n: string; p: string; t: number };
    expect(parsed.p).toBe('Admin@2026!');
    expect(parsed.n).toMatch(/^[0-9a-f]{32}$/);
    expect(typeof parsed.t).toBe('number');
  });

  it('normalizes 128-hex and 130-hex public keys and rejects invalid ones', () => {
    const { publicKey } = sm2.generateKeyPairHex();
    expect(normalizePublicKey(publicKey)).toBe(publicKey.toLowerCase());
    expect(normalizePublicKey(publicKey.slice(2))).toBe(publicKey.toLowerCase());
    expect(() => normalizePublicKey('not-hex')).toThrow('格式不正确');
    expect(() => normalizePublicKey('04abcd')).toThrow('长度不正确');
  });

  it('builds unique nonces across calls', () => {
    const first = JSON.parse(buildPasswordPayload('Secret#1')) as { n: string };
    const second = JSON.parse(buildPasswordPayload('Secret#1')) as { n: string };
    expect(first.n).not.toBe(second.n);
  });
});
