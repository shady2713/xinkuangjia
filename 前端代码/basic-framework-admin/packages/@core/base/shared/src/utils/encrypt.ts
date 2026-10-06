/**
 * 请求加解密工具：提供 AES-CBC、AES-ECB 验证码、MD5 与 RSA 实现。
 * 由 ApiEncrypt 按 ApiEncryptConfig 编排请求加密与响应解密；
 * 密钥、算法与开关由调用方注入，本模块不读取环境变量。
 */
import CryptoJS from 'crypto-js';
import { JSEncrypt } from 'jsencrypt';

import { logError } from './error';

const AES_IV_SIZE_BYTES = 16;
const AES_IV_SIZE_WORDS = AES_IV_SIZE_BYTES / 4;
const AES_KEY_LENGTHS = new Set([16, 24, 32]);

/**
 * 校验 AES 密钥非空且长度合法，让配置问题在首次加解密时就暴露出来。
 * @param key - 待校验的密钥字符串，长度必须是 16、24 或 32。
 * @param operation - 出错提示中使用的中文操作名，如「加密」「解密」，只影响文案。
 * @returns 无返回值；校验通过即正常返回，调用方随后可安全使用该密钥。
 * @throws {Error} - 密钥为空串、或长度不是 16/24/32 时抛出，抛错时不产生任何加密结果。
 */
function assertAesKey(key: string, operation: string) {
  if (!key) {
    throw new Error(`AES ${operation}密钥不能为空`);
  }
  if (!AES_KEY_LENGTHS.has(key.length)) {
    throw new Error(
      `AES ${operation}密钥长度必须为 16、24 或 32 位，当前长度: ${key.length}`,
    );
  }
}

/**
 * API 加解密工具类
 * 支持 AES-CBC 和 RSA 加密算法
 */

/**
 * AES-CBC 加密工具类
 *
 * 密文格式：Base64(16 字节随机 IV + AES-CBC 密文)
 */
export const AES = {
  /**
   * AES 加密：按 CBC 模式加密，IV 随机生成并拼在密文前面一起 Base64 输出。
   * @param data 要加密的明文，通常是 JSON 化的请求体。
   * @param key 加密密钥，长度必须是 16、24 或 32 位。
   * @returns Base64 编码后的密文串，前 16 字节是随机 IV。
   * @throws 密钥长度非法，或加密过程中出现底层异常时原样抛出，调用方必须处理。
   */
  encrypt(data: string, key: string): string {
    try {
      assertAesKey(key, '加密');

      const keyUtf8 = CryptoJS.enc.Utf8.parse(key);
      const iv = CryptoJS.lib.WordArray.random(AES_IV_SIZE_BYTES);
      const encrypted = CryptoJS.AES.encrypt(data, keyUtf8, {
        iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7,
      });
      // WordArray 本身不可迭代，只有 words 数组可展开；
      // 显式合并词数组并累加有效字节数，等价于 clone().concat() 的结果。
      const payload = CryptoJS.lib.WordArray.create(
        [...iv.words, ...encrypted.ciphertext.words],
        iv.sigBytes + encrypted.ciphertext.sigBytes,
      );
      return CryptoJS.enc.Base64.stringify(payload);
    } catch (error) {
      logError('AES encrypt failed', error);
      throw error;
    }
  },

  /**
   * AES 解密
   * @param encryptedData 加密的数据
   * @param key 解密密钥
   * @returns 解密后的字符串
   * @throws 密钥为空或长度非法、密文为空、密文长度不足一个 IV、
   *   以及解密结果为空（通常是密钥不匹配或数据损坏）时抛出 Error，调用方必须处理。
   */
  decrypt(encryptedData: string, key: string): string {
    try {
      assertAesKey(key, '解密');
      if (!encryptedData) {
        throw new Error('AES 解密数据不能为空');
      }

      const payload = CryptoJS.enc.Base64.parse(encryptedData);
      if (payload.sigBytes <= AES_IV_SIZE_BYTES) {
        throw new Error('AES 解密数据格式不正确');
      }

      const iv = CryptoJS.lib.WordArray.create(
        payload.words.slice(0, AES_IV_SIZE_WORDS),
        AES_IV_SIZE_BYTES,
      );
      const ciphertext = CryptoJS.lib.WordArray.create(
        payload.words.slice(AES_IV_SIZE_WORDS),
        payload.sigBytes - AES_IV_SIZE_BYTES,
      );
      const keyUtf8 = CryptoJS.enc.Utf8.parse(key);
      const decrypted = CryptoJS.AES.decrypt(
        CryptoJS.lib.CipherParams.create({ ciphertext }),
        keyUtf8,
        {
          iv,
          mode: CryptoJS.mode.CBC,
          padding: CryptoJS.pad.Pkcs7,
        },
      );
      const result = decrypted.toString(CryptoJS.enc.Utf8);
      if (!result) {
        throw new Error('AES 解密结果为空，可能是密钥错误或数据损坏');
      }
      return result;
    } catch (error) {
      logError('AES decrypt failed', error);
      throw error;
    }
  },
};

