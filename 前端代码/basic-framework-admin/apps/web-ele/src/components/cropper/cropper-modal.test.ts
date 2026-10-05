/**
 * 图片裁剪弹窗（components/cropper/cropper-modal.vue）真实行为回归。
 *
 * 该弹窗是头像裁剪的容器：打开时加载、裁剪器就绪后关闭加载；选择图片先做大小校验再读取为
 * 地址；工具栏按钮把旋转、翻转与缩放转发给 cropperjs；确认时把预览结果转成二进制交给
 * uploadApi，并保证无论成功或失败都结束加载态。用例真实挂载弹窗与真实裁剪器组件，只替换
 * 弹窗容器、元素库展示组件、cropperjs、canvas 导出与 FileReader 这几个外部边界。
 */
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CropperModal from './cropper-modal.vue';

/** cropperjs 实例替身与最近一次构造参数；模块替身与用例读取同一实例。 */
const cropperProbe = vi.hoisted(
  /** 建立可设置画布、可断言的 cropperjs 替身容器。 */ () => ({
    instances: [] as Record<string, ReturnType<typeof vi.fn>>[],
    options: undefined as Record<string, unknown> | undefined,
    /** 裁剪结果画布替身，由用例在断言前替换。 */
    sourceCanvas: undefined as unknown,
  }),
);

/** 弹窗替身记录的配置与调用实例；模块替身与用例读取同一实例。 */
const modalProbe = vi.hoisted(
  /** 建立可设置返回值、可断言的链式弹窗替身容器。 */ () => ({
    api: {
      close: vi.fn(),
      setState: vi.fn(),
    },
    options: undefined as Record<string, unknown> | undefined,
  }),
);

/** 警告提示替身；确认前缺少预览结果时必须给出提示。 */
const feedbackProbe = vi.hoisted(
  /** 建立可断言的警告提示实例。 */ () => ({ showWarningMessage: vi.fn() }),
);

/** 上传组件替身收到的属性；用例按此驱动真实的选择图片回调。 */
const uploadProbe = vi.hoisted(
  /** 建立可读取属性的上传组件替身容器。 */ () => ({
    props: undefined as Record<string, unknown> | undefined,
  }),
);

/** canvas 导出替身持有的图片二进制；圆形裁剪只在浏览器支持 canvas 时才可导出。 */
const canvasProbe = vi.hoisted(
  /** 建立可设置导出结果的 canvas 替身容器。 */ () => ({
    blob: null as Blob | null,
  }),
);

vi.mock(
  'cropperjs',
  /** 只替换依赖真实 DOM 与 canvas 的第三方裁剪实现，弹窗与裁剪器组件的编排保持真实实现。 */ () => ({
    default: class CropperStub {
      /** 记录实例是否被释放。 */
      destroy = vi.fn();
      /** 返回用例提供的裁剪结果画布。 */
      getCroppedCanvas = vi.fn(
        /** 读取用例在断言前设置的画布替身。 */ () => cropperProbe.sourceCanvas,
      );
      /** 返回固定的裁剪坐标。 */
      getData = vi.fn(
        /** 给出一次裁剪的坐标与尺寸。 */ () => ({
          height: 300,
          rotate: 0,
          scaleX: 1,
          scaleY: 1,
          width: 300,
          x: 10,
          y: 20,
        }),
      );
      /** 记录重置调用。 */
      reset = vi.fn();
      /** 记录旋转角度，工具栏左右旋转按 ±45 度转发。 */
      rotate = vi.fn();
      /** 记录水平翻转比例。 */
      scaleX = vi.fn();
      /** 记录垂直翻转比例。 */
      scaleY = vi.fn();
      /** 记录缩放比例。 */
      zoom = vi.fn();
      /**
       * 记录构造参数并登记实例。
       * @param _element 裁剪器组件传入的图片元素，替身不解释。
       * @param options 裁剪器组件合并后的 cropperjs 配置。
       */
      constructor(
        _element: HTMLImageElement,
        options: Record<string, unknown>,
      ) {
        cropperProbe.options = options;
        cropperProbe.instances.push(
          this as unknown as Record<string, ReturnType<typeof vi.fn>>,
        );
      }
    },
  }),
);

