/** API 加解密工具的测试：覆盖 AES-CBC 载荷、aj 验证码 ECB 密文、RSA 往返与请求响应对称处理。 */
import type { ApiEncryptConfig } from '../encrypt';

import { JSEncrypt } from 'jsencrypt';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AES,
  AjCaptchaAES,
  ApiEncrypt,
  createApiEncrypt,
  md5,
  RSA,
} from '../encrypt';

const KEY = '1234567890abcdef';
const PLAIN_TEXT = JSON.stringify({ username: 'admin', password: 'Abcd12' });
const KNOWN_AES_CBC_PAYLOAD =
  'AAAAAAAAAAAAAAAAAAAAAMndqyRAbvt2NUrQYOSZ2W7/0Fv1ZQF7tHxJ0wLA8RB8I4QcL7tokfrda9W3GEaxjA==';

/** aj-captcha 后端约定 AES/ECB/PKCS5 的已知密文，用于锚定跨端互操作。 */
const CAPTCHA_PLAIN = '{"x":5,"y":[1,2]}';
const CAPTCHA_ECB_CIPHERTEXT = '4RcMJ/JOQSeOD5UysK1F6m6w/FiVBcV3fkMlSe6+Nf4=';

/** 解开后为空串的载荷：16 字节全零 IV 加一段解出 16 个 0x10 的密文，PKCS7 去填充后为空。 */
const EMPTY_PLAINTEXT_PAYLOAD = 'AAAAAAAAAAAAAAAAAAAAAALexWUsAhX5OvafAJ8PbVg=';

/** 生成一对一次性 RSA 测试密钥，避免把密钥材料写进仓库。
 * @returns 公钥与私钥 PEM。
 */
function generateRsaKeyPair(): { privateKey: string; publicKey: string } {
  const generator = new JSEncrypt();
  return {
    privateKey: generator.getPrivateKey(),
    publicKey: generator.getPublicKey(),
  };
}

/** 本文件共用的测试密钥对。 */
const rsaKeyPair = generateRsaKeyPair();

/** 取出 RSA 加密结果，失败时抛错，避免用例里出现非空断言。
 * @param encrypted RSA.encrypt 的返回值。
 * @returns 加密后的字符串。
 * @throws 返回值不是字符串时抛出，说明该用例的前置加密已失败。
 */
function requireString(encrypted: false | string): string {
  if (typeof encrypted !== 'string') {
    throw new TypeError('RSA 加密未返回字符串');
  }
  return encrypted;
}

/** 构造一份加解密配置，未列出的字段按契约补空。
 * @param overrides 需要覆盖的配置项。
 * @returns 传给 ApiEncrypt 的完整配置。
 */
function apiConfig(
  overrides: Partial<ApiEncryptConfig> = {},
): ApiEncryptConfig {
  return {
    algorithm: 'AES',
    enable: true,
    header: 'X-Api-Encrypt',
    requestKey: KEY,
    responseKey: KEY,
    ...overrides,
  };
}

/** 屏蔽加解密失败时的错误日志，只保留可断言的调用记录。
 * @returns 拦截后的 Spy。
 */
