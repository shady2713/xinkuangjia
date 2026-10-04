/**
 * 文件上传组件（apps/web-ele 的 upload/file-upload）取值重建与失败路径真实回归。
 *
 * 组件把外部绑定值重建为上传列表，并在预览、数量超限、类型/大小拒绝与上传失败时给出反馈：
 * 字符串值未归一化会让列表项缺失、内部操作标记未生效会让删除与外部回写形成回环、
 * 失败路径未提示或未回退计数会让用户重复上传并留下错误的列表状态，单值与多值的返回格式
 * 写错会让表单收到错误形状的值。用例挂载真实组件与真实 `ElUpload`，只替换图标、文案、
 * 消息提示与网络边界，取值重建、校验分支、事件顺序与返回值组装全部真实执行。
 */
import type { UploadFile } from 'element-plus';

import type { VueWrapper } from '@vue/test-utils';

import { flushPromises, mount } from '@vue/test-utils';

import { ElUpload } from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { showError, showErrorMessage } from '#/utils/feedback';

import FileUpload from './file-upload.vue';

vi.hoisted(
  /**
   * `use-upload` 在模块加载期读取运行时配置（上传模式与接口地址），
   * 因此必须在组件被导入之前建立最小替身；该配置只在首次导入时读取一次。
   */
  () => {
    vi.stubGlobal('_VBEN_ADMIN_PRO_APP_CONF_', {
      VITE_GLOB_API_URL: '/api',
      VITE_UPLOAD_TYPE: 'server',
    });
  },
);

vi.mock(
  '@vben/icons',
  /** 图标与上传链路无关，替换成可点击的最小元素。 */ () => ({
    IconifyIcon: { name: 'IconifyIcon', template: '<i data-test="icon"></i>' },
  }),
);

vi.mock(
  '@vben/locales',
  /**
   * 只把文案函数替换成返回键名，保留语言包加载等其余真实能力：
   * 组件依赖链上的 `#/locales` 会用到 `loadLocalesMapFromDir`。
   */
  async (importOriginal) => {
    const actual = await importOriginal<typeof import('@vben/locales')>();
    return {
      ...actual,
      /** 返回键名，使断言不依赖真实语言包。 */
      $t: (key: string) => key,
    };
  },
);

vi.mock(
  '#/utils/feedback',
  /** 消息提示会向 document.body 追加节点，测试中只记录调用。 */ () => ({
    showError: vi.fn(),
    showErrorMessage: vi.fn(),
    showSuccessMessage: vi.fn(),
  }),
);

/** 当前用例挂载的上传组件；用例结束统一卸载，避免残留组件影响后续用例。 */
let wrapper: undefined | VueWrapper;

afterEach(
  /** 卸载组件、还原替身并清空 DOM。 */
  () => {
    wrapper?.unmount();
    wrapper = undefined;
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  },
);

/**
 * 通过真实文件输入框“选择”一批文件，并等待上传链路完成。
 * happy-dom 不允许直接赋值 `input.files`，因此用属性定义注入选中的文件集合。
 * @param target 已挂载的上传组件。
 * @param files 本次要选择的原始文件，顺序即 Element Plus 分配 uid 的顺序。
 */
async function selectFiles(target: VueWrapper, files: File[]) {
  const input = target.get('input[type="file"]');
  Object.defineProperty(input.element, 'files', {
    configurable: true,
    value: files,
  });
  await input.trigger('change');
  await flushPromises();
}

/**
 * 读取 ElUpload 当前持有的文件列表。
 * `v-model:file-list` 双向绑定到组件内部列表，这里读到的是参与删除过滤的真实数据。
 * @param target 已挂载的上传组件。
 * @returns 当前文件列表项，每项都带 Element Plus 生成或组件写入的 uid。
 */
function readFileList(target: VueWrapper): UploadFile[] {
  return target.getComponent(ElUpload).props('fileList') as UploadFile[];
}

/**
 * 点击真实列表项上的关闭图标，走 ElUpload 的 uid 过滤删除链路。
 * @param target 已挂载的上传组件。
 * @param index 要删除的列表项下标。
 */
async function removeByIcon(target: VueWrapper, index: number) {
  const icons = target.findAll('.el-upload-list__item .el-icon--close');
  await icons[index]?.trigger('click');
  await flushPromises();
}