/** 读取完成事件的载荷视图；弹窗只读取 target.result。 */
interface ReadEvent {
  /** 事件目标，读取失败或未设置结果时为 null。 */
  target: null | { result: ArrayBuffer | null | string };
}

/** 读取完成回调签名。 */
type ReadCallback = (event: ReadEvent) => void;

/** 读取失败回调签名。 */
type ReadErrorHandler = () => void;

/** 弹窗确认回调签名。 */
type ConfirmHandler = () => unknown;

/** 裁剪结果读取器替身：读取结果与成功/失败时机都由用例控制。 */
class FileReaderStub {
  /** 本次测试期间创建的读取器，按创建顺序登记。 */
  static instances: FileReaderStub[] = [];

  /** 记录被读取的图片二进制。 */
  blob: Blob | undefined;

  /** 读取完成监听；弹窗通过 addEventListener 注册 load。 */
  loadListeners: ReadCallback[] = [];

  /** 读取失败回调；裁剪器组件通过 onerror 注册。 */
  onerror: null | ReadErrorHandler = null;

  /** 编码结束回调；裁剪器组件通过 onloadend 注册。 */
  onloadend: null | ReadCallback = null;

  /** 建立读取器替身并登记实例。 */ constructor() {
    FileReaderStub.instances.push(this);
  }

  /**
   * 注册读取事件监听，复刻浏览器的事件注册入口。
   * @param type 事件类型，弹窗只监听 load。
   * @param listener 事件处理函数。
   */
  addEventListener(
    type: string,
    listener: /** 注册读取完成监听。 */ (event: ReadEvent) => void,
  ) {
    if (type === 'load') {
      this.loadListeners.push(listener);
    }
  }

  /**
   * 触发读取完成，按浏览器时机派发 load 与 onloadend 两套注册方式。
   * @param result 读取结果；传 null 表示空结果。
   */
  finishRead(result: ArrayBuffer | null | string) {
    const event: ReadEvent = { target: { result } };
    for (const listener of this.loadListeners) {
      listener(event);
    }
    this.onloadend?.(event);
  }

  /**
   * 记录被读取的图片二进制，不执行真实编码。
   * @param blob 弹窗交给读取器的图片文件。
   */
  readAsDataURL(blob: Blob) {
    this.blob = blob;
  }
}

/**
 * 触发最近一次创建的读取器完成读取。
 * @param result 读取结果；传 null 表示空结果。
 * @throws Error 组件未创建读取器时抛出，避免用例静默地什么都不验证。
 */
function finishRead(result: ArrayBuffer | null | string) {
  const reader = FileReaderStub.instances.at(-1);
  if (!reader) {
    throw new Error('组件未创建图片读取器');
  }
  reader.finishRead(result);
}