/**
 * aj-captcha 验证码专用 AES 工具。
 *
 * 后端 com.anji.captcha.util.AESUtil 使用的是 AES/ECB/PKCS5Padding，
 * 这里单独保留同款算法，避免复用上面的 API AES-CBC 格式导致滑块坐标解密失败。
 */
export const AjCaptchaAES = {
  /**
   * 按 aj-captcha 后端约定加密验证码坐标或二次校验串。
   * 该接口用 ECB 模式且不传 IV，因此同一明文每次密文相同，这是后端协议要求而非缺陷。
   * @param data 要加密的验证码数据
   * @param key 后端下发的 16 位 secretKey
   * @returns Base64 编码的密文串，即 AES-ECB-PKCS7 加密结果
   * @throws 密钥长度非法或底层加密异常时原样抛出，调用方必须处理
   */
  encrypt(data: string, key: string): string {
    try {
      assertAesKey(key, '验证码加密');

      const encrypted = CryptoJS.AES.encrypt(
        data,
        CryptoJS.enc.Utf8.parse(key),
        {
          mode: CryptoJS.mode.ECB,
          padding: CryptoJS.pad.Pkcs7,
        },
      );
      return CryptoJS.enc.Base64.stringify(encrypted.ciphertext);
    } catch (error) {
      logError('AJ captcha AES encrypt failed', error);
      throw error;
    }
  },
};

/**
 * MD5 加密
 * @param data 要加密的数据
 * @returns MD5 加密后的字符串
 */
export function md5(data: string): string {
  return CryptoJS.MD5(data).toString();
}

/**
 * RSA 加密工具类
 */
export const RSA = {
  /**
   * RSA 加密
   * @param data 要加密的数据
   * @param publicKey 公钥（必需）
   * @returns 加密后的字符串
   * @throws 公钥为空、公钥格式错误或数据过长导致底层加密失败时抛出 Error；
   * 失败一律走异常路径，不会以返回 false 表示失败。
   */
  encrypt(data: string, publicKey: string): false | string {
    try {
      if (!publicKey) {
        throw new Error('RSA 公钥不能为空');
      }

      const encryptor = new JSEncrypt();
      encryptor.setPublicKey(publicKey);
      const result = encryptor.encrypt(data);
      if (result === false) {
        throw new Error('RSA 加密失败，可能是公钥格式错误或数据过长');
      }
      return result;
    } catch (error) {
      logError('RSA encrypt failed', error);
      throw error;
    }
  },

  /**
   * RSA 解密
   * @param encryptedData 加密的数据
   * @param privateKey 私钥（必需）
   * @returns 解密后的字符串
   * @throws 私钥为空、待解密数据为空、私钥错误或数据损坏时抛出 Error；
   * 失败一律走异常路径，不会以返回 false 表示失败。
   */
  decrypt(encryptedData: string, privateKey: string): false | string {
    try {
      if (!privateKey) {
        throw new Error('RSA 私钥不能为空');
      }
      if (!encryptedData) {
        throw new Error('RSA 解密数据不能为空');
      }

      const encryptor = new JSEncrypt();
      encryptor.setPrivateKey(privateKey);
      const result = encryptor.decrypt(encryptedData);
      if (result === false) {
        throw new Error('RSA 解密失败，可能是私钥错误或数据损坏');
      }
      return result;
    } catch (error) {
      logError('RSA decrypt failed', error);
      throw error;
    }
  },
};

/**
 * API 加解密配置接口
 */
export interface ApiEncryptConfig {
  /**
   * 加密算法，取值来自环境变量，实际只支持 AES 与 RSA。
   * 类型保持 string 是因为取值在运行期来自环境变量，
   * 合法性由 encryptRequest/decryptResponse 中的运行时分支强制：
   * 非 AES/RSA 的取值会在真正加解密时抛出「不支持的加密算法」，
   * 而不是在这里静默改写成默认算法，避免配置错误被掩盖。
   */
  algorithm: string;
  /** 是否启用加解密 */
  enable: boolean;
  /** 加密头名称 */
  header: string;
  /** 请求加密密钥（AES密钥或RSA公钥） */
  requestKey: string;
  /** 响应解密密钥（AES密钥或RSA私钥） */
  responseKey: string;
}

