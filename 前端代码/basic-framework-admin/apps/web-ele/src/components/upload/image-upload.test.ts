/** 验证 ImageUpload 多文件部分失败保留已成功项、支持 resultField 透传与错误提示去重。 */
import type { UploadRequestOptions } from 'element-plus';

import type { VueWrapper } from '@vue/test-utils';

import { flushPromises, mount } from '@vue/test-utils';

import { ElUpload } from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ImageUpload from './image-upload.vue';

const showErrorMock = vi.hoisted(() => vi.fn());

vi.mock('@vben/icons', () => ({ IconifyIcon: 'span' }));
vi.mock('@vben/locales', () => ({
  /** 返回测试可读的固定提示键名。 */
  $t: (key: string) => key,
}));
vi.mock('./use-upload', () => ({
  /** 隔离运行时环境全局配置依赖，测试均通过 api prop 注入上传函数。 */
  useUpload: vi.fn(() => ({ httpRequest: vi.fn(), uploadUrl: '/upload' })),
  /** 提供精简上传类型计算返回值，避免挂载阶段读取全局配置。 */
  useUploadType: vi.fn(() => ({
    getAccept: [],
    getHelpText: '',
    getStringAccept: '',
  })),
}));
vi.mock('#/utils/feedback', async () => {
  const actual =
    await vi.importActual<typeof import('#/utils/feedback')>(
      '#/utils/feedback',
    );
  return {
    ...actual,
    showError: showErrorMock,
    showErrorMessage: vi.fn(),
    showSuccessMessage: vi.fn(),
  };
});

/** Element Plus 上传前置校验回调签名。 */
type BeforeUploadFn = (raw: File) => Promise<boolean>;

/** Element Plus 自定义上传请求回调签名。 */
type HttpRequestFn = (options: UploadRequestOptions) => Promise<void>;

let wrapper: undefined | VueWrapper;

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  showErrorMock.mockReset();
});

/**
 * 构造可控上传请求参数并依次触发 beforeUpload 与 httpRequest。
 *
 * @param name 模拟文件名
 * @param uid Element Plus 唯一编号
 */
async function triggerUpload(name: string, uid: number) {
  if (!wrapper) {
    throw new Error('ImageUpload 尚未挂载');
  }
  const uploadCmp = wrapper.findComponent(ElUpload);
  const file = Object.assign(new File(['ok'], name, { type: 'image/png' }), {
    uid,
  });
  const beforeUpload = uploadCmp.props('beforeUpload') as BeforeUploadFn;
  const httpRequest = uploadCmp.props('httpRequest') as HttpRequestFn;
  const allowed = await beforeUpload(file);
  expect(allowed).toBe(true);
  await httpRequest({
    action: '',
    data: {},
    file,
    filename: 'file',
    headers: {},
    method: 'post',
    onError: vi.fn(),
    onProgress: vi.fn(),
    onSuccess: vi.fn(),
    withCredentials: false,
  } as unknown as UploadRequestOptions);
}

/** 验证 ImageUpload 批上传结算与去重行为。 */
function describeImageUpload() {
  it('同批 A 成功 B 失败时保留 A 并仅对未标记错误弹窗一次', async () => {
    const handledErr = new Error('服务端已提示');
    Object.defineProperty(handledErr, '__errorMessageHandled', {
      configurable: true,
      value: true,
    });
    const api = vi
      .fn()
      .mockResolvedValueOnce('https://cdn.test/a.png')
      .mockRejectedValueOnce(handledErr);

    wrapper = mount(ImageUpload, {
      props: { api, maxNumber: 3, modelValue: [], multiple: true },
    });

    await triggerUpload('a.png', 1);
    await triggerUpload('b.png', 2);
    await flushPromises();

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
      ['https://cdn.test/a.png'],
    ]);
    expect(showErrorMock).not.toHaveBeenCalled();

    const rawErr = new Error('S3 PUT 403');
    api.mockRejectedValueOnce(rawErr);
    await triggerUpload('c.png', 3);
    await flushPromises();
    expect(showErrorMock).toHaveBeenCalledTimes(1);
    expect(showErrorMock).toHaveBeenCalledWith(rawErr, 'ui.upload.uploadError');
  });

  it('配置 resultField 时保留 response 并输出完整响应对象', async () => {
    const payload = { id: 99, url: 'https://cdn.test/r.png' };
    const api = vi.fn().mockResolvedValueOnce({ data: payload });

    wrapper = mount(ImageUpload, {
      props: { api, maxNumber: 1, modelValue: '', resultField: 'data' },
    });

    await triggerUpload('r.png', 10);
    await flushPromises();

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([payload]);
  });
}

describe('imageUpload', describeImageUpload);