vi.mock(
  '@vben/common-ui',
  /** 只替换弹窗容器与注册机制，弹窗自身的校验、转发与上传编排保持真实实现。 */ () => {
    const ModalStub = defineComponent({
      name: 'ModalStub',
      props: {
        /** 确认按钮文案，由弹窗传入语言键。 */
        confirmText: { default: '', type: String },
        /** 是否显示全屏按钮，裁剪弹窗要求隐藏。 */
        fullscreenButton: { default: true, type: Boolean },
        /** 弹窗标题语言键。 */
        title: { default: '', type: String },
      },
      /**
       * 渲染弹窗主体插槽与确认入口，并透出标题与确认文案供断言。
       * @param props 弹窗容器替身声明的属性。
       * @param context 组件上下文，用于取用插槽。
       * @param context.slots 弹窗主体插槽表。
       * @returns 弹窗容器替身渲染函数。
       */
      setup(props, { slots }) {
        return /** 渲染弹窗主体与确认按钮。 */ () =>
          h(
            'div',
            {
              class: 'modal-stub',
              'data-confirm-text': props.confirmText,
              'data-fullscreen': String(props.fullscreenButton),
              'data-title': props.title,
            },
            [
              h('div', { class: 'modal-body' }, slots.default?.()),
              h(
                'button',
                {
                  class: 'modal-confirm',
                  // 真实弹窗点击确认后执行 onConfirm，这里复刻同一契约。
                  /** 触发弹窗确认。 */
                  onClick: () => confirmHandler?.(),
                },
                '确认',
              ),
            ],
          );
      },
    });
    /** 弹窗确认回调，由配置登记后供替身按钮调用。 */
    let confirmHandler: ConfirmHandler | undefined;
    return {
      /**
       * 记录弹窗声明的配置并返回替身组件与替身实例。
       * @param options 弹窗组件传给 useVbenModal 的配置。
       * @returns 替身弹窗组件与替身 API 的二元组。
       */
      useVbenModal: (options: Record<string, unknown>) => {
        modalProbe.options = options;
        confirmHandler = options.onConfirm as ConfirmHandler | undefined;
        return [ModalStub, modalProbe.api];
      },
    };
  },
);

vi.mock(
  '@vben/locales',
  /** 只替换翻译边界，断言读取的语言键而不是绑定具体译文。 */ () => ({
    /**
     * 回显语言键，便于核对组件请求的文案键。
     * @param key 组件请求的语言键。
     * @returns 语言键本身。
     */
    $t: (key: string) => key,
  }),
);

vi.mock(
  '#/utils/feedback',
  /** 只替换提示展示边界，弹窗自身的判断时机保持真实实现。 */ () => ({
    showWarningMessage: feedbackProbe.showWarningMessage,
  }),
);

vi.mock(
  'element-plus',
  /** 只替换元素库展示组件与上传容器，弹窗自身的参数拼装保持真实实现。 */ () => ({
    ElAvatar: defineComponent({
      name: 'ElAvatarStub',
      props: {
        /** 头像尺寸，弹窗按四档尺寸预览同一张裁剪结果。 */
        size: { default: 'default', type: [Number, String] },
        /** 头像地址，应为裁剪结果。 */
        src: { default: '', type: String },
      },
      /**
       * 渲染带尺寸标记的头像占位节点。
       * @param props 头像替身声明的属性。
       * @returns 头像替身渲染函数。
       */
      setup(props) {
        return /** 渲染头像占位节点。 */ () =>
          h('span', { class: 'el-avatar', 'data-size': String(props.size) });
      },
    }),
    ElButton: defineComponent({
      name: 'ElButtonStub',
      /** 是否禁用；未选择图片时工具栏必须禁用。 */
      props: { disabled: { default: false, type: Boolean } },
      /**
       * 渲染按钮节点并透出禁用态与图标插槽。
       * @param props 按钮替身声明的属性。
       * @param context 组件上下文，用于取用插槽。
       * @param context.slots 按钮传入的插槽表。
       * @returns 按钮替身渲染函数。
       */
      setup(props, { slots }) {
        return /** 渲染按钮节点与图标插槽。 */ () =>
          h(
            'button',
            {
              class: 'el-button-stub',
              'data-disabled': String(props.disabled),
            },
            slots.icon?.(),
          );
      },
    }),
    ElSpace: defineComponent({
      name: 'ElSpaceStub',
      /**
       * 渲染工具栏间距容器。
       * @param _props 间距属性，替身不解释。
       * @param context 组件上下文，用于取用插槽。
       * @param context.slots 容器插槽表。
       * @returns 间距容器渲染函数。
       */
      setup(_props, { slots }) {
        return /** 渲染间距容器与工具栏按钮。 */ () =>
          h('div', { class: 'el-space-stub' }, slots.default?.());
      },
    }),
    ElTooltip: defineComponent({
      name: 'ElTooltipStub',
      /** 提示文案语言键，用例按此定位对应工具栏按钮。 */
      props: { content: { default: '', type: String } },
      /**
       * 渲染带文案标记的提示容器。
       * @param props 提示替身声明的属性。
       * @param context 组件上下文，用于取用插槽。
       * @param context.slots 容器插槽表。
       * @returns 提示容器渲染函数。
       */
      setup(props, { slots }) {
        return /** 渲染提示容器与目标按钮。 */ () =>
          h(
            'div',
            { class: 'el-tooltip-stub', 'data-content': props.content },
            slots.default?.(),
          );
      },
    }),
    ElUpload: defineComponent({
      name: 'ElUploadStub',
      props: {
        /** 上传前的校验回调，弹窗在此做大小校验与读取。 */
        beforeUpload: { default: undefined, type: Function },
        /** 已选文件列表，弹窗固定传空数组由自身管理状态。 */
        fileList: {
          /** 空文件列表默认值。 */
          default: () => [],
          type: Array,
        },
      },
      /**
       * 记录上传配置并渲染选择图片入口。
       * @param props 上传替身声明的属性。
       * @param context 组件上下文，用于取用插槽。
       * @param context.slots 上传入口插槽表。
       * @returns 上传容器替身渲染函数。
       */
      setup(props, { slots }) {
        uploadProbe.props = props;
        return /** 渲染上传入口按钮。 */ () =>
          h('div', { class: 'el-upload-stub' }, slots.default?.());
      },
    }),
  }),
);

