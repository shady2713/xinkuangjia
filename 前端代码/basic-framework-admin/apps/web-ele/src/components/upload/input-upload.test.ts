/**
 * 输入框上传组件（apps/web-ele 的 upload/input-upload）真实行为回归。
 *
 * 组件把"只读输入框 + 文件上传"组合成一个控件：文件上传成功后读取到的文本内容要回填到
 * 输入框并同时向外抛出 change/update:value/update:modelValue，默认值要在没有 v-model 时
 * 作为初始值展示，调用方传入的 inputProps/textareaProps/fileUploadProps 必须原样透传。
 * 用例挂载真实组件、真实 `ElInput` 与真实 `FileUpload`，通过真实文件输入框触发读取，
 * 只替换图标、文案与消息提示。
 */
import type { VueWrapper } from '@vue/test-utils';

import { flushPromises, mount } from '@vue/test-utils';

import { afterEach, describe, expect, it, vi } from 'vitest';

import FileUpload from './file-upload.vue';
import InputUpload from './input-upload.vue';

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
  /** 图标与文本读取链路无关，替换成最小元素。 */ () => ({
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
  /** 卸载组件、还原替身并清空 DOM。 */ () => {
    wrapper?.unmount();
    wrapper = undefined;
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  },
);

/**
 * 通过真实文件输入框选择文本文件并等待读取链路完成。
 * happy-dom 不允许直接赋值 `input.files`，因此用属性定义注入选中的文件集合。
 * @param target 已挂载的输入框上传组件。
 * @param content 文件正文，上传前会被真实读取并回填到输入框。
 */
async function selectTextFile(target: VueWrapper, content: string) {
  const input = target.get('input[type="file"]');
  Object.defineProperty(input.element, 'files', {
    configurable: true,
    value: [new File([content], 'note.txt', { type: 'text/plain' })],
  });
  await input.trigger('change');
  await flushPromises();
}

/**
 * 读取输入框或文本域当前的真实取值。
 * @param element 原生表单元素。
 * @returns 元素当前的 value 属性值。
 */
function readValue(element: Element) {
  return (element as HTMLInputElement | HTMLTextAreaElement).value;
}

/** 上传接口替身：返回稳定地址，避免测试进程发起真实网络请求。 */
function uploadApi() {
  return vi.fn(
    /** 返回稳定地址的上传替身，避免测试进程发起真实网络请求。 */ async () =>
      'https://files.test/note.txt',
  );
}

describe('文本内容回填', /** 文件正文回填与事件是组件的核心契约，写错会让表单收不到内容。 */ () => {
  it('输入框模式读取文件正文并抛出三类事件', /** 缺少任一事件都会让使用不同 v-model 写法的表单收不到新值。 */ async () => {
    wrapper = mount(InputUpload, {
      props: {
        fileUploadProps: { api: uploadApi(), maxNumber: 2 },
        inputType: 'input',
      },
    });

    await selectTextFile(wrapper, '合同正文');

    expect(readValue(wrapper.get('input[type="text"]').element)).toBe(
      '合同正文',
    );
    expect(wrapper.emitted('change')?.at(-1)?.[0]).toBe('合同正文');
    expect(wrapper.emitted('update:value')?.at(-1)?.[0]).toBe('合同正文');
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toBe('合同正文');
  });

  it('文本域模式读取文件正文并回填', /** 文本域分支的绑定写错会让长文本预览框始终为空。 */ async () => {
    wrapper = mount(InputUpload, {
      props: {
        fileUploadProps: { api: uploadApi(), maxNumber: 2 },
        inputType: 'textarea',
      },
    });

    await selectTextFile(wrapper, '多行正文');

    const textarea = wrapper.get('textarea');
    expect(readValue(textarea.element)).toBe('多行正文');
    expect(textarea.attributes('rows')).toBe('4');
    expect(wrapper.emitted('change')?.at(-1)?.[0]).toBe('多行正文');
  });

  it('未指定输入类型时按文本域渲染', /** 默认分支写反会让调用方拿到与预期不同的控件。 */ () => {
    wrapper = mount(InputUpload, {
      props: { fileUploadProps: { api: uploadApi(), maxNumber: 2 } },
    });

    expect(wrapper.find('textarea').exists()).toBe(true);
    expect(wrapper.find('input[type="text"]').exists()).toBe(false);
  });
});

describe('属性透传', /** 透传决定调用方能否自定义控件属性与上传限制，丢失会让配置失效。 */ () => {
  it('输入框属性透传但真实取值优先', /** 调用方传入的 modelValue 不能覆盖组件自身持有的真实值。 */ () => {
    wrapper = mount(InputUpload, {
      props: {
        inputProps: { modelValue: '伪造值', placeholder: '请输入内容' },
        inputType: 'input',
        modelValue: '真实值',
      },
    });

    const input = wrapper.get('input[type="text"]');
    expect(readValue(input.element)).toBe('真实值');
    expect(input.attributes('placeholder')).toBe('请输入内容');
    expect(input.attributes('readonly')).toBeDefined();
  });

  it('文本域属性透传', /** 文本域属性丢失会让调用方无法调整行数与占位文案。 */ () => {
    wrapper = mount(InputUpload, {
      props: {
        inputType: 'textarea',
        textareaProps: { placeholder: '文本域占位' },
      },
    });

    expect(wrapper.get('textarea').attributes('placeholder')).toBe(
      '文本域占位',
    );
  });

  it('上传属性透传给内部上传组件', /** 上传限制丢失会让控件允许超出业务约定的文件数量与类型。 */ () => {
    wrapper = mount(InputUpload, {
      props: {
        fileUploadProps: { accept: ['txt'], maxNumber: 3 },
        inputType: 'input',
      },
    });

    const upload = wrapper.getComponent(FileUpload);
    expect(upload.props('maxNumber')).toBe(3);
    expect(upload.props('accept')).toEqual(['txt']);
  });

  it('未传上传属性时使用上传组件自身的默认值', /** 传空对象会覆盖内部默认值，必须保持上传组件的默认行为。 */ () => {
    wrapper = mount(InputUpload, { props: { inputType: 'input' } });

    expect(wrapper.getComponent(FileUpload).props('maxNumber')).toBe(1);
  });
});

describe('默认值', /** 默认值让未使用 v-model 的调用方也能看到初始内容。 */ () => {
  it('没有绑定值时展示默认值', /** 默认值未生效会让编辑页的已有内容丢失。 */ () => {
    wrapper = mount(InputUpload, {
      props: { defaultValue: '默认正文', inputType: 'input' },
    });

    expect(readValue(wrapper.get('input[type="text"]').element)).toBe(
      '默认正文',
    );
  });

  it('读取到文件正文后覆盖默认值', /** 读取结果未覆盖默认值会让用户以为文件没有被读取。 */ async () => {
    wrapper = mount(InputUpload, {
      props: {
        defaultValue: '默认正文',
        fileUploadProps: { api: uploadApi(), maxNumber: 2 },
        inputType: 'input',
      },
    });

    await selectTextFile(wrapper, '新的正文');

    expect(readValue(wrapper.get('input[type="text"]').element)).toBe(
      '新的正文',
    );
  });
});
