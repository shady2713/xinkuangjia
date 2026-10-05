/**
 * 图片裁剪器（components/cropper/cropper.vue）真实行为回归。
 *
 * 该组件是裁剪弹窗的图片层：挂载后在图片元素上创建 cropperjs 实例，把就绪的实例交给
 * 父组件驱动工具栏，并在裁剪、缩放、拖动后防抖读取裁剪结果转成 base64 抛出；圆形输出
 * 还要先合成圆形遮罩。这里真实挂载组件并调用 cropperjs 交回的真实回调，只替换
 * cropperjs、canvas 导出与 FileReader 三个浏览器外部边界，断言组件抛给父组件的事件载荷。
 */
import { mount } from '@vue/test-utils';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CropperImage from './cropper.vue';

/** cropperjs 实例替身与最近一次构造参数；模块替身与用例读取同一实例。 */
const cropperProbe = vi.hoisted(
  /** 建立可设置画布、可断言的 cropperjs 替身容器。 */ () => ({
    instances: [] as {
      destroy: ReturnType<typeof vi.fn>;
      getCroppedCanvas: ReturnType<typeof vi.fn>;
      getData: ReturnType<typeof vi.fn>;
    }[],
    options: undefined as Record<string, unknown> | undefined,
    /** 裁剪结果画布替身，由用例在断言前替换。 */
    sourceCanvas: undefined as unknown,
  }),
);

vi.mock(
  'cropperjs',
  /** 只替换依赖真实 DOM 与 canvas 的第三方裁剪实现，组件自身的裁剪编排保持真实实现。 */ () => ({
    default: class CropperStub {
      /** 记录实例是否被释放，用于断言卸载时的资源回收。 */
      destroy = vi.fn();
      /** 返回用例提供的裁剪结果画布。 */
      getCroppedCanvas = vi.fn(
        /** 读取用例在断言前设置的画布替身。 */ () => cropperProbe.sourceCanvas,
      );
      /** 返回固定的裁剪坐标，父组件按该坐标保存裁剪信息。 */
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
      /**
       * 记录构造参数并登记实例。
       * @param _element 组件传入的图片元素，替身不解释。
       * @param options 组件合并后的 cropperjs 配置。
       */
      constructor(
        _element: HTMLImageElement,
        options: Record<string, unknown>,
      ) {
        cropperProbe.options = options;
        cropperProbe.instances.push(this);
      }
    },
  }),
);

/** 读取完成事件载荷；组件只读取 target.result。 */
interface ReadEvent {
  /** 事件目标；读取失败或未设置结果时为 null。 */
  target: null | { result: ArrayBuffer | null | string };
}

/** 读取完成回调签名。 */
type ReadEventHandler = (event: ReadEvent) => void;

/** 读取失败回调签名。 */
type ReadErrorHandler = () => void;

/** 裁剪器组件登记到 cropperjs 的回调签名。 */
type CropperHandler = () => void;

/** 裁剪结果读取器替身：读取结果与成功/失败时机都由用例控制。 */
class FileReaderStub {
  /** 本次测试期间创建的读取器，按创建顺序登记。 */
  static instances: FileReaderStub[] = [];

  /** 记录被读取的图片二进制，用于断言读取的就是本次裁剪结果。 */
  blob: Blob | undefined;

  /** 读取失败回调；组件在该回调里发布 cropendError。 */
  onerror: null | ReadErrorHandler = null;

  /** 编码结束回调；组件在该回调里发布裁剪结果。 */
  onloadend: null | ReadEventHandler = null;

  /** 读取结果，由用例在触发回调前设置。 */
  result: ArrayBuffer | null | string = null;

  /** 建立读取器替身并登记实例。 */ constructor() {
    FileReaderStub.instances.push(this);
  }

  /**
   * 记录被读取的图片二进制，不执行真实编码。
   * @param blob 组件交给读取器的裁剪结果。
   */
  readAsDataURL(blob: Blob) {
    this.blob = blob;
  }
}

/** canvas 画布替身契约：组件只调用导出入口。 */
interface CanvasStub {
  /** 导出图片二进制；由用例决定回调参数。 */
  toBlob: ReturnType<typeof vi.fn>;
}