/** 弹窗替身配置视图：用例按真实契约驱动打开状态变化与确认。 */
interface ModalOptions {
  /**
   * 打开状态变化回调。
   * @param isOpen 弹窗是否已打开。
   */
  onOpenChange?: (isOpen: boolean) => void;
  /** 确认回调，等价于点击弹窗确认按钮。 */
  onConfirm?: () => unknown;
}

/**
 * 取出弹窗声明的配置。
 * @returns 弹窗组件传给弹窗容器的配置。
 * @throws Error 组件未声明弹窗配置时抛出，避免用例静默地什么都不验证。
 */
function modalOptions(): ModalOptions {
  const options = modalProbe.options;
  if (!options) {
    throw new Error('组件未声明弹窗配置');
  }
  return options as ModalOptions;
}

/**
 * 取出裁剪器组件登记到 cropperjs 的回调。
 * @param name 回调名，如 ready。
 * @returns 对应回调函数。
 * @throws Error 组件未登记该回调时抛出，避免用例静默地什么都不验证。
 */
function cropperCallback(name: string) {
  const callback = cropperProbe.options?.[name];
  if (typeof callback !== 'function') {
    throw new TypeError(`裁剪器组件未登记回调：${name}`);
  }
  return callback as /** 把回调还原为调用方声明的签名。 */ () => void;
}

/**
 * 设置本次裁剪使用的画布替身与导出结果。
 * @param blob 导出时回调收到的图片二进制；传 null 表示导出为空结果。
 */
function setSourceCanvas(blob: Blob | null) {
  canvasProbe.blob = blob;
  // 圆形裁剪会先读取裁剪结果画布的尺寸，再合成遮罩。
  cropperProbe.sourceCanvas = { height: 200, width: 200 } as unknown;
}

/**
 * 取出上传组件收到的选择图片回调。
 * @returns 弹窗声明的上传前校验回调。
 * @throws Error 弹窗未声明上传回调时抛出，避免用例静默地什么都不验证。
 */
function beforeUploadCallback() {
  const callback = uploadProbe.props?.beforeUpload;
  if (typeof callback !== 'function') {
    throw new TypeError('弹窗未声明上传前校验回调');
  }
  return callback as /** 把回调还原为调用方声明的签名。 */ (
    file: File,
  ) => boolean;
}

/**
 * 挂载裁剪弹窗并等待首次渲染完成。
 * @param options 挂载选项，用于传入属性。
 * @returns 已挂载的弹窗包装器。
 */
async function mountModal(options: Parameters<typeof mount>[1] = {}) {
  const wrapper = mount(CropperModal, options);
  await wrapper.vm.$nextTick();
  return wrapper;
}