function silenceError() {
  return vi
    .spyOn(console, 'error')
    .mockImplementation(/** 不真正打印日志，只让 Spy 记录调用。 */ () => {});
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('aES API encryption', /** 覆盖 AES-CBC 载荷格式的加解密互操作性，以及密钥长度非法时在加密前失败。 */ () => {
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

  it('rejects invalid AES key length', /** 密钥长度非法时必须在加密动作之前就失败，不能产出不可解的密文。 */ () => {
    silenceError();

    expect(
      /** 用 5 位短密钥触发长度校验，确认失败发生在加密之前而不是产出脏密文。 */
      () => AES.encrypt('data', 'short'),
    ).toThrow('AES 加密密钥长度必须为 16、24 或 32 位');
  });
});

describe('aES 密钥与载荷边界', /** 覆盖密钥为空、密文为空、密文过短与用错密钥这四类必须显式失败的输入。 */ () => {
  it('加密时密钥为空立即报错', /** 空密钥不能退化成默认密钥，否则请求会以明文语义上"已加密"。 */ () => {
    expect(
      /** 传空密钥触发非空校验。 */
      () => AES.encrypt('data', ''),
    ).toThrow('AES 加密密钥不能为空');
  });

  it('解密时密钥为空立即报错', /** 解密侧同样不允许空密钥。 */ () => {
    expect(
      /** 传空密钥触发非空校验。 */
      () => AES.decrypt('payload', ''),
    ).toThrow('AES 解密密钥不能为空');
  });

  it('解密时密文为空报错', /** 空密文解密没有意义。 */ () => {
    expect(
      /** 传空密文触发非空校验。 */
      () => AES.decrypt('', KEY),
    ).toThrow('AES 解密数据不能为空');
  });

  it('密文短于 IV 时报格式错误', /** 载荷必须至少包含 16 字节 IV。 */ () => {
    expect(
      /** 传 3 字节密文触发长度校验。 */
      () => AES.decrypt('QUJD', KEY),
    ).toThrow('AES 解密数据格式不正确');
  });

  it('解开后为空串时报解密结果为空', /** 解出空明文无法作为业务数据，必须报错而不是返回空串。 */ () => {
    silenceError();

    expect(
      /** 用固定载荷触发空结果分支，避免随机 IV 带来的不确定性。 */
      () => AES.decrypt(EMPTY_PLAINTEXT_PAYLOAD, KEY),
    ).toThrow('AES 解密结果为空');
  });

  it('失败时记录加密作用域日志后原样抛出', /** 日志用于定位，异常仍要交给调用方处理。 */ () => {
    const error = silenceError();

    expect(
      /** 触发密钥长度校验失败。 */
      () => AES.encrypt('data', 'short'),
    ).toThrow();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('AES encrypt failed'),
    );
  });

  it('解密失败时记录解密作用域日志', /** 加密与解密的日志要能区分方向。 */ () => {
    const error = silenceError();

    expect(
      /** 触发密文过短失败。 */
      () => AES.decrypt('QUJD', KEY),
    ).toThrow();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('AES decrypt failed'),
    );
  });
});

describe('aj 验证码 aES', /** 后端用 AES/ECB/PKCS5，密文必须与后端一致，且同一明文每次结果相同。 */ () => {
  it('产出与后端一致的已知密文', /** 这条已知答案锚定的是跨端协议，不是本实现的自我复述。 */ () => {
    expect(AjCaptchaAES.encrypt(CAPTCHA_PLAIN, KEY)).toBe(
      CAPTCHA_ECB_CIPHERTEXT,
    );
  });

  it('同一明文每次密文相同', /** ECB 不带 IV，这是后端协议要求而非缺陷。 */ () => {
    expect(AjCaptchaAES.encrypt(CAPTCHA_PLAIN, KEY)).toBe(
      AjCaptchaAES.encrypt(CAPTCHA_PLAIN, KEY),
    );
  });

  it('与 CBC 通道的密文不同', /** 两个通道的载荷格式不能互相替代。 */ () => {
    expect(AjCaptchaAES.encrypt(CAPTCHA_PLAIN, KEY)).not.toBe(
      AES.encrypt(CAPTCHA_PLAIN, KEY),
    );
  });

  it('密钥为空时报验证码专用文案', /** 报错要指出是验证码通道，便于定位配置来源。 */ () => {
    expect(
      /** 传空密钥触发非空校验。 */
      () => AjCaptchaAES.encrypt('data', ''),
    ).toThrow('AES 验证码加密密钥不能为空');
  });

  it('密钥长度非法时报验证码专用文案', /** 同样要在真正加密前失败。 */ () => {
    silenceError();

    expect(
      /** 传 5 位短密钥触发长度校验。 */
      () => AjCaptchaAES.encrypt('data', 'short'),
    ).toThrow('AES 验证码加密密钥长度必须为 16、24 或 32 位');
  });
});