describe('绑定值重建上传列表', /** 绑定值决定页面初始显示哪些已上传文件，重建错会让用户看不到已有附件。 */ () => {
  it('字符串绑定值按地址解析出文件名', /** 单个地址字符串未归一化会让列表直接空白。 */ () => {
    wrapper = mount(FileUpload, {
      props: { maxNumber: 2, value: 'https://files.test/dir/报告.txt' },
    });

    const files = readFileList(wrapper);
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe('报告.txt');
    expect(files[0]?.url).toBe('https://files.test/dir/报告.txt');
    expect(files[0]?.status).toBe('success');

    wrapper.unmount();
  });

  it('对象形式的列表项按既有字段透传', /** 表单回填的对象项被丢弃会让编辑页看不到已上传附件。 */ () => {
    wrapper = mount(FileUpload, {
      props: {
        maxNumber: 3,
        value: [
          { name: '已上传.txt', uid: 7, url: 'https://files.test/a.txt' },
          { name: '无名项' },
          0,
        ] as unknown as string[],
      },
    });

    const files = readFileList(wrapper);
    expect(files).toHaveLength(2);
    expect(files[0]).toMatchObject({
      name: '已上传.txt',
      uid: 7,
      url: 'https://files.test/a.txt',
    });
    // 缺少 uid 时按数组下标生成稳定的负数标识，避免与真实 uid 冲突。
    expect(files[1]?.uid).toBe(-1);
    expect(files[1]?.status).toBe('success');

    wrapper.unmount();
  });

  it('绑定值清空时清空列表', /** 清空后仍保留旧项会让表单值与页面显示不一致。 */ async () => {
    wrapper = mount(FileUpload, {
      props: { maxNumber: 2, value: ['https://files.test/a.txt'] },
    });
    expect(readFileList(wrapper)).toHaveLength(1);

    wrapper.setProps({ value: '' });
    await flushPromises();

    expect(readFileList(wrapper)).toHaveLength(0);
  });

  it('外部值变化后按新值重建列表并恰好通知一次变更', /** 外部值变化不重建会让页面停在旧附件上，不通知会让表单拿不到新值，多通知会与双向绑定形成回环。 */ async () => {
    wrapper = mount(FileUpload, {
      props: { maxNumber: 3, value: ['https://files.test/a.txt'] },
    });

    // 首次渲染只建立内部列表：初始化不能被当成用户修改通知调用方。
    expect(wrapper.emitted('change')).toBeUndefined();

    wrapper.setProps({ value: ['https://files.test/b.txt'] });
    await flushPromises();

    const files = readFileList(wrapper);
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe('b.txt');
    // 外部变化必须恰好通知一次，载荷是新值。
    expect(wrapper.emitted('change')).toEqual([[['https://files.test/b.txt']]]);

    // 调用方按 v-model 把同一载荷写回时值没有变化，不得再次通知。
    wrapper.setProps({
      value: wrapper.emitted('change')?.[0]?.[0] as string[],
    });
    await flushPromises();

    expect(wrapper.emitted('change')).toHaveLength(1);
  });

  it('组件自身触发的变更复位标记后不再重建列表', /** 不回环才能让删除结果稳定，否则删除会被外部旧值覆盖。 */ async () => {
    wrapper = mount(FileUpload, {
      props: {
        maxNumber: 3,
        value: ['https://files.test/a.txt', 'https://files.test/b.txt'],
      },
    });

    await removeByIcon(wrapper, 0);
    expect(readFileList(wrapper)).toHaveLength(1);

    // 删除已把内部标记置位：紧接着的外部回写只复位标记，不重建列表、不再抛事件。
    wrapper.setProps({
      value: ['https://files.test/a.txt', 'https://files.test/b.txt'],
    });
    await flushPromises();

    expect(readFileList(wrapper)).toHaveLength(1);
    expect(wrapper.emitted('change')).toHaveLength(1);
  });
});