/**
 * 驱动弹窗走完一次真实裁剪：选择图片、裁剪器就绪、裁剪结果编码为预览。
 * @param wrapper 已挂载的弹窗包装器。
 * @param fileName 选择的图片文件名，用于核对上传时沿用的原始名称。
 * @returns 预览生成后的 Promise。
 */
async function preparePreview(
  wrapper: ReturnType<typeof mount>,
  fileName = 'DUMMY-avatar.png',
) {
  beforeUploadCallback()({ name: fileName, size: 1024 } as unknown as File);
  finishRead('data:image/png;base64,ZHVtbXktZmlsZQ==');
  await wrapper.vm.$nextTick();

  // 裁剪器就绪会顺带发布首帧预览，这是弹窗获得预览结果的真实入口。
  setSourceCanvas(new Blob(['DUMMY-image']));
  cropperCallback('ready')();
  finishRead('data:image/png;base64,ZHVtbXktcHJldmlldw==');
  await wrapper.vm.$nextTick();
}

/**
 * 取出弹窗收到的最近一次加载态设置。
 * @returns 最近一次 setState 入参，未调用时返回 undefined。
 */
function lastLoadingState() {
  return modalProbe.api.setState.mock.calls.at(-1)?.[0] as
    | undefined
    | { confirmLoading?: boolean; loading?: boolean };
}

/**
 * 按提示文案取出工具栏按钮。
 * @param wrapper 已挂载的弹窗包装器。
 * @param content 工具栏按钮的提示文案语言键。
 * @returns 命中的按钮包装器。
 * @throws Error 找不到该工具栏按钮时抛出，避免用例静默地什么都不验证。
 */
function toolbarButton(wrapper: ReturnType<typeof mount>, content: string) {
  const button = wrapper.find(`[data-content="${content}"] button`);
  if (!button.exists()) {
    throw new Error(`弹窗未渲染工具栏按钮：${content}`);
  }
  return button;
}

beforeEach(
  /** 清空替身状态并登记默认返回，避免上一例影响断言。 */ () => {
    vi.clearAllMocks();
    cropperProbe.instances = [];
    cropperProbe.options = undefined;
    FileReaderStub.instances = [];
    uploadProbe.props = undefined;
    modalProbe.api.close.mockResolvedValue(undefined);
    canvasProbe.blob = null;
    vi.stubGlobal('FileReader', FileReaderStub);
    // 弹窗默认按圆形裁剪，happy-dom 不提供 2D 上下文与导出实现，这里只替换 canvas 边界。
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      /** 返回记录绘制的 2D 上下文替身。 */ () =>
        createContextStub() as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
      /**
       * 立即按用例给定的结果回调，复刻浏览器导出完成时机。
       * @param callback 组件传入的导出完成回调。
       */
      (callback: BlobCallback) => callback(canvasProbe.blob),
    );
  },
);

afterEach(
  /** 还原全局替身与 canvas 打桩，避免影响其他测试文件。 */ () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  },
);

/**
 * 生成记录绘制调用的 2D 上下文替身。
 * @returns 覆盖组件实际调用的属性与方法的上下文替身。
 */
function createContextStub() {
  return {
    arc: vi.fn(),
    beginPath: vi.fn(),
    drawImage: vi.fn(),
    fill: vi.fn(),
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: false,
  };
}