/** 组件脚本内部绑定视图；用例通过真实 setup 绑定驱动边界分支。 */
interface CropperSetupView {
  /** 当前 cropperjs 实例引用，置空用于驱动未就绪分支。 */
  cropper: unknown;
  /** 读取裁剪结果并转 base64 发布。 */
  cropped: () => void;
  /** 生成圆形裁剪画布。 */
  getRoundedCanvas: () => HTMLCanvasElement;
  /** 图片元素模板引用，置空用于驱动元素缺失分支。 */
  imgElRef: unknown;
  /** 在图片元素上创建 cropperjs 实例。 */
  init: () => Promise<void>;
  /** 按 realTimePreview 决定是否重新计算裁剪结果。 */
  realTimeCropped: () => void;
}

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

/**
 * 设置本次裁剪使用的画布替身。
 * @param blob 组件导出时回调收到的图片二进制；传 null 表示导出为空结果。
 * @returns 记录导出调用的画布替身。
 */
function setSourceCanvas(blob: Blob | null) {
  const canvas: CanvasStub = {
    toBlob: vi.fn(
      /**
       * 立即按用例给定的结果回调，复刻浏览器导出完成时机。
       * @param callback 组件传入的导出完成回调。
       */
      (callback: BlobCallback) => callback(blob),
    ),
  };
  cropperProbe.sourceCanvas = canvas;
  return canvas;
}

/**
 * 取组件脚本内部绑定。
 * @param wrapper 已挂载的组件包装器。
 * @returns 组件 setup 返回的真实绑定的类型视图。
 */
function setup(wrapper: ReturnType<typeof mount>): CropperSetupView {
  return wrapper.vm as unknown as CropperSetupView;
}

/**
 * 取出裁剪器组件登记到 cropperjs 的回调。
 * @param name 回调名，如 ready。
 * @returns 对应回调函数。
 * @throws Error 裁剪器组件未登记该回调时抛出，避免用例静默地什么都不验证。
 */
function cropperCallback(name: string) {
  const callback = cropperProbe.options?.[name];
  if (typeof callback !== 'function') {
    throw new TypeError(`裁剪器组件未登记回调：${name}`);
  }
  return callback as CropperHandler;
}

/**
 * 取出本次测试创建的裁剪结果读取器。
 * @returns 最近创建的读取器替身。
 * @throws Error 组件未读取裁剪结果时抛出，避免用例静默地什么都不验证。
 */
function lastReader() {
  const reader = FileReaderStub.instances.at(-1);
  if (!reader) {
    throw new Error('组件未创建裁剪结果读取器');
  }
  return reader;
}

/**
 * 等待裁剪防抖窗口结束。
 * @returns 防抖窗口结束后的 Promise。
 */
function waitDebounce() {
  return new Promise(
    /** 用真实计时器释放等待，避免掩盖未触发的防抖逻辑。 */ (resolve) => {
      setTimeout(resolve, 150);
    },
  );
}

/**
 * 挂载裁剪器并等待首次渲染完成。
 * @param options 挂载选项，用于传入属性与外部样式类。
 * @returns 已挂载的裁剪器包装器。
 */
async function mountCropper(options: Parameters<typeof mount>[1] = {}) {
  const wrapper = mount(CropperImage, options);
  await wrapper.vm.$nextTick();
  return wrapper;
}

beforeEach(
  /** 清空替身状态，避免上一例的实例与调用影响断言。 */ () => {
    vi.clearAllMocks();
    cropperProbe.instances = [];
    cropperProbe.options = undefined;
    FileReaderStub.instances = [];
    vi.stubGlobal('FileReader', FileReaderStub);
  },
);

afterEach(
  /** 还原全局替身，避免影响其他测试文件。 */ () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  },
);

