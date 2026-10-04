/**
 * 上传编排核心工具（use-upload-core）的真实行为回归。
 *
 * 该模块负责把三种上传接口返回值口径收敛为统一形状、计算对外暴露值、把任意异常
 * 转换成 Element Plus 期望的错误对象，并按配置选择真实上传实现。
 * 用例真实调用每个导出函数并断言返回值、抛错与回调参数；只把后端上传接口与
 * 直传实现替换成记录型替身，解包与兜底逻辑全部真实执行。
 */
import type { UploadRequestOptions } from 'element-plus';

import type { UploadApiResult } from './typing';

import type { AxiosProgressEvent } from '#/api/core/file';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  requestUpload,
  resolveUploadUrl,
  resolveUploadValue,
  toUploadAjaxError,
  unwrapUploadResponse,
} from './use-upload-core';

/** 上传进度回调签名：与真实上传接口声明保持同一口径。 */
type ProgressHandler = AxiosProgressEvent;

/** 进度回调收到的进度事件对象，从回调签名推导。 */
type ProgressPayload = Parameters<NonNullable<ProgressHandler>>[0];

/** 上传接口与直传实现的记录型替身，供用例断言真实调用参数。 */
const spies = vi.hoisted(
  /** 建立跨用例共享的替身容器。 */
  () => ({
    uploadDirect: vi.fn(),
    uploadFile: vi.fn(),
  }),
);

vi.mock(
  '#/api/core/file',
  /** 只替换后端上传边界，保留类型与进度适配逻辑。 */ () => ({
    uploadFile: spies.uploadFile,
  }),
);

vi.mock(
  './upload-direct',
  /** 只替换客户端直传边界，保留调用编排逻辑。 */ () => ({
    uploadDirect: spies.uploadDirect,
  }),
);

vi.mock(
  '@vben/hooks',
  /** 固定接口根地址，避免依赖运行时配置脚本。 */ () => ({
    /** 返回测试用接口根地址。 */ useAppConfig: () => ({ apiURL: '/api' }),
  }),
);

vi.hoisted(
  /**
   * `use-upload` 在模块加载期读取运行时上传模式，必须在被测模块导入前建立替身。
   */
  () => {
    vi.stubGlobal('_VBEN_ADMIN_PRO_APP_CONF_', {
      VITE_UPLOAD_TYPE: 'server',
    });
  },
);

/**
 * 构造 Element Plus 上传请求上下文。
 * @param overrides 本次要覆盖的上下文字段。
 * @returns 满足真实调用契约的上传请求上下文。
 */
function createOptions(
  overrides: Record<string, unknown> = {},
): UploadRequestOptions {
  return {
    action: '/infra/file/upload',
    file: new File(['内容'], 'report.txt', { type: 'text/plain' }),
    method: 'post',
    ...overrides,
  } as unknown as UploadRequestOptions;
}

describe('上传返回值解包', /** 后端三种返回值口径必须收敛为同一形状，否则页面拿不到文件地址。 */ () => {
  it('含 data 字段的包装响应被解开，其余原样返回', /** axios 包装响应不解开会把响应对象当成业务数据。 */ () => {
    expect(unwrapUploadResponse({ data: { url: '/a.txt' } })).toEqual({
      url: '/a.txt',
    });
    expect(unwrapUploadResponse('/plain.txt')).toBe('/plain.txt');
    expect(unwrapUploadResponse(null)).toBeNull();
    expect(unwrapUploadResponse(undefined)).toBeUndefined();
  });

  it('依次尝试纯字符串、对象 url 与对象 data 提取地址', /** 顺序写错会让直传与后端上传其中一条链路拿不到地址。 */ () => {
    expect(resolveUploadUrl('https://files.test/a.txt')).toBe(
      'https://files.test/a.txt',
    );
    expect(resolveUploadUrl({ url: 'https://files.test/b.txt' })).toBe(
      'https://files.test/b.txt',
    );
    expect(resolveUploadUrl({ data: 'https://files.test/c.txt' })).toBe(
      'https://files.test/c.txt',
    );
    // 解包后仍是包装对象时，按对象的 data 字段兜底取值。
    expect(
      resolveUploadUrl({ data: { data: 'https://files.test/e.txt' } }),
    ).toBe('https://files.test/e.txt');
    expect(
      resolveUploadUrl({ data: { url: 'https://files.test/d.txt' } }),
    ).toBe('https://files.test/d.txt');
    expect(resolveUploadUrl({})).toBe('');
    expect(resolveUploadUrl(null)).toBe('');
  });

  it('配置了 resultField 时返回完整响应，否则按回退顺序取值', /** 需要整段业务响应时不能只暴露地址，回退顺序错会让表单存下空值。 */ () => {
    const file = {
      response: { data: { url: '/from-response.txt' } },
      url: '/from-file.txt',
    };

    expect(resolveUploadValue(file as never, 'response')).toEqual({
      url: '/from-response.txt',
    });
    expect(resolveUploadValue(file as never)).toBe('/from-file.txt');
    expect(resolveUploadValue({ response: 'plain', url: '' } as never)).toBe(
      'plain',
    );
    expect(resolveUploadValue({ response: null } as never)).toBeNull();
  });
});