describe('弹窗注册与开关契约', /** 注册配置与加载态决定用户能否看到裁剪界面并知道正在处理。 */ () => {
  it('把标题、确认文案与连接回调交给弹窗容器', /** 配置漏传会让弹窗缺少标题或确认入口无效。 */ async () => {
    const wrapper = await mountModal({});

    expect(wrapper.find('.modal-stub').attributes('data-title')).toBe(
      'ui.cropper.modalTitle',
    );
    expect(wrapper.find('.modal-stub').attributes('data-confirm-text')).toBe(
      'ui.cropper.okText',
    );
    expect(wrapper.find('.modal-stub').attributes('data-fullscreen')).toBe(
      'false',
    );
    expect(typeof modalOptions().onConfirm).toBe('function');
    expect(typeof modalOptions().onOpenChange).toBe('function');
  });

  it('打开时进入加载态', /** 裁剪器就绪前不显示加载会让用户以为弹窗卡死。 */ async () => {
    await mountModal({});

    modalOptions().onOpenChange?.(true);

    expect(modalProbe.api.setState).toHaveBeenCalledWith({
      confirmLoading: true,
      loading: true,
    });
  });

  it('关闭时清空右侧预览并结束加载态', /** 预览残留会让下次打开看到上一次的裁剪结果。 */ async () => {
    const wrapper = await mountModal({});
    await preparePreview(wrapper);
    expect(wrapper.find('[alt="ui.cropper.preview"]').exists()).toBe(true);

    modalOptions().onOpenChange?.(false);
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[alt="ui.cropper.preview"]').exists()).toBe(false);
    expect(lastLoadingState()).toEqual({
      confirmLoading: false,
      loading: false,
    });
  });
});

describe('选择图片契约', /** 选择图片的校验与读取决定用户能否把本地图片送进裁剪器。 */ () => {
  it('超过大小上限时拒绝并提示', /** 不拦截会让超大图片拖垮浏览器或上传失败。 */ async () => {
    const wrapper = await mountModal({ props: { size: 1 } });

    const accepted = beforeUploadCallback()({
      name: 'DUMMY-big.png',
      size: 2 * 1024 * 1024,
    } as unknown as File);

    expect(accepted).toBe(false);
    expect(FileReaderStub.instances).toHaveLength(0);
    expect(wrapper.emitted('uploadError')?.[0]?.[0]).toEqual({
      msg: 'ui.cropper.imageTooBig',
    });
  });

  it('大小上限为 0 时不限制文件体积', /** 关闭限制后仍拦截会让调用方无法上传大图。 */ async () => {
    await mountModal({ props: { size: 0 } });

    beforeUploadCallback()({
      name: 'DUMMY-big.png',
      size: 20 * 1024 * 1024,
    } as unknown as File);

    expect(FileReaderStub.instances).toHaveLength(1);
  });

  it('接受文件后读取为地址并交给裁剪器', /** 未读取或未清空旧状态会让裁剪器继续显示上一张图片。 */ async () => {
    const wrapper = await mountModal({
      props: { src: 'data:image/png;base64,ZHVtbXktb2xk' },
    });
    const file = {
      name: 'DUMMY-avatar.png',
      size: 1024,
    } as unknown as File;

    const accepted = beforeUploadCallback()(file);

    expect(accepted).toBe(false);
    expect(FileReaderStub.instances).toHaveLength(1);
    expect(FileReaderStub.instances[0]?.blob).toBe(file);
    // 读取期间旧图片立即让位，避免用户看到过期预览。
    await wrapper.vm.$nextTick();
    expect(wrapper.find('img').exists()).toBe(false);

    FileReaderStub.instances[0]?.finishRead(
      'data:image/png;base64,ZHVtbXktbmV3',
    );
    await wrapper.vm.$nextTick();

    expect(wrapper.find('img').attributes('src')).toBe(
      'data:image/png;base64,ZHVtbXktbmV3',
    );
  });

  it('读取结果为空时使用空地址', /** 直接把 null 交给裁剪器会让图片地址变成字符串 null。 */ async () => {
    const wrapper = await mountModal({});

    beforeUploadCallback()({
      name: 'DUMMY-avatar.png',
      size: 1024,
    } as unknown as File);
    FileReaderStub.instances[0]?.finishRead(null);
    await wrapper.vm.$nextTick();

    expect(wrapper.find('img').exists()).toBe(false);
  });
});

