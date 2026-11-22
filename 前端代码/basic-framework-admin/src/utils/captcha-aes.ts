/**
 * Anji-Plus 滑块验证码 AES-128-ECB-PKCS7 轨迹加密工具。
 */
import CryptoJS from 'crypto-js';

export function encryptCaptchaAes(plainText: string, secretKey: string): string {
  const key = CryptoJS.enc.Utf8.parse(secretKey);
  const encrypted = CryptoJS.AES.encrypt(
    CryptoJS.enc.Utf8.parse(plainText),
    key,
    {
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.Pkcs7,
    },
  );
  return encrypted.toString();
}