describe('上传错误对象构造', /** Element Plus 的失败分支会读取 status/method/url 三项，缺失会显示空错误。 */ () => {
  it('补齐状态、方法与地址并保留原始异常', /** 丢失原始异常会让排查失去根因。 */ () => {
    const failure = new Error('后端拒绝');
    const error = toUploadAjaxError(
      failure,
      createOptions({ method: 'put' }),
    ) as Error & {
      cause?: unknown;
      method: string;
      status: number;
      url: string;
    };

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('后端拒绝');
    expect(error.status).toBe(0);
    expect(error.method).toBe('put');
    expect(error.url).toBe('/infra/file/upload');
    expect(error.cause).toBe(failure);
  });

  it('非 Error 抛出值被转成文本消息', /** 后端可能抛出字符串，直接透传会让 message 变成 undefined。 */ () => {
    const error = toUploadAjaxError('字符串错误', createOptions()) as Error;

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('字符串错误');
  });
});

describe('真实上传编排', /** 上传入口决定进度回传与目录参数是否生效。 */ () => {
  beforeEach(
    /** 清空上一用例的调用记录。 */ () => {
      spies.uploadDirect.mockReset();
      spies.uploadFile.mockReset();
    },
  );

  it('使用调用方传入的 api 并换算真实进度百分比', /** 进度换算错误会让进度条停在错误比例。 */ async () => {
    const api = vi.fn(
      /**
       * 触发一次进度回调后返回上传结果。
       * @param _file 本次上传的文件。
       * @param onProgress 进度回调，由被测代码真实传入。
       * @returns 后端上传结果。
       */
      async (_file: File, onProgress?: ProgressHandler) => {
        onProgress?.({
          loaded: 50,
          total: 200,
        } as unknown as ProgressPayload);
        return { url: '/done.txt' };
      },
    );
    const onProgress = vi.fn();

    const result = await requestUpload({ api }, createOptions({ onProgress }));

    expect(result).toEqual({ url: '/done.txt' });
    expect(onProgress).toHaveBeenCalledWith({
      lengthComputable: true,
      loaded: 50,
      percent: 25,
      total: 200,
    });
  });

  it('未提供 api 时回退到默认上传接口并透传目录', /** 回退链路失效会让不传 api 的上传组件完全不可用。 */ async () => {
    spies.uploadFile.mockResolvedValue({ url: '/server.txt' });

    const result = await requestUpload(
      { directory: 'avatar' },
      createOptions(),
    );

    expect(result).toEqual({ url: '/server.txt' });
    expect(spies.uploadFile).toHaveBeenCalledTimes(1);
    expect(spies.uploadFile.mock.calls[0]?.[0]).toMatchObject({
      directory: 'avatar',
    });
    expect(spies.uploadFile.mock.calls[0]?.[1]).toBeTypeOf('function');
  });

  it('总长度为零时进度记为零而不是 NaN', /** 无法计算总长度时显示 NaN% 会破坏进度条。 */ async () => {
    const api = vi.fn(
      /**
       * 用零总长度触发进度回调。
       * @param _file 本次上传的文件。
       * @param onProgress 进度回调，由被测代码真实传入。
       * @returns 后端上传结果。
       */
      async (_file: File, onProgress?: ProgressHandler) => {
        onProgress?.({ loaded: 10, total: 0 } as unknown as ProgressPayload);
        return { url: '/zero.txt' };
      },
    );
    const onProgress = vi.fn();

    await requestUpload({ api }, createOptions({ onProgress }));

    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ loaded: 10, percent: 0, total: 0 }),
    );
  });

  it('接口未返回结果时抛错', /** 把 undefined 当成功会让表单记录一个空地址。 */ async () => {
    const api = vi.fn(
      /** 模拟后端未返回任何结果。 */ async () =>
        undefined as unknown as UploadApiResult,
    );

    await expect(requestUpload({ api }, createOptions())).rejects.toThrow(
      '上传接口未返回结果',
    );
  });
});