describe('预览与数量限制', /** 预览与超限提示是上传列表的基本交互，缺失会让用户无法确认附件内容。 */ () => {
  it('点击列表项触发预览事件并打开文件地址', /** 预览事件丢失会让业务无法自行处理预览。 */ async () => {
    const open = vi
      .spyOn(window, 'open')
      .mockImplementation(/** 屏蔽真实窗口打开，只保留调用记录。 */ () => null);
    wrapper = mount(FileUpload, {
      props: { maxNumber: 2, value: ['https://files.test/a.txt'] },
    });

    await wrapper.get('.el-upload-list__item-name').trigger('click');

    expect(wrapper.emitted('preview')?.at(-1)?.[0]).toMatchObject({
      name: 'a.txt',
      url: 'https://files.test/a.txt',
    });
    expect(open).toHaveBeenCalledWith('https://files.test/a.txt');
  });

  it('缺少地址的列表项只抛事件不打开窗口', /** 对空地址调用 window.open 会打开空白页。 */ async () => {
    const open = vi
      .spyOn(window, 'open')
      .mockImplementation(/** 屏蔽真实窗口打开，只保留调用记录。 */ () => null);
    wrapper = mount(FileUpload, {
      props: {
        maxNumber: 2,
        value: [{ name: '无地址.txt' }] as unknown as string[],
      },
    });

    await wrapper.get('.el-upload-list__item-name').trigger('click');

    expect(wrapper.emitted('preview')).toHaveLength(1);
    expect(open).not.toHaveBeenCalled();
  });

  it('一次选择超过上限的文件时提示数量限制', /** 超限不提示会让用户以为文件已加入上传队列。 */ async () => {
    const api = vi.fn();
    wrapper = mount(FileUpload, { props: { api, maxNumber: 1 } });

    await selectFiles(wrapper, [
      new File(['a'], 'a.txt', { type: 'text/plain' }),
      new File(['b'], 'b.txt', { type: 'text/plain' }),
    ]);

    expect(showErrorMessage).toHaveBeenCalledWith('ui.upload.maxNumber');
    expect(api).not.toHaveBeenCalled();
  });
});

describe('上传前校验', /** 校验决定哪些文件允许进入上传链路，漏判会让非法文件占用服务端资源。 */ () => {
  it('数量上限为 0 时组件自身拒绝上传', /** 禁用上传的配置必须由组件自己兜底，不能因为外部控件放行就真的上传。 */ async () => {
    const api = vi.fn();
    wrapper = mount(FileUpload, { props: { api, maxNumber: 0 } });

    await selectFiles(wrapper, [
      new File(['a'], 'a.txt', { type: 'text/plain' }),
    ]);

    expect(showErrorMessage).toHaveBeenCalledWith('ui.upload.maxNumber');
    expect(api).not.toHaveBeenCalled();
  });

  it('字符串绑定值为空时按 0 计数并拒绝上传', /** 空字符串绑定值必须按 0 计数，误判为 1 会让用户无法上传首个文件。 */ async () => {
    const api = vi.fn();
    wrapper = mount(FileUpload, { props: { api, maxNumber: 0, value: '' } });

    await selectFiles(wrapper, [
      new File(['a'], 'a.txt', { type: 'text/plain' }),
    ]);

    expect(showErrorMessage).toHaveBeenCalledWith('ui.upload.maxNumber');
    expect(api).not.toHaveBeenCalled();
  });

  it('非空字符串绑定值按 1 计数并拒绝上传', /** 单个地址字符串必须按 1 个文件计数，按 0 会让上限失效。 */ async () => {
    const api = vi.fn();
    wrapper = mount(FileUpload, {
      props: { api, maxNumber: 0, value: 'https://files.test/a.txt' },
    });

    await selectFiles(wrapper, [
      new File(['b'], 'b.txt', { type: 'text/plain' }),
    ]);

    expect(showErrorMessage).toHaveBeenCalledWith('ui.upload.maxNumber');
    expect(api).not.toHaveBeenCalled();
  });

  it('类型不在白名单时拒绝上传并提示允许的类型', /** 类型校验失效会让可执行文件被当作附件上传。 */ async () => {
    const api = vi.fn();
    wrapper = mount(FileUpload, {
      props: { accept: ['.png'], api, maxNumber: 2 },
    });

    await selectFiles(wrapper, [
      new File(['a'], 'a.txt', { type: 'text/plain' }),
    ]);

    expect(showErrorMessage).toHaveBeenCalledWith('ui.upload.acceptUpload');
    expect(api).not.toHaveBeenCalled();
  });

  it('超过大小上限时拒绝上传并提示上限', /** 大小校验失效会让超大文件打满服务端存储。 */ async () => {
    const api = vi.fn();
    wrapper = mount(FileUpload, {
      // 白名单按扩展名比较，写成带点的形式会被真实校验判为不匹配。
      props: { accept: ['txt'], api, maxNumber: 2, maxSize: 0.001 },
    });

    await selectFiles(wrapper, [
      new File(['x'.repeat(2048)], 'big.txt', { type: 'text/plain' }),
    ]);

    expect(showErrorMessage).toHaveBeenCalledWith('ui.upload.maxSizeMultiple');
    expect(api).not.toHaveBeenCalled();
  });
});