describe('裁剪器渲染契约', /** 容器与图片的尺寸样式直接决定用户看到的裁剪区域。 */ () => {
  it('把高度、外部样式类与圆形标记渲染到容器和图片上', /** 高度或圆形标记丢失会让裁剪区域与头像预览变形。 */ async () => {
    const wrapper = await mountCropper({
      attrs: { class: 'external-class' },
      props: {
        circled: true,
        height: '300px',
        imageStyle: { maxWidth: '80%' },
        src: 'DUMMY-avatar.png',
      },
    });

    const container = wrapper.find('div');
    const image = wrapper.find('img');

    expect(container.attributes('style')).toContain('height: 300px');
    expect(container.classes()).toContain('cropper-image--circled');
    expect(container.classes()).toContain('external-class');
    expect(image.attributes('src')).toBe('DUMMY-avatar.png');
    expect(image.attributes('alt')).toBe('');
    expect(image.attributes('style')).toContain('height: 300px');
    expect(image.attributes('style')).toContain('max-width: 80%');
  });

  it('数值高度按像素写入容器高度', /** 容器高度缺少 px 会让裁剪区域塌陷，用户看不到完整图片。 */ async () => {
    const wrapper = await mountCropper({ props: { height: 300 } });

    expect(wrapper.find('div').attributes('style')).toContain('height: 300px');
  });

  it('高度已带单位时不会重复拼接 px', /** 出现 300pxpx 会让裁剪容器高度失效。 */ async () => {
    const wrapper = await mountCropper({ props: { height: '300px' } });

    expect(wrapper.find('div').attributes('style')).toContain('height: 300px');
  });

  it('裁剪器就绪前隐藏图片', /** 图片先于裁剪区域出现会闪烁未裁剪的原图。 */ async () => {
    const wrapper = await mountCropper({ props: { src: 'DUMMY-avatar.png' } });
    setSourceCanvas(new Blob(['DUMMY-image']));

    expect(wrapper.find('img').attributes('style')).toContain('display: none');

    const options = cropperProbe.options;
    if (typeof options?.ready !== 'function') {
      throw new TypeError('组件未向 cropperjs 注册 ready 回调');
    }
    /** 按 cropperjs 注册契约调用就绪回调。 */
    cropperCallback('ready')();
    await wrapper.vm.$nextTick();

    expect(wrapper.find('img').attributes('style')).not.toContain(
      'display: none',
    );
  });
});

