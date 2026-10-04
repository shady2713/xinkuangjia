/**
 * 上传组合式函数（use-upload）的真实行为回归。
 *
 * 该模块决定「限制提示怎么显示」与「上传走哪条链路」：接受类型必须补全为 `.后缀`、
 * 帮助文案按接受类型/大小/数量真实组装，上传模式则必须在后端上传与客户端直传之间
 * 真实切换并透传目录与进度回调。用例通过模块重载覆盖两种运行时上传模式，
 * 只替换后端上传、直传与文案函数三个边界。
 */
import { ref } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

/** 上传边界与文案函数的记录型替身；模块重载后仍指向同一实例。 */
const spies = vi.hoisted(
  /** 建立跨用例共享的替身容器。 */
  () => ({
    uploadDirect: vi.fn(),
    uploadFile: vi.fn(),
  }),
);

vi.mock(
  '#/api/core/file',
  /** 只替换后端上传边界，保留真实模式编排。 */ () => ({
    uploadFile: spies.uploadFile,
  }),
);

vi.mock(
  './upload-direct',
  /** 只替换客户端直传边界，保留真实模式编排。 */ () => ({
    uploadDirect: spies.uploadDirect,
  }),
);

vi.mock(
  '@vben/hooks',
  /** 固定接口根地址，避免依赖运行时配置脚本。 */ () => ({
    /** 返回测试用接口根地址。 */ useAppConfig: () => ({ apiURL: '/api' }),
  }),
);

vi.mock(
  '@vben/locales',
  /** 只替换文案函数，按「键(参数)」形式返回可断言文本。 */ () => ({
    /**
     * 拼接文案键与参数，便于断言提示组装逻辑。
     * @param key 文案键。
     * @param args 文案参数。
     * @returns 可断言的文案文本。
     */
    $t: (key: string, args?: unknown[]) => `${key}(${(args ?? []).join('|')})`,
  }),
);

/**
 * 以指定上传模式加载全新模块，覆盖模块加载期读取的运行时配置。
 * @param uploadType 运行时上传模式：client 为浏览器直传，server 为后端接收。
 * @returns 全新加载的 use-upload 模块。
 */
async function loadModule(uploadType: string) {
  vi.resetModules();
  vi.stubGlobal('_VBEN_ADMIN_PRO_APP_CONF_', { VITE_UPLOAD_TYPE: uploadType });
  return await import('./use-upload');
}

/**
 * 构造上传限制参数。
 * @param overrides 本次要覆盖的限制字段。
 * @returns 满足真实入参契约的限制参数集合。
 */
function createLimits(overrides: Record<string, unknown> = {}) {
  return {
    acceptRef: ref<string[]>(['image/*', '.png', 'jpg']),
    helpTextRef: ref<string>(''),
    maxNumberRef: ref<number>(5),
    maxSizeRef: ref<number>(2),
    ...overrides,
  } as Parameters<Awaited<ReturnType<typeof loadModule>>['useUploadType']>[0];
}

describe('上传限制展示', /** 提示文案与接受类型直接决定用户能否选中合法文件。 */ () => {
  afterEach(
    /** 恢复被替换的全局运行时配置。 */ () => {
      vi.unstubAllGlobals();
    },
  );

  it('接受类型补全为 . 后缀形式', /** 未补点的类型在部分浏览器上会被忽略，导致文件选不中。 */ async () => {
    const { useUploadType } = await loadModule('server');
    const { getAccept, getStringAccept } = useUploadType(createLimits());

    expect(getAccept.value).toEqual(['image/*', '.png', 'jpg']);
    expect(getStringAccept.value).toBe('image/*,.png,.jpg');

    const empty = useUploadType(createLimits({ acceptRef: ref<string[]>([]) }));
    expect(empty.getAccept.value).toEqual([]);
    expect(empty.getStringAccept.value).toBe('');
  });

  it('自定义帮助文案优先于自动组装', /** 业务自定义提示被覆盖会让页面说明与实际限制不符。 */ async () => {
    const { useUploadType } = await loadModule('server');
    const { getHelpText } = useUploadType(
      createLimits({ helpTextRef: ref('仅支持 PDF') }),
    );

    expect(getHelpText.value).toBe('仅支持 PDF');
  });

  it('未提供帮助文案时按接受类型、大小与数量组装', /** 缺少数量或大小限制说明会让用户反复触发失败上传。 */ async () => {
    const { useUploadType } = await loadModule('server');
    const { getHelpText } = useUploadType(createLimits());

    // 提示里的接受类型用原始取值，不做 . 后缀补全。
    expect(getHelpText.value).toBe(
      'ui.upload.accept(image/*,.png,jpg)，ui.upload.maxSize(2)，ui.upload.maxNumber(5)',
    );
  });

  it('数量为 Infinity 或大小为空时不追加对应说明', /** 无限数量与未限制大小不应产生无意义提示。 */ async () => {
    const { useUploadType } = await loadModule('server');
    const { getHelpText } = useUploadType(
      createLimits({
        acceptRef: ref<string[]>([]),
        maxNumberRef: ref(Number.POSITIVE_INFINITY),
        maxSizeRef: ref(0),
      }),
    );

    // 无限数量与未限制大小都不产生提示，结果为无内容。
    expect(getHelpText.value).toBe('');
  });
});

describe('上传链路选择', /** 选错链路会让后端直传或客户端直传其中一条彻底失效。 */ () => {
  afterEach(
    /** 清空调用记录并恢复全局运行时配置。 */ () => {
      spies.uploadDirect.mockReset();
      spies.uploadFile.mockReset();
      vi.unstubAllGlobals();
    },
  );

  it('server 模式调用后端上传接口并透传目录与进度回调', /** 目录与进度回调丢失会让文件存错位置且进度条不动。 */ async () => {
    const { useUpload } = await loadModule('server');
    spies.uploadFile.mockResolvedValue({ url: '/server.txt' });
    const progress = vi.fn();
    const file = new File(['内容'], 'report.txt', { type: 'text/plain' });

    const upload = useUpload('report');
    await expect(upload.httpRequest(file, progress)).resolves.toEqual({
      url: '/server.txt',
    });

    expect(spies.uploadFile).toHaveBeenCalledWith(
      { directory: 'report', file },
      progress,
    );
    expect(spies.uploadDirect).not.toHaveBeenCalled();
  });

  it('client 模式调用浏览器直传并透传目录与进度回调', /** 直传模式的目录用于服务端预约，丢失会写入错误路径。 */ async () => {
    const { useUpload } = await loadModule('client');
    spies.uploadDirect.mockResolvedValue({ url: '/direct.txt' });
    const progress = vi.fn();
    const file = new File(['内容'], 'avatar.png', { type: 'image/png' });

    const upload = useUpload('avatar');
    await expect(upload.httpRequest(file, progress)).resolves.toEqual({
      url: '/direct.txt',
    });

    expect(spies.uploadDirect).toHaveBeenCalledWith(file, 'avatar', progress);
    expect(spies.uploadFile).not.toHaveBeenCalled();
  });

  it('上传入口地址与接口根地址保持一致', /** 地址拼错会让上传请求打到不存在的路径。 */ async () => {
    const { getUploadUrl, useUpload } = await loadModule('server');

    expect(getUploadUrl()).toBe('/api/infra/file/upload');
    expect(useUpload().uploadUrl).toBe('/api/infra/file/upload');
  });
});