describe('裁剪器就绪与工具栏转发', /** 工具栏按钮失效会让用户无法纠正裁剪角度。 */ () => {
  it('裁剪器就绪后结束加载态', /** 加载态不结束会让确认按钮一直转圈。 */ async () => {
    const wrapper = await mountModal({});
    await preparePreview(wrapper);

    expect(lastLoadingState()).toEqual({
      confirmLoading: false,
      loading: false,
    });
  });

  it('未选择图片时工具栏全部禁用', /** 允许点击会让 cropperjs 收到空实例并抛出。 */ async () => {
    const wrapper = await mountModal({});

    for (const content of [
      'ui.cropper.btn_reset',
      'ui.cropper.btn_rotate_left',
      'ui.cropper.btn_rotate_right',
      'ui.cropper.btn_scale_x',
      'ui.cropper.btn_scale_y',
      'ui.cropper.btn_zoom_in',
      'ui.cropper.btn_zoom_out',
    ]) {
      expect(toolbarButton(wrapper, content).attributes('data-disabled')).toBe(
        'true',
      );
    }
  });

  it('选择图片后工具栏可用并转发旋转、缩放与重置', /** 转发错参数会让图片朝反方向旋转或缩放。 */ async () => {
    const wrapper = await mountModal({});
    await preparePreview(wrapper);
    const instance = cropperProbe.instances[0];

    expect(
      toolbarButton(wrapper, 'ui.cropper.btn_reset').attributes(
        'data-disabled',
      ),
    ).toBe('false');
    await toolbarButton(wrapper, 'ui.cropper.btn_reset').trigger('click');
    await toolbarButton(wrapper, 'ui.cropper.btn_rotate_left').trigger('click');
    await toolbarButton(wrapper, 'ui.cropper.btn_rotate_right').trigger(
      'click',
    );
    await toolbarButton(wrapper, 'ui.cropper.btn_zoom_in').trigger('click');
    await toolbarButton(wrapper, 'ui.cropper.btn_zoom_out').trigger('click');

    expect(instance?.reset).toHaveBeenCalledTimes(1);
    expect(instance?.rotate).toHaveBeenNthCalledWith(1, -45);
    expect(instance?.rotate).toHaveBeenNthCalledWith(2, 45);
    expect(instance?.zoom).toHaveBeenNthCalledWith(1, 0.1);
    expect(instance?.zoom).toHaveBeenNthCalledWith(2, -0.1);
  });

  it('水平与垂直翻转在正反比例之间切换', /** 翻转比例算错会让按钮第二次点击没有效果。 */ async () => {
    const wrapper = await mountModal({});
    await preparePreview(wrapper);
    const instance = cropperProbe.instances[0];

    await toolbarButton(wrapper, 'ui.cropper.btn_scale_x').trigger('click');
    await toolbarButton(wrapper, 'ui.cropper.btn_scale_x').trigger('click');
    await toolbarButton(wrapper, 'ui.cropper.btn_scale_y').trigger('click');
    await toolbarButton(wrapper, 'ui.cropper.btn_scale_y').trigger('click');

    expect(instance?.scaleX).toHaveBeenNthCalledWith(1, -1);
    expect(instance?.scaleX).toHaveBeenNthCalledWith(2, 1);
    expect(instance?.scaleY).toHaveBeenNthCalledWith(1, -1);
    expect(instance?.scaleY).toHaveBeenNthCalledWith(2, 1);
  });

  it('裁剪器未就绪时工具栏点击不抛错', /** 就绪前点击是常见操作，抛错会打断整个弹窗。 */ async () => {
    const wrapper = await mountModal({});
    const vm = wrapper.vm as unknown as {
      /** 工具栏方法转发签名。 */
      handlerToolbar: (event: string, arg?: number) => void;
    };

    expect(
      /** 在实例尚未交回时转发一次缩放。 */ () =>
        vm.handlerToolbar('zoom', 0.1),
    ).not.toThrow();
  });

  it('未登记的工具栏动作被忽略', /** 未知方法名不应在实例上被盲目调用。 */ async () => {
    const wrapper = await mountModal({});
    await preparePreview(wrapper);
    const instance = cropperProbe.instances[0];
    const vm = wrapper.vm as unknown as {
      /** 工具栏方法转发签名。 */
      handlerToolbar: (event: string, arg?: number) => void;
    };

    vm.handlerToolbar('unknownMethod', 1);

    expect(instance?.reset).not.toHaveBeenCalled();
    expect(instance?.zoom).not.toHaveBeenCalled();
  });
});