describe('mD5 摘要', /** 固定输入的摘要必须与公开已知值一致。 */ () => {
  it('输出 abc 的标准摘要', /** 已知答案可证明实现没有多编码一次或少一次。 */ () => {
    expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
  });

  it('空串输出标准空摘要', /** 空串也必须有确定结果。 */ () => {
    expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });
});

describe('rSA 加解密', /** 公钥加密、私钥解密，并覆盖密钥缺失与用错私钥的失败路径。 */ () => {
  it('公钥加密后可用对应私钥解密', /** 端到端往返必须还原原文。 */ () => {
    const encrypted = RSA.encrypt(PLAIN_TEXT, rsaKeyPair.publicKey);

    expect(typeof encrypted).toBe('string');
    expect(RSA.decrypt(requireString(encrypted), rsaKeyPair.privateKey)).toBe(
      PLAIN_TEXT,
    );
  });

  it('公钥为空时报错', /** 没有公钥就无法加密。 */ () => {
    expect(
      /** 传空公钥触发校验。 */
      () => RSA.encrypt('data', ''),
    ).toThrow('RSA 公钥不能为空');
  });

  it('公钥格式非法时报加密失败', /** 解析不出密钥时不能返回空串。 */ () => {
    silenceError();

    expect(
      /** 传非密钥文本触发解析失败。 */
      () => RSA.encrypt('data', 'not-a-key'),
    ).toThrow('RSA 加密失败');
  });

  it('私钥为空时报错', /** 没有私钥就无法解密。 */ () => {
    expect(
      /** 传空私钥触发校验。 */
      () => RSA.decrypt('payload', ''),
    ).toThrow('RSA 私钥不能为空');
  });

  it('密文为空时报错', /** 空密文解密没有意义。 */ () => {
    expect(
      /** 传空密文触发校验。 */
      () => RSA.decrypt('', rsaKeyPair.privateKey),
    ).toThrow('RSA 解密数据不能为空');
  });

  it('私钥格式非法时报解密失败', /** 私钥配错时底层返回 false，必须转成异常而不是把 false 交给调用方。 */ () => {
    silenceError();

    expect(
      /** 用非密钥文本作为私钥触发解密失败。 */
      () => RSA.decrypt('QUJD', 'not-a-key'),
    ).toThrow('RSA 解密失败');
  });
});