describe('裁剪器实例编排', /** 实例创建与回调转接决定父组件能否驱动裁剪工具。 */ () => {
  it('挂载后在图片元素上创建实例并保留默认配置', /** 缺少默认配置会让裁剪框不可拖动或不可缩放。 */ async () => {
    await mountCropper({ props: { src: 'DUMMY-avatar.png' } });

    expect(cropperProbe.instances).toHaveLength(1);
    expect(cropperProbe.options).toMatchObject({
      aspectRatio: 1,
      autoCrop: true,
      cropBoxMovable: true,
      zoomable: true,
    });
  });

  it('调用方配置覆盖默认配置', /** 覆盖失效会让调用方无法按业务调整裁剪行为。 */ async () => {
    const customReady = vi.fn();
    await mountCropper({
      props: { options: { aspectRatio: 2, ready: customReady } },
    });

    expect(cropperProbe.options?.aspectRatio).toBe(2);
    expect(cropperProbe.options?.ready).toBe(customReady);
    expect(cropperProbe.options?.zoomable).toBe(true);
  });

  it('就绪后发布首帧预览并把实例交给父组件', /** 父组件拿不到实例就无法执行旋转与缩放。 */ async () => {
    const wrapper = await mountCropper({ props: { src: 'DUMMY-avatar.png' } });
    setSourceCanvas(new Blob(['DUMMY-image']));
    const instance = cropperProbe.instances[0];

    const options = cropperProbe.options;
    if (typeof options?.ready !== 'function') {
      throw new TypeError('组件未向 cropperjs 注册 ready 回调');
    }
    /** 按 cropperjs 注册契约调用就绪回调。 */
    cropperCallback('ready')();

    // 事件载荷经 Vue devtools 序列化后不再是同一引用，按真实能力核对交回的实例。
    const readyPayload = wrapper.emitted('ready')?.[0]?.[0] as
      | undefined
      | { getData?: unknown };
    expect(readyPayload?.getData).toBe(instance?.getData);
    // 首帧预览走真实编码链路：读取器已按裁剪结果创建，编码结束后才发布 cropend。
    expect(FileReaderStub.instances).toHaveLength(1);
    expect(FileReaderStub.instances[0]?.blob).toBeInstanceOf(Blob);
  });

  it('裁剪、缩放与拖动事件防抖更新预览', /** 连续拖动期间频繁编码会让界面卡顿；完全不更新则预览停在旧结果。 */ async () => {
    await mountCropper({ props: { src: 'DUMMY-avatar.png' } });
    setSourceCanvas(new Blob(['DUMMY-image']));
    const instance = cropperProbe.instances[0];

    const options = cropperProbe.options;
    if (
      typeof options?.crop !== 'function' ||
      typeof options.zoom !== 'function' ||
      typeof options.cropmove !== 'function'
    ) {
      throw new TypeError('组件未向 cropperjs 注册裁剪变化回调');
    }
    /** 按 cropperjs 注册契约调用裁剪回调。 */
    cropperCallback('crop')();
    /** 按 cropperjs 注册契约调用缩放回调。 */
    cropperCallback('zoom')();
    /** 按 cropperjs 注册契约调用拖动回调。 */
    cropperCallback('cropmove')();
    await waitDebounce();

    expect(instance?.getData).toHaveBeenCalled();
  });

  it('关闭实时预览后裁剪变化不读取结果', /** 关闭后仍读取会带来无用开销，也违背调用方的选择。 */ async () => {
    await mountCropper({
      props: { realTimePreview: false, src: 'DUMMY-avatar.png' },
    });
    setSourceCanvas(new Blob(['DUMMY-image']));
    const instance = cropperProbe.instances[0];

    const options = cropperProbe.options;
    if (typeof options?.crop !== 'function') {
      throw new TypeError('组件未向 cropperjs 注册裁剪变化回调');
    }
    /** 按 cropperjs 注册契约调用裁剪回调。 */
    cropperCallback('crop')();
    await waitDebounce();

    expect(instance?.getData).not.toHaveBeenCalled();
  });

  it('图片元素缺失时不创建实例', /** 缺少该保护会让空引用直接抛出，遮住真正的挂载失败原因。 */ async () => {
    const wrapper = await mountCropper({ props: { src: 'DUMMY-avatar.png' } });
    const view = setup(wrapper);
    view.imgElRef = null;

    await view.init();

    expect(cropperProbe.instances).toHaveLength(1);
  });

  it('卸载时销毁裁剪实例', /** 不销毁会让 DOM 监听与内存随每次打开弹窗累积。 */ async () => {
    const wrapper = await mountCropper({ props: { src: 'DUMMY-avatar.png' } });
    const instance = cropperProbe.instances[0];

    wrapper.unmount();

    expect(instance?.destroy).toHaveBeenCalledTimes(1);
  });
});

