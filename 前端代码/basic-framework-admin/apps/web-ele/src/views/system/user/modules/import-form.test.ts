/**
 * 用户导入弹窗（views/system/user/modules/import-form）真实行为回归。
 *
 * 该弹窗上传 Excel 后展示新增、更新与失败明细：未先校验就提交会让空文件请求发到后端；
 * 未选择文件时未取原始文件会让表单提交组件附加的状态字段而不是真实文件；提交结束后
 * 未解锁会让弹窗永久停在加载态；有失败明细时未转义用户名会让导入结果弹窗的结构被
 * 特殊字符破坏；成功与失败两种结果必须走不同提示通道，否则明细会被消息提示截断。
 * 用例按真实调用顺序驱动弹窗回调，只替换弹窗与表单渲染、上传组件边界、消息提示与
 * 网络边界，转义、计数与事件顺序全部按组件真实实现执行。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { ElButton, ElUpload } from 'element-plus';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { importUser, importUserTemplate } from '#/api/system/user';

import ImportForm from './import-form.vue';

/** 弹窗替身记录的回调与调用实例；模块替身与用例读取同一实例。 */
const modalProbe = vi.hoisted(
  /** 建立用例可设置数据、可断言的弹窗替身容器。 */ () => ({
    api: {
      close: vi.fn(),
      lock: vi.fn(),
      unlock: vi.fn(),
    },
    handlers: {} as {
      /** 提交回调，由组件在弹窗确认时声明。 */
      onConfirm?: () => Promise<void>;
    },
    options: undefined as Record<string, unknown> | undefined,
  }),
);

/** 表单替身记录的配置与调用实例；模块替身与用例读取同一实例。 */
const formProbe = vi.hoisted(
  /** 建立用例可设置返回值、可断言的表单替身容器。 */ () => ({
    api: {
      getValues: vi.fn(),
      setFieldValue: vi.fn(),
      validate: vi.fn(),
    },
    options: undefined as Record<string, unknown> | undefined,
  }),
);

vi.mock(
  '@vben/common-ui',
  /** 只替换弹窗容器，导入弹窗自身的校验、提交与结果展示逻辑保持真实实现。 */ async () => {
    const ModalStub = defineComponent({
      name: 'ModalStub',
      props: {
        /** 弹窗标题，用于核对组件声明的文案。 */
        title: { default: '', type: String },
      },
      /**
       * 渲染弹窗默认插槽与页脚前置插槽，使表单与下载入口进入组件树。
       * @param props 弹窗组件声明的属性。
       * @param context 组件上下文，用于取用插槽。
       * @param context.slots 调用方传入的插槽表。
       * @returns 渲染插槽的渲染函数。
       */
      setup(props, { slots }) {
        return /** 输出可定位的弹窗内容与页脚前置内容。 */ () =>
          h('div', { class: 'modal-stub', 'data-title': props.title }, [
            h('div', { class: 'modal-body' }, slots.default?.()),
            h(
              'div',
              { class: 'modal-prepend-footer' },
              slots['prepend-footer']?.(),
            ),
          ]);
      },
    });
    return {
      /**
       * 记录导入弹窗声明的回调并返回替身组件与替身实例。
       * @param options 弹窗传给 useVbenModal 的配置。
       * @returns 替身弹窗组件与替身 API 的二元组。
       */
      useVbenModal: (options: (typeof modalProbe)['handlers']) => {
        modalProbe.handlers = options;
        modalProbe.options = options;
        return [ModalStub, modalProbe.api];
      },
    };
  },
);