describe('上传失败路径', /** 失败路径决定用户能否知道上传没成功以及列表是否留下错误的成功状态。 */ () => {
  it('上传请求失败时提示错误并移除失败项', /** 失败不提示会让用户以为附件已上传，保留失败项会污染附件值。 */ async () => {
    const error = new Error('上传接口不可用');
    const api = vi.fn().mockRejectedValue(error);
    wrapper = mount(FileUpload, { props: { api, maxNumber: 2 } });

    await selectFiles(wrapper, [
      new File(['a'], 'a.txt', { type: 'text/plain' }),
    ]);

    expect(api).toHaveBeenCalledTimes(1);
    expect(showError).toHaveBeenCalledWith(error, 'ui.upload.uploadError');
    // Element Plus 的失败处理会把失败项移出列表，组件自身不得再抛成功类的变更事件。
    expect(readFileList(wrapper)).toHaveLength(0);
    expect(wrapper.emitted('change')).toBeUndefined();
    expect(wrapper.emitted('update:value')).toBeUndefined();
  });
});

describe('返回值格式', /** 返回格式由单值/多值与绑定参数共同决定，写错会让表单收到错误形状的值。 */ () => {
  it('单值模式下字符串绑定值返回字符串', /** 单值表单收到数组会让后端字段解析失败。 */ async () => {
    wrapper = mount(FileUpload, {
      props: { maxNumber: 1, value: 'https://files.test/a.txt' },
    });

    await removeByIcon(wrapper, 0);

    expect(wrapper.emitted('update:value')?.at(-1)?.[0]).toBe('');
  });

  it('单值模式下数组绑定值返回字符串', /** 数组绑定同样按单值口径返回，不能返回空数组。 */ async () => {
    wrapper = mount(FileUpload, {
      props: { maxNumber: 1, value: ['https://files.test/a.txt'] },
    });

    await removeByIcon(wrapper, 0);

    expect(wrapper.emitted('update:value')?.at(-1)?.[0]).toBe('');
  });

  it('多值模式下数组 modelValue 返回数组', /** 多值表单收到逗号字符串会让后端无法拆分多个附件。 */ async () => {
    wrapper = mount(FileUpload, {
      props: {
        maxNumber: 2,
        modelValue: ['https://files.test/a.txt', 'https://files.test/b.txt'],
      },
    });

    await removeByIcon(wrapper, 0);

    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual([
      'https://files.test/b.txt',
    ]);
  });

  it('多值模式下字符串 modelValue 返回逗号字符串', /** 字符串绑定必须保持字符串形状，返回数组会破坏调用方约定。 */ async () => {
    wrapper = mount(FileUpload, {
      props: {
        maxNumber: 2,
        modelValue: 'https://files.test/a.txt,https://files.test/b.txt',
      },
    });

    await removeByIcon(wrapper, 0);

    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toBe('');
  });

  it('未使用 modelValue 时按 value 的形状返回', /** 未使用 v-model 的调用方同样要拿到与入参一致的值形状。 */ async () => {
    wrapper = mount(FileUpload, {
      props: {
        maxNumber: 2,
        value: ['https://files.test/a.txt', 'https://files.test/b.txt'],
      },
    });

    await removeByIcon(wrapper, 0);

    expect(wrapper.emitted('update:value')?.at(-1)?.[0]).toEqual([
      'https://files.test/b.txt',
    ]);

    wrapper.unmount();
  });
});

describe('上传说明', /** 说明文案让用户在上传前知道限制，缺失会导致反复上传被拒。 */ () => {
  it('开启说明时展示大小与格式限制', /** 限制文案丢失会让用户无法预判哪些文件可以上传。 */ () => {
    wrapper = mount(FileUpload, {
      props: {
        accept: ['.txt', '.pdf'],
        maxSize: 5,
        showDescription: true,
      },
    });

    const text = wrapper.text();
    expect(text).toContain('请上传不超过');
    expect(text).toContain('5MB');
    expect(text).toContain('.txt/.pdf');

    wrapper.unmount();
  });

  it('未开启说明时不渲染限制文案', /** 负对照：关闭说明后不得残留限制文本。 */ () => {
    wrapper = mount(FileUpload, {
      props: { accept: ['.txt'], maxSize: 5, showDescription: false },
    });

    expect(wrapper.text()).not.toContain('请上传不超过');

    wrapper.unmount();
  });
});