describe('裁剪结果读取', /** 读取结果的正确性决定上传的头像是否为用户选中的区域。 */ () => {
  it('未就绪时读取结果直接返回', /** 实例缺失时继续读取会抛出空引用。 */ async () => {
    const wrapper = await mountCropper({ props: { src: 'DUMMY-avatar.png' } });
    setSourceCanvas(new Blob(['DUMMY-image']));
    const instance = cropperProbe.instances[0];
    const view = setup(wrapper);
    view.cropper = null;

    view.cropped();

    expect(instance?.getData).not.toHaveBeenCalled();
    expect(wrapper.emitted('cropend')).toBeUndefined();
  });

  it('非圆形输出直接使用裁剪结果画布', /** 非圆形场景多合成一层遮罩会裁掉头像四角。 */ async () => {
    const wrapper = await mountCropper({
      props: { circled: false, src: 'DUMMY-avatar.png' },
    });
    const canvas = setSourceCanvas(new Blob(['DUMMY-image']));
    const instance = cropperProbe.instances[0];

    setup(wrapper).cropped();

    expect(instance?.getCroppedCanvas).toHaveBeenCalledTimes(1);
    expect(canvas.toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      'image/png',
    );
  });

  it('圆形输出先合成圆形遮罩再导出', /** 遮罩合成失败会让头像显示为方形。 */ async () => {
    const context = createContextStub();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      /** 返回记录绘制调用的 2D 上下文替身。 */ () =>
        context as unknown as CanvasRenderingContext2D,
    );
    const exportSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation(
        /**
         * 立即回调导出结果，复刻浏览器导出完成时机。
         * @param callback 组件传入的导出完成回调。
         */
        (callback: BlobCallback) => callback(new Blob(['DUMMY-image'])),
      );
    const wrapper = await mountCropper({
      props: { circled: true, src: 'DUMMY-avatar.png' },
    });
    cropperProbe.sourceCanvas = { height: 200, width: 400 } as unknown;

    setup(wrapper).cropped();

    expect(context.drawImage).toHaveBeenCalledWith(
      cropperProbe.sourceCanvas,
      0,
      0,
      400,
      200,
    );
    expect(context.globalCompositeOperation).toBe('destination-in');
    expect(context.arc).toHaveBeenCalledWith(
      200,
      100,
      100,
      0,
      2 * Math.PI,
      true,
    );
    expect(context.fill).toHaveBeenCalledTimes(1);
    expect(exportSpy).toHaveBeenCalled();
  });

  it('导出结果为空时不发布裁剪事件', /** 发布空地址会让预览区出现破图。 */ async () => {
    const wrapper = await mountCropper({ props: { src: 'DUMMY-avatar.png' } });
    setSourceCanvas(null);

    setup(wrapper).cropped();

    expect(FileReaderStub.instances).toHaveLength(0);
    expect(wrapper.emitted('cropend')).toBeUndefined();
  });

  it('编码结束后发布图片地址与裁剪坐标', /** 载荷缺字段会让上传拿不到文件名或裁剪信息。 */ async () => {
    const wrapper = await mountCropper({ props: { src: 'DUMMY-avatar.png' } });
    const blob = new Blob(['DUMMY-image']);
    setSourceCanvas(blob);

    setup(wrapper).cropped();
    const reader = lastReader();
    expect(reader.blob).toBe(blob);
    reader.result = 'data:image/png;base64,DUMMY';
    reader.onloadend?.({ target: { result: reader.result } });

    expect(wrapper.emitted('cropend')?.[0]?.[0]).toMatchObject({
      imgBase64: 'data:image/png;base64,DUMMY',
      imgInfo: { height: 300, width: 300, x: 10, y: 20 },
    });
  });

  it('读取结果为空时发布空地址', /** 后端收到 undefined 会无法判断是编码失败还是未选择图片。 */ async () => {
    const wrapper = await mountCropper({ props: { src: 'DUMMY-avatar.png' } });
    setSourceCanvas(new Blob(['DUMMY-image']));

    setup(wrapper).cropped();
    lastReader().onloadend?.({ target: null });

    expect(wrapper.emitted('cropend')?.[0]?.[0]).toMatchObject({
      imgBase64: '',
    });
  });

  it('读取失败时发布 cropendError', /** 不通知调用方会让上传等待永久停在加载态。 */ async () => {
    const wrapper = await mountCropper({ props: { src: 'DUMMY-avatar.png' } });
    setSourceCanvas(new Blob(['DUMMY-image']));

    setup(wrapper).cropped();
    lastReader().onerror?.();

    expect(wrapper.emitted('cropendError')).toHaveLength(1);
    expect(wrapper.emitted('cropend')).toBeUndefined();
  });
});

describe('圆形画布的失败边界', /** 运行环境不支持 canvas 时必须显式失败，不能留下难以定位的空引用错误。 */ () => {
  it('裁剪实例缺失时生成圆形画布显式失败', /** 实例缺失说明调用顺序错误，静默返回会把空引用带到绘制阶段。 */ async () => {
    const wrapper = await mountCropper({ props: { src: 'DUMMY-avatar.png' } });
    const view = setup(wrapper);
    view.cropper = null;

    expect(
      /** 触发圆形画布生成。 */ () => view.getRoundedCanvas(),
    ).toThrowError('裁剪实例尚未就绪，无法生成圆形裁剪画布');
  });

  it('浏览器不提供 2D 上下文时显式失败', /** happy-dom 与受限制浏览器不提供 2D 上下文，此时必须给出可读原因。 */ async () => {
    const wrapper = await mountCropper({ props: { src: 'DUMMY-avatar.png' } });
    const view = setup(wrapper);
    cropperProbe.sourceCanvas = { height: 200, width: 200 } as unknown;

    expect(
      /** 触发圆形画布生成。 */ () => view.getRoundedCanvas(),
    ).toThrowError('当前浏览器不支持 Canvas 2D 上下文，无法生成圆形裁剪画布');
  });
});