vi.mock(
  '#/adapter/form',
  /** 只替换表单渲染边界，弹窗声明的表单配置与调用顺序保持真实。 */ async () => {
    const FormStub = defineComponent({
      name: 'FormStub',
      /**
       * 渲染上传字段插槽，使真实上传组件进入组件树。
       * @param _props 表单组件属性，本替身不解释。
       * @param context 组件上下文，用于取用插槽。
       * @param context.slots 调用方传入的插槽表。
       * @returns 渲染文件字段插槽的渲染函数。
       */
      setup(_props, { slots }) {
        return /** 输出可定位的表单节点并暴露文件字段插槽。 */ () =>
          h('div', { class: 'form-stub' }, slots.file?.());
      },
    });
    return {
      /**
       * 记录弹窗声明的表单配置并返回替身组件与替身 API。
       * @param options 弹窗传给 useVbenForm 的配置。
       * @returns 替身表单组件与替身 API 的二元组。
       */
      useVbenForm: (options: Record<string, unknown>) => {
        formProbe.options = options;
        return [FormStub, formProbe.api];
      },
    };
  },
);

vi.mock(
  '#/api/system/user',
  /** 只替换网络边界，弹窗自身的计数、转义与事件顺序保持真实实现。 */ () => ({
    importUser: vi.fn(),
    importUserTemplate: vi.fn(),
  }),
);

vi.mock(
  '@vben/utils',
  /** 只替换浏览器下载动作，其余工具保持真实实现。 */ async (
    importOriginal,
  ) => {
    const actual = await importOriginal<typeof import('@vben/utils')>();
    return { ...actual, downloadFileFromBlobPart: vi.fn() };
  },
);

vi.mock(
  '#/utils/feedback',
  /** 只替换消息提示边界，便于断言成功提示收到的真实文案。 */ () => ({
    showErrorMessage: vi.fn(),
    showSuccessMessage: vi.fn(),
  }),
);

vi.mock(
  'element-plus',
  /** 保留真实上传与按钮组件，只替换导入结果弹窗的展示边界。 */ async (
    importOriginal,
  ) => {
    const actual = await importOriginal<typeof import('element-plus')>();
    return { ...actual, ElMessageBox: { alert: vi.fn() } };
  },
);

vi.mock(
  '#/locales',
  /** 只替换翻译边界，便于核对弹窗请求的语言键。 */ () => ({
    /**
     * 回显语言键，使断言不依赖真实语言包。
     * @param key 组件请求的语言键。
     * @returns 带前缀的译文。
     */
    $t: (key: string) => `译文:${key}`,
  }),
);

vi.mock(
  '../data',
  /** 只替换页面表单定义，弹窗对表单配置的传递保持真实实现。 */ () => ({
    /** 返回最小可识别的导入表单定义，用于核对透传。 */
    useImportFormSchema: () => [
      { component: 'Upload', fieldName: 'file', label: '用户数据' },
      { component: 'Switch', fieldName: 'updateSupport', label: '是否覆盖' },
    ],
  }),
);

/**
 * 取出提交回调。
 * @returns 弹窗提交回调。
 * @throws Error 组件未声明提交回调时抛出，避免用例静默地什么都不验证。
 */
function onConfirmHandler() {
  const handler = modalProbe.handlers.onConfirm;
  if (!handler) {
    throw new Error('弹窗未声明提交回调');
  }
  return handler;
}

/**
 * 挂载导入弹窗并等待首次渲染完成。
 * @returns 已挂载的弹窗包装器。
 */
async function mountModal() {
  const wrapper = mount(ImportForm);
  await wrapper.vm.$nextTick();
  return wrapper;
}

/** 页脚按钮契约：用例只读取按钮渲染出的文案。 */
interface FooterButtonNode {
  /**
   * 读取按钮渲染出的文案。
   * @returns 按钮的文本内容。
   */
  text(): string;
}

/** 上传组件文件变化回调签名：组件只读取其中的原始文件。 */
type UploadChangeHandler = (
  file: { raw?: File; status?: string },
  files: unknown[],
) => void;

/**
 * 取出上传组件的文件变化回调。
 * @param wrapper 已挂载的弹窗包装器。
 * @returns 上传组件的文件变化回调。
 * @throws Error 上传组件未声明回调时抛出，避免用例静默地什么都不验证。
 */
function uploadChangeHandler(wrapper: ReturnType<typeof mount>) {
  const upload = wrapper.findComponent(ElUpload);
  const handler = upload.props('onChange') as undefined | UploadChangeHandler;
  if (!handler) {
    throw new Error('上传组件未声明文件变化回调');
  }
  return handler;
}