describe('aPI 加解密实例', /** 覆盖启用开关、两种算法、JSON 解析回退与不支持算法的失败路径。 */ () => {
  it('未启用时响应原样返回', /** 关闭加密时不能改动业务数据。 */ () => {
    const instance = new ApiEncrypt(apiConfig({ enable: false }));

    expect(instance.decryptResponse(PLAIN_TEXT)).toBe(PLAIN_TEXT);
  });

  it('未启用时请求原样返回', /** 关闭加密时不能把明文发出去。 */ () => {
    const instance = new ApiEncrypt(apiConfig({ enable: false }));
    const body = { username: 'admin' };

    expect(instance.encryptRequest(body)).toBe(body);
  });

  it('返回配置的加密头名称', /** 请求拦截器要按这个头写入密文标记。 */ () => {
    expect(new ApiEncrypt(apiConfig()).getEncryptHeader()).toBe(
      'X-Api-Encrypt',
    );
  });

  it('aES 响应解密后按 JSON 解析', /** 后端返回 JSON 时要还原成对象。 */ () => {
    const instance = new ApiEncrypt(apiConfig());
    const encrypted = AES.encrypt(PLAIN_TEXT, KEY);

    expect(instance.decryptResponse(encrypted)).toEqual({
      password: 'Abcd12',
      username: 'admin',
    });
  });

  it('aES 响应不是 JSON 时返回原始字符串', /** 纯文本响应不能因解析失败而丢失。 */ () => {
    const instance = new ApiEncrypt(apiConfig());
    const encrypted = AES.encrypt('plain text', KEY);

    expect(instance.decryptResponse(encrypted)).toBe('plain text');
  });

  it('aES 响应缺少密钥时报错', /** 没配密钥就不能继续处理响应。 */ () => {
    const instance = new ApiEncrypt(apiConfig({ responseKey: '' }));

    expect(
      /** 触发响应密钥缺失。 */
      () => instance.decryptResponse('payload'),
    ).toThrow('AES 响应解密密钥未配置');
  });

  it('aES 请求把对象序列化成 JSON 后加密', /** 请求体是对象时要先序列化。 */ () => {
    const instance = new ApiEncrypt(apiConfig());

    const encrypted = instance.encryptRequest({ username: 'admin' });

    expect(typeof encrypted).toBe('string');
    expect(AES.decrypt(encrypted as string, KEY)).toBe('{"username":"admin"}');
  });

  it('aES 请求已序列化时不再二次序列化', /** 字符串入参必须原样加密。 */ () => {
    const instance = new ApiEncrypt(apiConfig());

    const encrypted = instance.encryptRequest(PLAIN_TEXT);

    expect(AES.decrypt(encrypted as string, KEY)).toBe(PLAIN_TEXT);
  });

  it('aES 请求缺少密钥时报错', /** 没配密钥就不能把明文发出去。 */ () => {
    const instance = new ApiEncrypt(apiConfig({ requestKey: '' }));

    expect(
      /** 触发请求密钥缺失。 */
      () => instance.encryptRequest({ a: 1 }),
    ).toThrow('AES 请求加密密钥未配置');
  });

  it('rSA 响应用私钥解密后按 JSON 解析', /** RSA 通道同样要还原业务对象。 */ () => {
    const instance = new ApiEncrypt(
      apiConfig({
        algorithm: 'RSA',
        requestKey: rsaKeyPair.publicKey,
        responseKey: rsaKeyPair.privateKey,
      }),
    );
    const encrypted = RSA.encrypt(PLAIN_TEXT, rsaKeyPair.publicKey);

    expect(instance.decryptResponse(encrypted)).toEqual({
      password: 'Abcd12',
      username: 'admin',
    });
  });

  it('rSA 响应缺少私钥时报错', /** 私钥未配置时不能继续解密。 */ () => {
    const instance = new ApiEncrypt(
      apiConfig({ algorithm: 'RSA', responseKey: '' }),
    );

    expect(
      /** 触发私钥缺失。 */
      () => instance.decryptResponse('payload'),
    ).toThrow('RSA 私钥未配置');
  });

  it('rSA 请求用公钥加密', /** 加密结果必须能被对应私钥解开。 */ () => {
    const instance = new ApiEncrypt(
      apiConfig({
        algorithm: 'RSA',
        requestKey: rsaKeyPair.publicKey,
        responseKey: rsaKeyPair.privateKey,
      }),
    );

    const encrypted = instance.encryptRequest({ username: 'admin' });

    expect(RSA.decrypt(encrypted as string, rsaKeyPair.privateKey)).toBe(
      '{"username":"admin"}',
    );
  });

  it('rSA 请求缺少公钥时报错', /** 公钥未配置时不能放行明文请求。 */ () => {
    const instance = new ApiEncrypt(
      apiConfig({ algorithm: 'RSA', requestKey: '' }),
    );

    expect(
      /** 触发公钥缺失。 */
      () => instance.encryptRequest({ a: 1 }),
    ).toThrow('RSA 公钥未配置');
  });

  it('rSA 请求公钥格式非法时报加密失败', /** 底层返回 false 时必须转成异常，不能把 false 当密文发出去。 */ () => {
    const instance = new ApiEncrypt(
      apiConfig({ algorithm: 'RSA', requestKey: 'not-a-key' }),
    );
    silenceError();

    expect(
      /** 用非密钥文本触发底层加密失败。 */
      () => instance.encryptRequest({ a: 1 }),
    ).toThrow('RSA 加密失败');
  });

  it('rSA 响应私钥格式非法时报解密失败', /** 同上，响应侧必须中断而不是返回 false。 */ () => {
    const instance = new ApiEncrypt(
      apiConfig({ algorithm: 'RSA', responseKey: 'not-a-key' }),
    );
    silenceError();

    expect(
      /** 用非密钥文本触发底层解密失败。 */
      () => instance.decryptResponse('QUJD'),
    ).toThrow('RSA 解密失败');
  });

  it('解密出空串时报错', /** 空明文无法作为业务数据继续处理。 */ () => {
    const instance = new ApiEncrypt(
      apiConfig({
        algorithm: 'RSA',
        requestKey: rsaKeyPair.publicKey,
        responseKey: rsaKeyPair.privateKey,
      }),
    );
    const encrypted = RSA.encrypt('', rsaKeyPair.publicKey);

    expect(
      /** 解密空串结果时必须中断本次响应处理。 */
      () => instance.decryptResponse(requireString(encrypted)),
    ).toThrow('解密结果为空');
  });

  it('不支持的解密算法直接报错', /** 配置错误必须暴露，不能静默改写成默认算法。 */ () => {
    const instance = new ApiEncrypt(apiConfig({ algorithm: 'DES' }));
    silenceError();

    expect(
      /** 触发不支持的算法分支。 */
      () => instance.decryptResponse('payload'),
    ).toThrow('不支持的解密算法: DES');
  });

  it('不支持的加密算法直接报错', /** 同上，明文不能被放行。 */ () => {
    const instance = new ApiEncrypt(apiConfig({ algorithm: 'DES' }));
    silenceError();

    expect(
      /** 触发不支持的算法分支。 */
      () => instance.encryptRequest({ a: 1 }),
    ).toThrow('不支持的加密算法: DES');
  });

  it('响应解密失败时记录作用域日志', /** 日志要能区分响应方向。 */ () => {
    const instance = new ApiEncrypt(apiConfig({ algorithm: 'DES' }));
    const error = silenceError();

    expect(
      /** 触发不支持的算法失败。 */
      () => instance.decryptResponse('payload'),
    ).toThrow();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('API response decrypt failed'),
    );
  });

  it('请求加密失败时记录作用域日志', /** 日志要能区分请求方向。 */ () => {
    const instance = new ApiEncrypt(apiConfig({ algorithm: 'DES' }));
    const error = silenceError();

    expect(
      /** 触发不支持的算法失败。 */
      () => instance.encryptRequest({ a: 1 }),
    ).toThrow();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('API request encrypt failed'),
    );
  });
});