describe('确认上传契约', /** 确认上传是裁剪结果进入业务的唯一出口。 */ () => {
  it('未选择图片时给出警告且不上传', /** 静默返回会让用户以为上传成功。 */ async () => {
    const uploadApi = vi.fn();
    await mountModal({ props: { uploadApi } });

    await modalOptions().onConfirm?.();

    expect(feedbackProbe.showWarningMessage).toHaveBeenCalledWith('未选择图片');
    expect(uploadApi).not.toHaveBeenCalled();
  });

  it('上传成功后抛出结果、关闭弹窗并结束加载态', /** 漏抛事件会让调用方拿不到新头像地址。 */ async () => {
    const uploaded: unknown[] = [];
    const uploadApi = vi.fn(
      /**
       * 记录上传入参并返回图片地址。
       * @param params 弹窗传入的上传参数。
       */
      async (params: unknown) => {
        uploaded.push(params);
        return 'https://files.test/DUMMY-avatar.png';
      },
    );
    const wrapper = await mountModal({ props: { uploadApi } });
    await preparePreview(wrapper, 'DUMMY-avatar.png');

    await modalOptions().onConfirm?.();
    await flushPromises();

    expect(uploaded[0]).toMatchObject({
      filename: 'DUMMY-avatar.png',
      name: 'file',
    });
    expect((uploaded[0] as { file?: unknown }).file).toBeInstanceOf(Blob);
    expect(wrapper.emitted('uploadSuccess')?.[0]?.[0]).toEqual({
      data: 'https://files.test/DUMMY-avatar.png',
      source: 'data:image/png;base64,ZHVtbXktcHJldmlldw==',
    });
    expect(modalProbe.api.close).toHaveBeenCalledTimes(1);
    expect(lastLoadingState()).toEqual({
      confirmLoading: false,
      loading: false,
    });
  });

  it('上传失败时仍然结束加载态并向上抛出', /** 吞掉失败会让用户看不到错误，也停不下来确认按钮。 */ async () => {
    const uploadApi = vi.fn(
      /** 模拟上传接口失败。 */ async () => {
        throw new Error('上传失败');
      },
    );
    const wrapper = await mountModal({ props: { uploadApi } });
    await preparePreview(wrapper);

    await expect(modalOptions().onConfirm?.()).rejects.toThrowError('上传失败');

    expect(lastLoadingState()).toEqual({
      confirmLoading: false,
      loading: false,
    });
    expect(wrapper.emitted('uploadSuccess')).toBeUndefined();
  });
});

describe('预览区域渲染', /** 右侧预览决定用户能否在确认前看清裁剪效果。 */ () => {
  it('有裁剪结果时渲染预览图与四档头像', /** 缺少头像预览会让用户无法判断小尺寸下的显示效果。 */ async () => {
    const wrapper = await mountModal({});
    await preparePreview(wrapper);

    expect(wrapper.find('[alt="ui.cropper.preview"]').attributes('src')).toBe(
      'data:image/png;base64,ZHVtbXktcHJldmlldw==',
    );
    const avatars = wrapper.findAll('.el-avatar');
    expect(
      avatars.map(
        /** 取出各档头像尺寸。 */ (item) => item.attributes('data-size'),
      ),
    ).toEqual(['large', '48', '64', '80']);
  });

  it('没有裁剪结果时不渲染预览区', /** 空预览会让用户以为已经裁剪完成。 */ async () => {
    const wrapper = await mountModal({});

    expect(wrapper.find('[alt="ui.cropper.preview"]').exists()).toBe(false);
    expect(wrapper.findAll('.el-avatar')).toHaveLength(0);
  });
});
