/**
 * API 加解密 RSA 通道失败面（encrypt 的 RSA 与 ApiEncrypt）的真实行为回归。
 *
 * RSA 通道下请求加密与响应解密都依赖底层 RSA 包装器：密钥非法或数据不可解时包装器直接
 * 抛错，ApiEncrypt 只把同一个错误继续上抛，调用方据此中断请求，绝不会把明文发到服务端。
 * 用例用真实 JSEncrypt 生成的一次性密钥与真实错误对象固定这条失败面，并留下证据：包装器
 * 的签名虽声明 `false | string`，但失败时一律抛出、从不返回 false，因此 ApiEncrypt 内部
 * `result === false` / `decryptedData === false` 的兜底分支在真实链路上不可达
 * （对应未覆盖行 320-321、271-272，已如实上报，不改源码凑覆盖率）。
 */
import type { ApiEncryptConfig } from '../encrypt';

import { JSEncrypt } from 'jsencrypt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiEncrypt, RSA } from '../encrypt';

/** 被用例替换的失败日志出口，结束时恢复，避免影响其它测试文件。 */
let consoleError: ReturnType<typeof vi.spyOn>;

/** 非法密钥取值：jsencrypt 无法解析，用于触发真实失败面。 */
const INVALID_KEY = 'DUMMY-not-a-key';

/** 加密失败的判别串：只有底层包装器抛出时才带这段说明。 */
const WRAPPER_ENCRYPT_HINT = '可能是公钥格式错误或数据过长';

/** 解密失败的判别串：只有底层包装器抛出时才带这段说明。 */
const WRAPPER_DECRYPT_HINT = '可能是私钥错误或数据损坏';

/**
 * 用一次性密钥对生成真实 RSA 密钥材料，避免把密钥写进仓库。
 * @returns 公钥与私钥 PEM 文本。
 */
function generateRsaKeyPair(): { privateKey: string; publicKey: string } {
  const generator = new JSEncrypt();
  return {
    privateKey: generator.getPrivateKey(),
    publicKey: generator.getPublicKey(),
  };
}

/** 待真实执行的加解密调用，返回值不参与断言，失败通过抛错表达。 */
type EncryptCall = () => unknown;

/**
 * 真实执行一次加解密调用并取回抛出的错误。
 * @param run 待执行的加解密调用。
 * @returns 调用抛出的错误对象。
 * @throws 调用没有抛错、或抛出物不是 Error 时抛出，说明用例前提已失效。
 */
function captureError(run: EncryptCall): Error {
  try {
    run();
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
    throw new TypeError('加解密失败时的抛出物不是 Error');
  }
  throw new Error('用例前提失效：该调用本应抛出加解密错误');
}

/**
 * 构造 RSA 通道的加解密配置。
 * @param keys 本次用例使用的密钥材料，公钥用于请求加密，私钥用于响应解密。
 * @returns 传给 ApiEncrypt 的完整配置。
 */
function rsaConfig(keys: {
  privateKey: string;
  publicKey: string;
}): ApiEncryptConfig {
  return {
    algorithm: 'RSA',
    enable: true,
    header: 'X-Api-Encrypt',
    requestKey: keys.publicKey,
    responseKey: keys.privateKey,
  };
}

describe('rSA 通道的失败面', /** 加密失败必须中断请求，失败原因不能被兜底分支吞掉。 */ () => {
  beforeEach(
    /** 静默预期内的失败日志：本组用例真实触发了加解密失败分支。 */ () => {
      consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(
          /** 丢弃预期内的错误日志，避免污染测试输出。 */ () => {},
        );
    },
  );

  afterEach(
    /** 恢复被替换的 console.error，避免影响其它用例。 */ () => {
      consoleError.mockRestore();
    },
  );

  it('非法公钥时由底层包装器抛出加密失败', /** 抛错必须来自真实 RSA 实现，否则调用方无法区分密钥错误与数据过长。 */ () => {
    const error = captureError(
      /** 真实用非法公钥执行一次加密。 */ () =>
        RSA.encrypt('plain', INVALID_KEY),
    );

    expect(error.message).toContain(WRAPPER_ENCRYPT_HINT);
  });

  it('数据长度超过密钥上限时由包装器抛出而不是返回 false', /** jsencrypt 对过长数据返回 false，包装器必须把它转成调用方可见的抛错。 */ () => {
    const keyPair = generateRsaKeyPair();
    const tooLong = 'A'.repeat(1000);

    const error = captureError(
      /** 真实用合法公钥加密一段超长明文。 */ () =>
        RSA.encrypt(tooLong, keyPair.publicKey),
    );

    expect(error.message).toContain(WRAPPER_ENCRYPT_HINT);
  });

  it('apiEncrypt 请求加密原样上抛包装器的错误', /** ApiEncrypt 自身的兜底分支若被触发会丢掉失败原因，留下的只有笼统提示。 */ () => {
    const keyPair = generateRsaKeyPair();
    const api = new ApiEncrypt(
      rsaConfig({ privateKey: keyPair.privateKey, publicKey: INVALID_KEY }),
    );

    const error = captureError(
      /** 真实走一次 ApiEncrypt 的请求加密入口。 */ () =>
        api.encryptRequest({ account: 'DUMMY-账号' }),
    );

    expect(error.message).toContain(WRAPPER_ENCRYPT_HINT);
  });

  it('apiEncrypt 响应解密原样上抛包装器的错误', /** 私钥错误与数据损坏的差异必须保留，便于现场区分配置问题与报文问题。 */ () => {
    const api = new ApiEncrypt(
      rsaConfig({ privateKey: INVALID_KEY, publicKey: INVALID_KEY }),
    );

    const error = captureError(
      /** 真实走一次 ApiEncrypt 的响应解密入口。 */ () =>
        api.decryptResponse('QUJD'),
    );

    expect(error.message).toContain(WRAPPER_DECRYPT_HINT);
  });
});