/** 导入文件夹具：提交时必须取原始文件而不是上传组件的状态字段。 */
const FILE_FIXTURE = new File(['DUMMY-导入内容'], 'DUMMY-users.xlsx');

beforeEach(
  /** 清空替身调用与数据，避免上一例状态影响断言。 */ () => {
    vi.clearAllMocks();
    modalProbe.handlers = {};
    modalProbe.api.close.mockResolvedValue(undefined);
    modalProbe.api.lock.mockResolvedValue(undefined);
    modalProbe.api.unlock.mockResolvedValue(undefined);
    formProbe.api.validate.mockResolvedValue({ valid: true });
    formProbe.api.getValues.mockResolvedValue({
      file: FILE_FIXTURE,
      updateSupport: true,
    });
    vi.mocked(importUser).mockResolvedValue({
      createUsernames: ['DUMMY-user-a'],
      failureUsernames: {},
      updateUsernames: [],
    });
    vi.mocked(importUserTemplate).mockResolvedValue(new Blob(['x']));
  },
);

describe('导入弹窗装配', /** 表单配置与上传约束决定用户能提交什么样的文件。 */ () => {
  it('把导入表单配置交给表单内核', /** 配置未透传会让弹窗缺少文件字段或覆盖开关。 */ async () => {
    await mountModal();

    expect(formProbe.options).toMatchObject({
      commonConfig: { formItemClass: 'col-span-2', labelWidth: 120 },
      layout: 'horizontal',
      showDefaultActions: false,
    });
    expect(formProbe.options?.schema).toEqual([
      { component: 'Upload', fieldName: 'file', label: '用户数据' },
      { component: 'Switch', fieldName: 'updateSupport', label: '是否覆盖' },
    ]);
  });

  it('弹窗标题与上传约束保持稳定', /** 标题写错会让用户找不到入口，约束放宽会让非 Excel 文件被提交。 */ async () => {
    const wrapper = await mountModal();
    const upload = wrapper.findComponent(ElUpload);

    expect(wrapper.find('.modal-stub').attributes('data-title')).toBe(
      '导入用户',
    );
    expect(upload.props('limit')).toBe(1);
    expect(upload.props('accept')).toBe('.xls,.xlsx');
    expect(upload.props('autoUpload')).toBe(false);
  });
});

describe('导入文件选择', /** 文件选择决定提交的是真实文件还是组件状态字段。 */ () => {
  it('选择文件时只把原始文件写入表单', /** 提交组件状态字段会让后端收到无法解析的对象。 */ async () => {
    const wrapper = await mountModal();

    uploadChangeHandler(wrapper)({ raw: FILE_FIXTURE, status: 'ready' }, []);

    expect(formProbe.api.setFieldValue).toHaveBeenCalledWith(
      'file',
      FILE_FIXTURE,
    );
  });

  it('缺少原始文件时不写入表单', /** 写入无 raw 的条目会让表单出现无效文件。 */ async () => {
    const wrapper = await mountModal();

    uploadChangeHandler(wrapper)({ status: 'ready' }, []);

    expect(formProbe.api.setFieldValue).not.toHaveBeenCalled();
  });
});

describe('导入模板下载', /** 模板下载决定用户能否拿到正确的导入格式。 */ () => {
  it('点击下载模板拉取文件并触发下载', /** 未拉取或未触发下载会让用户拿不到模板。 */ async () => {
    const wrapper = await mountModal();
    const buttons = wrapper
      .find('.modal-prepend-footer')
      .findAllComponents(ElButton);
    const downloadButton = buttons.find(
      /**
       * 只挑出下载模板按钮。
       * @param item 页脚中的按钮包装器。
       * @returns 按钮文案命中下载模板时为 true。
       */
      (item: FooterButtonNode) => item.text().includes('下载导入模板'),
    );
    if (!downloadButton) {
      throw new Error('弹窗未渲染下载模板按钮');
    }

    await downloadButton.trigger('click');
    await wrapper.vm.$nextTick();

    expect(importUserTemplate).toHaveBeenCalledTimes(1);
    const { downloadFileFromBlobPart } = await import('@vben/utils');
    expect(vi.mocked(downloadFileFromBlobPart)).toHaveBeenCalledWith({
      fileName: '用户导入模板.xls',
      source: expect.any(Blob),
    });
  });
});

