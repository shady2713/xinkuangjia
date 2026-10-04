/**
 * 文件上传弹窗（views/infra/file/modules/form）真实行为回归。
 *
 * 该弹窗负责选择本地文件、阻止自动上传、并在确认时把文件交给上传接口后回传访问地址：
 * 校验失败仍发起上传会产生空文件请求；确认期间不加锁会让用户重复提交；上传失败不释放
 * 弹窗锁会让弹窗永久停在加载态；失败时误报成功或误派发 success 会让列表刷新出并不存在
 * 的文件；上传前回调返回 true 会让 Element Plus 自行上传绕过业务封装；超出数量限制不提示
 * 会让用户以为选择生效。用例真实渲染弹窗内容，只替换弹窗容器、表单渲染、上传接口、
 * 消息提示、翻译与 Element Plus 上传组件。
 */
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import FileForm from './form.vue';

/** 上传接口替身；模块替身与用例读取同一实例。 */
const uploadProbe = vi.hoisted(
  /** 建立用例可设置返回值、可断言的单个上传调用替身。 */ () => ({
    httpRequest: vi.fn(),
  }),
);

/** 弹窗替身记录的回调与调用实例；模块替身与用例读取同一实例。 */
const modalProbe = vi.hoisted(
  /** 建立用例可设置数据、可断言的弹窗替身容器。 */ () => ({
    api: {
      close: vi.fn(),
      lock: vi.fn(),
      unlock: vi.fn(),
    },
    handlers: {} as {
      /** 提交回调，由弹窗组件在确认时声明。 */
      onConfirm?: () => Promise<void>;
    },
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
  /** 只替换弹窗容器，上传弹窗自身的确认、加锁与字段写入逻辑保持真实实现。 */ async () => {
    const { defineComponent, h } = await import('vue');
    const ModalStub = defineComponent({
      name: 'ModalStub',
      props: {
        /** 弹窗标题，用于核对页面声明的文案。 */
        title: { default: '', type: String },
      },
      /**
       * 渲染标题与默认插槽内容，使上传区域进入真实组件树。
       * @param props 弹窗容器声明的属性。
       * @param context 组件上下文，用于取用默认插槽。
       * @param context.slots 调用方传入的插槽表。
       * @returns 渲染标题与默认插槽的渲染函数。
       */
      setup(props, { slots }) {
        return /** 输出可定位的弹窗节点并暴露真实内容。 */ () =>
          h('div', { class: 'modal-stub', 'data-title': props.title }, [
            h('div', { class: 'modal-title' }, props.title),
            slots.default?.(),
          ]);
      },
    });
    return {
      /**
       * 记录上传弹窗声明的回调并返回替身组件与替身实例。
       * @param options 弹窗传给 useVbenModal 的配置。
       * @returns 替身弹窗组件与替身 API 的二元组。
       */
      useVbenModal: (options: (typeof modalProbe)['handlers']) => {
        modalProbe.handlers = options;
        return [ModalStub, modalProbe.api];
      },
    };
  },
);

vi.mock(
  '#/adapter/form',
  /** 只替换表单渲染边界，弹窗声明的表单配置与调用顺序保持真实实现。 */ async () => {
    const { defineComponent, h } = await import('vue');
    const FormStub = defineComponent({
      name: 'FormStub',
      /**
       * 渲染上传字段插槽，使上传组件进入真实组件树。
       * @param _props 未声明的表单属性，本替身不解释。
       * @param context 组件上下文，用于取用插槽。
       * @param context.slots 调用方传入的插槽表。
       * @returns 渲染 file 插槽的渲染函数。
       */
      setup(_props, { slots }) {
        return /** 输出可定位的表单节点并暴露上传字段插槽。 */ () =>
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
  '#/components/upload/use-upload',
  /** 只替换上传接口边界，弹窗自身的调用时机与锁状态保持真实实现。 */ () => ({
    /** 返回只暴露 httpRequest 的上传能力替身。 */
    useUpload: () => ({ httpRequest: uploadProbe.httpRequest }),
  }),
);

vi.mock(
  'element-plus',
  /** 只替换上传组件的渲染，页面声明的上传属性保持真实取值。 */ async () => {
    const { defineComponent, h } = await import('vue');
    const UploadStub = defineComponent({
      name: 'UploadStub',
      props: {
        /** 可选文件类型，决定文件选择框的过滤条件。 */
        accept: { default: '', type: String },
        /** 是否自动上传；本弹窗必须为 false。 */
        autoUpload: { default: true, type: Boolean },
        /** 上传前回调，返回 false 时阻止上传。 */
        beforeUpload: { default: undefined, type: Function },
        /** 是否启用拖拽上传。 */
        drag: { default: false, type: Boolean },
        /** 文件数量上限。 */
        limit: { default: 0, type: Number },
        /** 文件变化回调，负责把原始文件写入表单。 */
        onChange: { default: undefined, type: Function },
        /** 超出数量限制回调。 */
        onExceed: { default: undefined, type: Function },
      },
      /**
       * 渲染可断言的属性与默认插槽内容。
       * @param props 上传组件声明的属性。
       * @param context 组件上下文，用于取用默认插槽。
       * @param context.slots 调用方传入的插槽表。
       * @returns 带契约属性的上传组件渲染函数。
       */
      setup(props, { slots }) {
        return /** 输出带契约属性的上传节点并暴露真实提示内容。 */ () =>
          h(
            'div',
            {
              class: 'upload-stub',
              'data-accept': props.accept,
              'data-auto-upload': String(props.autoUpload),
              'data-drag': String(props.drag),
              'data-limit': String(props.limit),
            },
            slots.default?.(),
          );
      },
    });
    return { ElUpload: UploadStub };
  },
);

vi.mock(
  '#/locales',
  /** 只替换翻译边界，便于核对页面请求的语言键。 */ () => ({
    /**
     * 把语言键回显成可预期的译文。
     * @param key 组件请求的语言键。
     * @returns 带前缀的译文。
     */
    $t: (key: string) => `译文:${key}`,
  }),
);

vi.mock(
  '#/utils/feedback',
  /** 只替换消息提示边界，便于断言成功与警告提示收到的真实文案。 */ () => ({
    showSuccessMessage: vi.fn(),
    showWarningMessage: vi.fn(),
  }),
);

/** 上传组件契约属性：页面必须阻止自动上传并限制为单文件。 */
interface UploadProps {
  /** 可选文件类型。 */
  accept: string;
  /** 是否自动上传。 */
  autoUpload: boolean;
  /** 上传前回调。 */
  beforeUpload: (rawFile: File) => boolean;
  /** 是否拖拽上传。 */
  drag: boolean;
  /** 文件数量上限。 */
  limit: number;
  /** 文件变化回调。 */
  onChange: (file: { raw?: File }) => void;
  /** 超出数量限制回调。 */
  onExceed: () => void;
}

/**
 * 取出页面传给上传组件的属性。
 * @param wrapper 已挂载的弹窗包装器。
 * @returns 上传组件的属性集合。
 * @throws Error 页面未渲染上传组件时抛出，避免用例静默地什么都不验证。
 */
function uploadProps(wrapper: ReturnType<typeof mount>): UploadProps {
  const upload = wrapper.findComponent({ name: 'UploadStub' });
  if (!upload.exists()) {
    throw new Error('页面未渲染上传组件');
  }
  return upload.props() as UploadProps;
}

/**
 * 取出弹窗声明的确认回调。
 * @returns 弹窗确认回调。
 * @throws Error 页面未声明确认回调时抛出，避免用例静默地什么都不验证。
 */
function confirmHandler() {
  const handler = modalProbe.handlers.onConfirm;
  if (!handler) {
    throw new Error('弹窗未声明确认回调');
  }
  return handler;
}

/**
 * 取出弹窗声明的表单配置。
 * @returns 表单配置对象。
 * @throws Error 页面未声明表单配置时抛出，避免用例静默地什么都不验证。
 */
function formOptions() {
  const options = formProbe.options;
  if (!options) {
    throw new Error('页面未声明表单配置');
  }
  return options;
}

/**
 * 取出替身最近一次调用的全局序号，用于核对真实执行顺序。
 * @param mock 记录调用的替身。
 * @returns 该替身的调用序号。
 * @throws TypeError 替身尚未被调用时抛出，避免顺序断言失去意义。
 */
function requireCallOrder(mock: ReturnType<typeof vi.fn>) {
  const order = mock.mock.invocationCallOrder[0];
  if (order === undefined) {
    throw new TypeError('替身尚未被调用，无法比较执行顺序');
  }
  return order;
}

/**
 * 建立上传文件夹具。
 * @returns 上传接口收到的文件对象。
 */
function createFile() {
  return new File(['DUMMY-content'], 'DUMMY-image.png', { type: 'image/png' });
}

beforeEach(
  /** 清空替身调用并恢复默认返回值，避免上一例状态影响断言。 */ () => {
    vi.clearAllMocks();
    uploadProbe.httpRequest.mockResolvedValue('https://example.test/DUMMY.png');
    modalProbe.api.close.mockResolvedValue(undefined);
    formProbe.api.getValues.mockResolvedValue({ file: createFile() });
    formProbe.api.validate.mockResolvedValue({ valid: true });
  },
);

describe('上传弹窗表单配置', /** 表单配置决定上传区展示方式与字段标签。 */ () => {
  it('声明横向布局并隐藏默认动作', /** 显示默认动作会与弹窗自己的确认按钮重复。 */ () => {
    mount(FileForm);

    expect(formOptions()).toMatchObject({
      layout: 'horizontal',
      showDefaultActions: false,
    });
    expect(formOptions().commonConfig).toEqual({
      componentProps: { class: 'w-full' },
      formItemClass: 'col-span-2',
      hideLabel: true,
      labelWidth: 80,
    });
  });

  it('清空上传字段的标签', /** 上传区自带说明文案，再显示字段标签会重复。 */ () => {
    mount(FileForm);
    const schema = formOptions().schema as Array<Record<string, unknown>>;

    expect(schema).toHaveLength(1);
    expect(schema[0]).toMatchObject({ component: 'Upload', fieldName: 'file' });
    expect(schema[0]?.label).toBe('');
  });
});

describe('上传区域渲染', /** 上传区属性决定文件选择范围与是否绕过业务上传封装。 */ () => {
  it('禁止自动上传并限制单文件与图片类型', /** 允许自动上传会绕过弹窗的确认与提示流程。 */ () => {
    const wrapper = mount(FileForm);
    const props = uploadProps(wrapper);

    expect(props.autoUpload).toBe(false);
    expect(props.limit).toBe(1);
    expect(props.drag).toBe(true);
    expect(props.accept).toBe('.jpg,.png,.gif,.webp');
    expect(wrapper.find('.modal-title').text()).toBe('上传图片');
  });

  it('渲染格式与数量提示文案', /** 缺少提示会让用户不知道支持哪些格式。 */ () => {
    const wrapper = mount(FileForm);

    expect(wrapper.text()).toContain('点击或拖拽文件到此区域上传');
    expect(wrapper.text()).toContain(
      '支持 .jpg、.png、.gif、.webp 格式图片文件',
    );
  });

  it('上传前回调始终返回 false 阻止自动上传', /** 返回 true 会让 Element Plus 自行发起未加锁的上传。 */ () => {
    const wrapper = mount(FileForm);

    expect(uploadProps(wrapper).beforeUpload(createFile())).toBe(false);
  });
});

describe('文件变化与超限处理', /** 文件写入与超限提示决定用户选择是否真正生效。 */ () => {
  it('选择文件后把原始文件写入表单字段', /** 不写字段会让确认时提交不到文件。 */ async () => {
    const wrapper = mount(FileForm);
    const file = createFile();

    uploadProps(wrapper).onChange({ raw: file });
    await nextTick();

    expect(formProbe.api.setFieldValue).toHaveBeenCalledWith('file', file);
  });

  it('没有原始文件时不写入字段值', /** 写入空值会覆盖上一次选择的文件。 */ async () => {
    const wrapper = mount(FileForm);

    uploadProps(wrapper).onChange({});
    await nextTick();

    expect(formProbe.api.setFieldValue).not.toHaveBeenCalled();
  });

  it('超出数量限制时给出中文提示', /** 无提示会让用户以为第二个文件已被接受。 */ async () => {
    const wrapper = mount(FileForm);
    const { showWarningMessage } = await import('#/utils/feedback');

    uploadProps(wrapper).onExceed();
    await nextTick();

    expect(showWarningMessage).toHaveBeenCalledWith('最多只能上传一个文件');
  });
});

describe('弹窗确认提交', /** 确认链路决定空提交、重复提交与失败后的状态。 */ () => {
  it('校验失败时直接返回且不发起上传', /** 空文件请求会让后端写入无效记录。 */ async () => {
    formProbe.api.validate.mockResolvedValue({ valid: false });
    mount(FileForm);

    await confirmHandler()();

    expect(modalProbe.api.lock).not.toHaveBeenCalled();
    expect(formProbe.api.getValues).not.toHaveBeenCalled();
    expect(uploadProbe.httpRequest).not.toHaveBeenCalled();
    expect(modalProbe.api.close).not.toHaveBeenCalled();
  });

  it('校验通过后加锁、上传、关闭并派发成功事件', /** 顺序错乱会让弹窗在上传完成前关闭或漏发刷新事件。 */ async () => {
    const wrapper = mount(FileForm);
    const file = createFile();
    formProbe.api.getValues.mockResolvedValue({ file });
    const { showSuccessMessage } = await import('#/utils/feedback');

    await confirmHandler()();
    await nextTick();

    expect(modalProbe.api.lock).toHaveBeenCalledTimes(1);
    expect(uploadProbe.httpRequest).toHaveBeenCalledWith(file);
    expect(modalProbe.api.close).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('success')).toHaveLength(1);
    expect(showSuccessMessage).toHaveBeenCalledWith(
      '译文:ui.actionMessage.operationSuccess',
    );
    expect(modalProbe.api.unlock).toHaveBeenCalledTimes(1);
    const lockOrder = requireCallOrder(modalProbe.api.lock);
    const uploadOrder = requireCallOrder(uploadProbe.httpRequest);
    const closeOrder = requireCallOrder(modalProbe.api.close);
    const unlockOrder = requireCallOrder(modalProbe.api.unlock);
    expect(lockOrder).toBeLessThan(uploadOrder);
    expect(uploadOrder).toBeLessThan(closeOrder);
    expect(closeOrder).toBeLessThan(unlockOrder);
  });

  it('上传失败时释放弹窗锁且不关闭、不派发成功事件', /** 不释放锁会让弹窗永久停在加载态，误派发会让列表出现不存在的文件。 */ async () => {
    const wrapper = mount(FileForm);
    uploadProbe.httpRequest.mockRejectedValue(new Error('上传失败'));

    await expect(confirmHandler()()).rejects.toThrow('上传失败');
    await nextTick();

    expect(modalProbe.api.unlock).toHaveBeenCalledTimes(1);
    expect(modalProbe.api.close).not.toHaveBeenCalled();
    expect(wrapper.emitted('success')).toBeUndefined();
  });
});