/**
 * API 加解密主类
 */
export class ApiEncrypt {
  private config: ApiEncryptConfig;

  /**
   * 保存加解密配置，构造期间不做任何校验。
   * @param config - 加解密配置；algorithm、requestKey、responseKey 是否合法推迟到真正加解密时判断。
   */
  constructor(config: ApiEncryptConfig) {
    this.config = config;
  }

  /**
   * 解密响应数据
   * @param encryptedData 加密的响应数据
   * @returns 解密后的数据。优先按 JSON 解析，解析失败时返回解密出的原始字符串；
   * 未启用加密时原样返回入参。结果按 unknown 暴露，由调用方按业务响应结构收窄。
   * @throws 密钥未配置、解密算法不被支持、解密结果为空或解析失败时抛出原始异常；
   * 调用方据此中断本次响应处理，避免把密文当成业务数据继续解析。
   */
  decryptResponse(encryptedData: string): unknown {
    if (!this.config.enable) {
      return encryptedData;
    }

    try {
      let decryptedData: false | string = '';
      if (this.config.algorithm.toUpperCase() === 'AES') {
        if (!this.config.responseKey) {
          throw new Error('AES 响应解密密钥未配置');
        }
        decryptedData = AES.decrypt(encryptedData, this.config.responseKey);
      } else if (this.config.algorithm.toUpperCase() === 'RSA') {
        if (!this.config.responseKey) {
          throw new Error('RSA 私钥未配置');
        }
        decryptedData = RSA.decrypt(encryptedData, this.config.responseKey);
        if (decryptedData === false) {
          throw new Error('RSA 解密失败');
        }
      } else {
        throw new Error(`不支持的解密算法: ${this.config.algorithm}`);
      }

      if (!decryptedData) {
        throw new Error('解密结果为空');
      }

      // 尝试解析为 JSON，如果失败则返回原字符串
      try {
        return JSON.parse(decryptedData);
      } catch {
        return decryptedData;
      }
    } catch (error) {
      logError('API response decrypt failed', error);
      throw error;
    }
  }

  /**
   * 加密请求数据
   * @param data 要加密的数据，通常是 Axios 请求体对象或已序列化的字符串
   * @returns 启用加密时返回密文字符串；未启用加密时原样返回入参。
   * 因此返回类型为 unknown，调用方需自行按 Axios 请求体的赋值口径使用。
   * @throws 密钥未配置或加密算法不被支持时抛出 Error；调用方应中断本次请求，
   * 因为此时数据仍未加密，直接放行会把明文发到服务端。
   */
  encryptRequest(data: unknown): unknown {
    if (!this.config.enable) {
      return data;
    }

    try {
      const jsonData = typeof data === 'string' ? data : JSON.stringify(data);

      if (this.config.algorithm.toUpperCase() === 'AES') {
        if (!this.config.requestKey) {
          throw new Error('AES 请求加密密钥未配置');
        }
        return AES.encrypt(jsonData, this.config.requestKey);
      } else if (this.config.algorithm.toUpperCase() === 'RSA') {
        if (!this.config.requestKey) {
          throw new Error('RSA 公钥未配置');
        }
        const result = RSA.encrypt(jsonData, this.config.requestKey);
        if (result === false) {
          throw new Error('RSA 加密失败');
        }
        return result;
      } else {
        throw new Error(`不支持的加密算法: ${this.config.algorithm}`);
      }
    } catch (error) {
      logError('API request encrypt failed', error);
      throw error;
    }
  }

  /**
   * 获取加密头名称
   * @returns 配置里的加密头名；由 createApiEncrypt 构造且未配置环境变量时为 'X-Api-Encrypt'。
   */
  getEncryptHeader(): string {
    return this.config.header;
  }
}

/**
 * 创建基于环境变量的 API 加解密实例
 * @param env 环境变量对象，值均为字符串，未配置的键为 undefined
 * @returns ApiEncrypt 实例
 */
export function createApiEncrypt(
  env: Record<string, string | undefined>,
): ApiEncrypt {
  const config: ApiEncryptConfig = {
    enable: env.VITE_APP_API_ENCRYPT_ENABLE === 'true',
    header: env.VITE_APP_API_ENCRYPT_HEADER || 'X-Api-Encrypt',
    algorithm: env.VITE_APP_API_ENCRYPT_ALGORITHM || 'AES',
    requestKey: env.VITE_APP_API_ENCRYPT_REQUEST_KEY || '',
    responseKey: env.VITE_APP_API_ENCRYPT_RESPONSE_KEY || '',
  };

  return new ApiEncrypt(config);
}