describe('按环境变量创建实例', /** 环境变量缺失时必须落到确定的默认值，而不是未定义。 */ () => {
  it('环境变量齐全时按配置创建', /** 显式配置优先于默认值。 */ () => {
    const instance = createApiEncrypt({
      VITE_APP_API_ENCRYPT_ALGORITHM: 'RSA',
      VITE_APP_API_ENCRYPT_ENABLE: 'true',
      VITE_APP_API_ENCRYPT_HEADER: 'X-Custom',
      VITE_APP_API_ENCRYPT_REQUEST_KEY: rsaKeyPair.publicKey,
      VITE_APP_API_ENCRYPT_RESPONSE_KEY: rsaKeyPair.privateKey,
    });

    expect(instance.getEncryptHeader()).toBe('X-Custom');
    expect(instance.encryptRequest({ a: 1 })).toBeTypeOf('string');
  });

  it('未启用时原样透传请求体', /** enable 只认字符串 true，其它值都视为关闭。 */ () => {
    const instance = createApiEncrypt({});
    const body = { a: 1 };

    expect(instance.encryptRequest(body)).toBe(body);
  });

  it('缺少加密头时使用默认头名', /** 默认头名是前后端约定值。 */ () => {
    expect(createApiEncrypt({}).getEncryptHeader()).toBe('X-Api-Encrypt');
  });

  it('缺少算法时默认走 AES', /** 未配置算法时按最常用的通道处理。 */ () => {
    silenceError();
    const instance = createApiEncrypt({
      VITE_APP_API_ENCRYPT_ENABLE: 'true',
    });

    expect(
      /** 默认算法下 AES 因缺少密钥而失败，可据此确认算法已落到 AES。 */
      () => instance.encryptRequest({ a: 1 }),
    ).toThrow('AES 请求加密密钥未配置');
  });
});