describe('导入提交', /** 提交链路决定导入请求的参数、提示与弹窗状态。 */ () => {
  it('校验失败时直接返回且不发起导入', /** 空文件请求会让后端写入无效记录。 */ async () => {
    formProbe.api.validate.mockResolvedValue({ valid: false });
    await mountModal();

    await onConfirmHandler()();

    expect(importUser).not.toHaveBeenCalled();
    expect(modalProbe.api.lock).not.toHaveBeenCalled();
  });

  it('校验通过后携带文件与覆盖开关提交', /** 参数写错会让后端收到错误的文件或覆盖策略。 */ async () => {
    await mountModal();

    await onConfirmHandler()();

    expect(modalProbe.api.lock).toHaveBeenCalledTimes(1);
    expect(importUser).toHaveBeenCalledWith(FILE_FIXTURE, true);
    expect(modalProbe.api.close).toHaveBeenCalledTimes(1);
    expect(modalProbe.api.unlock).toHaveBeenCalledTimes(1);
  });

  it('无失败明细时用成功提示展示新增与更新数量', /** 走错提示通道会让用户看不到导入结果。 */ async () => {
    vi.mocked(importUser).mockResolvedValue({
      createUsernames: ['DUMMY-user-a', 'DUMMY-user-b'],
      failureUsernames: {},
      updateUsernames: ['DUMMY-user-c'],
    });
    const wrapper = await mountModal();

    await onConfirmHandler()();

    const { showSuccessMessage } = await import('#/utils/feedback');
    expect(vi.mocked(showSuccessMessage)).toHaveBeenCalledWith(
      '译文:ui.actionMessage.operationSuccess：新增 2 个，更新 1 个',
    );
    expect(wrapper.emitted('success')).toHaveLength(1);
  });

  it('有失败明细时用结果弹窗展示并转义用户名', /** 未转义会让特殊字符破坏结果弹窗结构，走消息提示会截断明细。 */ async () => {
    vi.mocked(importUser).mockResolvedValue({
      createUsernames: ['DUMMY-user-a'],
      failureUsernames: {
        '<b>DUMMY-bad</b>': 'reason & <script>',
      },
      updateUsernames: ['DUMMY-user-b', 'DUMMY-user-c'],
    });
    await mountModal();

    await onConfirmHandler()();

    const { ElMessageBox } = await import('element-plus');
    const alert = vi.mocked(ElMessageBox.alert);
    expect(alert).toHaveBeenCalledTimes(1);
    const [content, title, options] = alert.mock.calls[0] ?? [];
    expect(title).toBe('导入结果');
    expect(options).toMatchObject({
      confirmButtonText: '确定',
      dangerouslyUseHTMLString: true,
      type: 'warning',
    });
    expect(String(content)).toContain('新增 1 个，更新 2 个，失败 1 个');
    expect(String(content)).toContain(
      '&lt;b&gt;DUMMY-bad&lt;/b&gt;：reason &amp; &lt;script&gt;',
    );
    const { showSuccessMessage } = await import('#/utils/feedback');
    expect(vi.mocked(showSuccessMessage)).not.toHaveBeenCalled();
  });

  it('导入失败时仍然解锁弹窗并保留原异常', /** 未解锁会让弹窗永久停在加载态，吞掉异常会让用户不知道导入失败。 */ async () => {
    vi.mocked(importUser).mockRejectedValue(new Error('DUMMY-导入失败'));
    await mountModal();

    await expect(onConfirmHandler()()).rejects.toThrow('DUMMY-导入失败');

    expect(modalProbe.api.unlock).toHaveBeenCalledTimes(1);
    expect(modalProbe.api.close).not.toHaveBeenCalled();
  });
});
