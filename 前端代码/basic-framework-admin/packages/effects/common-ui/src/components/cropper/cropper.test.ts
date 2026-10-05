/**
 * 图片裁剪器（common-ui 的 cropper/cropper.vue）真实行为回归。
 *
 * 组件按图片真实尺寸换算容器与初始裁剪框，再按拖拽点把鼠标位移换算成四条边的变化，最后把
 * 裁剪框映射回原图像素导出图片。换算错误会造成可见故障：比例字符串解析错会让裁剪框比例不对，
 * 自由拖拽不做最小尺寸兜底会把裁剪框拖成一条线，固定比例拖拽不做最大尺寸收敛会裁出越界图片，
 * 导出时坐标系错位会裁到错误区域，质量参数越界会让导出接口报错。用例真实挂载组件、真实派发
 * 按下与移动序列、并真实调用组件暴露的导出方法。
 *
 * 图片加载、画布 2D 上下文与画布导出是本组件依赖的浏览器外部边界：happy-dom 既不加载图片也
 * 不实现画布，因此这里按浏览器契约提供可记录的画布上下文与导出结果，图片尺寸与元素布局按
 * 真实浏览器返回值注入。
 */
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Cropper from './cropper.vue';

/** 图片原始宽度，用于验证按原图像素导出。 */
const IMAGE_WIDTH = 800;

/** 图片原始高度，用于验证按原图像素导出。 */
const IMAGE_HEIGHT = 600;

/** 容器在浏览器中的像素宽度。 */
const CONTAINER_WIDTH = 500;

/** 容器在浏览器中的像素高度。 */
const CONTAINER_HEIGHT = 400;

/** 图片在容器内渲染后的像素宽度。 */
const RENDERED_WIDTH = 500;

/** 图片在容器内渲染后的像素高度。 */
const RENDERED_HEIGHT = 375;

/** 画布替身记录下来的绘制调用。 */
interface CanvasCalls {
  drawImage: unknown[][];
  scale: unknown[][];
  toBlob: unknown[][];
  toDataURL: unknown[][];
}

/** 图片加载事件监听器签名。 */
type ImageLoadListener = (event?: unknown) => void;

/** 组件通过 defineExpose 暴露的导出方法。 */
interface CropperApi {
  /** 导出裁剪结果；不传格式时输出 jpeg 二进制。 */
  getCropImage: (
    format?: 'image/jpeg' | 'image/png',
    quality?: number,
    outputType?: 'base64' | 'blob',
    targetWidth?: number,
    targetHeight?: number,
  ) => Promise<Blob | string | undefined>;
}

/** 本次用例的画布调用记录。 */
let canvasCalls: CanvasCalls;

/** 图片替身：组件通过 src 与 load/error 事件驱动导出流程，这里由用例控制时机。 */
class ImageStub {
  /** 组件本轮创建的全部图片替身，按创建顺序登记。 */
  static instances: ImageStub[] = [];

  /** 跨域属性；组件对非同源图片会设置为 anonymous。 */
  crossOrigin = '';

  /** 原始图片高度，导出时用于把渲染像素换算回原图像素。 */
  height = IMAGE_HEIGHT;

  /** 组件登记的事件监听器，按事件名分组。 */
  listeners = new Map<string, Set<ImageLoadListener>>();

  /** 图片原始高度。 */
  naturalHeight = IMAGE_HEIGHT;

  /** 图片原始宽度。 */
  naturalWidth = IMAGE_WIDTH;

  /** 图片地址。 */
  src = '';

  /** 原始图片宽度，导出时用于把渲染像素换算回原图像素。 */
  width = IMAGE_WIDTH;

  /** 建立图片替身并登记实例。 */ constructor() {
    ImageStub.instances.push(this);
  }

  /**
   * 登记事件监听器。
   * @param type 事件类型。
   * @param callback 事件回调。
   */
  addEventListener(type: string, callback: ImageLoadListener) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(callback);
    this.listeners.set(type, set);
  }

  /**
   * 触发一次加载失败，模拟图片地址不可用。
   */
  emitError() {
    this.listeners
      .get('error')
      ?.forEach(
        /** 逐个调用组件登记的回调，带上错误信息模拟真实的事件派发。 */ (
          callback,
        ) => callback({ message: 'DUMMY-加载失败' }),
      );
  }

  /**
   * 触发一次加载完成，模拟浏览器把图片数据读进来的时机。
   */
  emitLoad() {
    this.listeners
      .get('load')
      ?.forEach(
        /** 逐个调用组件登记的回调，模拟真实的事件派发。 */ (callback) =>
          callback(),
      );
  }

  /**
   * 移除事件监听器。
   * @param type 事件类型。
   * @param callback 事件回调。
   */
  removeEventListener(type: string, callback: ImageLoadListener) {
    this.listeners.get(type)?.delete(callback);
  }
}

/**
 * 创建可记录的画布上下文替身。
 * @returns 浏览器 2D 绘图上下文的替身。
 */
function createContext() {
  return {
    drawImage: vi.fn(
      /** 记录绘制裁剪结果的入参，用于断言坐标系换算。 */ (
        ...args: unknown[]
      ) => {
        canvasCalls.drawImage.push(args);
      },
    ),
    scale: vi.fn(
      /** 记录高清屏缩放系数。 */ (...args: unknown[]) => {
        canvasCalls.scale.push(args);
      },
    ),
  } as unknown as CanvasRenderingContext2D;
}

/**
 * 注入元素布局：happy-dom 不排版，按浏览器契约给出容器与图片的真实矩形。
 * @param wrapper 已挂载的裁剪器包装器。
 */
function layoutCropper(wrapper: ReturnType<typeof mount>) {
  const container = wrapper.find('.cropper-container').element;
  Object.defineProperty(container, 'getBoundingClientRect', {
    configurable: true,
    value: containerRect,
  });
  const image = wrapper.find('.cropper-image').element;
  Object.defineProperty(image, 'getBoundingClientRect', {
    configurable: true,
    value: renderedImageRect,
  });
}

/**
 * 返回容器在浏览器中的矩形。
 * @returns 容器的位置与尺寸。
 */
function containerRect() {
  return {
    bottom: CONTAINER_HEIGHT,
    height: CONTAINER_HEIGHT,
    left: 0,
    right: CONTAINER_WIDTH,
    top: 0,
    width: CONTAINER_WIDTH,
    x: 0,
    y: 0,
  };
}

/**
 * 返回图片在容器内渲染后的矩形。
 * @returns 渲染图片的位置与尺寸。
 */
function renderedImageRect() {
  return {
    bottom: RENDERED_HEIGHT,
    height: RENDERED_HEIGHT,
    left: 0,
    right: RENDERED_WIDTH,
    top: 0,
    width: RENDERED_WIDTH,
    x: 0,
    y: 0,
  };
}

/**
 * 返回退化到 0 的容器矩形，用于驱动裁剪尺寸非法的分支。
 * @returns 全 0 的容器矩形。
 */
function emptyRect() {
  return {
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    top: 0,
    width: 0,
    x: 0,
    y: 0,
  };
}

/**
 * 挂载裁剪器并注入图片尺寸与布局。
 * @param props 传给组件的属性。
 * @returns 已挂载的裁剪器包装器与导出方法。
 */
function mountCropper(props: Record<string, unknown> = {}) {
  const wrapper = mount(Cropper, {
    props: { img: 'DUMMY-cropper.png', ...props },
  });
  const image = wrapper.find('.cropper-image').element;
  // happy-dom 不加载图片，按浏览器契约注入图片原始尺寸。
  Object.defineProperty(image, 'naturalHeight', {
    configurable: true,
    value: IMAGE_HEIGHT,
  });
  Object.defineProperty(image, 'naturalWidth', {
    configurable: true,
    value: IMAGE_WIDTH,
  });
  layoutCropper(wrapper);
  return {
    api: wrapper.vm as unknown as CropperApi,
    wrapper,
  };
}

/**
 * 从指定拖拽点开始一次拖拽，并把位移派发到文档上。
 * @param wrapper 已挂载的裁剪器包装器。
 * @param point 拖拽点类名后缀。
 * @param diff 拖拽位移。
 * @param diff.x 水平位移。
 * @param diff.y 垂直位移。
 */
async function dragPoint(
  wrapper: ReturnType<typeof mount>,
  point: string,
  diff: { x: number; y: number },
) {
  await wrapper
    .find(`.cropper-point-${point}`)
    .trigger('mousedown', { clientX: 100, clientY: 100 });
  document.dispatchEvent(
    new MouseEvent('mousemove', {
      bubbles: true,
      clientX: 100 + diff.x,
      clientY: 100 + diff.y,
    }),
  );
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  await nextTick();
}

/**
 * 取当前裁剪框四条边（上、右、下、左）。
 * @param wrapper 已挂载的裁剪器包装器。
 * @returns 四条边的像素值。
 */
function dimensionOf(wrapper: ReturnType<typeof mount>) {
  // happy-dom 不支持 inset 简写，因此读取组件同步写到遮罩上的 clip-path。
  const style = wrapper.find('.cropper-mask-view').attributes('style') ?? '';
  const matched = style.match(
    /inset\((-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\)/,
  );
  if (!matched) {
    throw new Error(`裁剪框样式缺少 clip-path：${style}`);
  }
  return matched.slice(1).map(Number);
}

beforeEach(
  /** 登记图片与画布替身，让导出流程的每一步都可断言。 */ () => {
    canvasCalls = { drawImage: [], scale: [], toBlob: [], toDataURL: [] };
    ImageStub.instances = [];
    vi.stubGlobal('Image', ImageStub);
    vi.spyOn(
      HTMLCanvasElement.prototype,
      'getContext' as const,
    ).mockImplementation(
      /** 按浏览器契约返回可记录的 2D 上下文替身。 */ () => createContext(),
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
      /**
       * 记录导出参数并回调一份二进制结果。
       * @param callback 接收导出结果的回调。
       * @param format 导出格式。
       * @param quality 导出质量。
       */
      (callback: BlobCallback, format?: string, quality?: number) => {
        canvasCalls.toBlob.push([format, quality]);
        callback(new Blob(['DUMMY-crop'], { type: format ?? 'image/jpeg' }));
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(
      /**
       * 记录导出参数并返回一份 data URL。
       * @param format 导出格式。
       * @param quality 导出质量。
       */
      (format?: string, quality?: number) => {
        canvasCalls.toDataURL.push([format, quality]);
        return `data:${format ?? 'image/jpeg'};base64,DUMMY`;
      },
    );
  },
);

afterEach(
  /** 还原全局替身，避免影响其它用例。 */ () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  },
);

describe('裁剪器初始化', /** 初始尺寸与比例决定裁剪框是否贴合图片。 */ () => {
  it('图片加载后按真实尺寸铺满容器并显示裁剪框', /** 尺寸算错会让裁剪框超出图片范围。 */ async () => {
    const { wrapper } = mountCropper({ height: 400, width: 500 });

    expect(wrapper.find('.cropper-mask').attributes('style')).toContain(
      'display: none',
    );

    await wrapper.find('.cropper-image').trigger('load');

    expect(wrapper.find('.cropper-mask').attributes('style')).toContain(
      'display: block',
    );
    expect(wrapper.find('.cropper-container').attributes('style')).toContain(
      'width: 500px',
    );
    // 初始内边距取图片短边的 10%，并受 50 像素上限约束。
    expect(dimensionOf(wrapper)).toEqual([37, 37, 37, 37]);
  });

  it('传入宽高时容器尺寸受传入值限制', /** 尺寸上限失效会让小图被放大到失真。 */ async () => {
    const { wrapper } = mountCropper({ height: 200, width: 200 });

    await wrapper.find('.cropper-image').trigger('load');

    // 200 / 800 = 0.25 与 200 / 600 = 0.33 中取更小的比例。
    expect(wrapper.find('.cropper-container').attributes('style')).toContain(
      'width: 200px',
    );
    expect(wrapper.find('.cropper-container').attributes('style')).toContain(
      'height: 150px',
    );
  });

  it('未传宽高时使用组件默认容器尺寸', /** 默认尺寸丢失会让组件在没有属性时不可用。 */ async () => {
    const { wrapper } = mountCropper();

    await wrapper.find('.cropper-image').trigger('load');

    expect(
      wrapper.find('.cropper-action-wrapper').attributes('style'),
    ).toContain('width: 500px');
    expect(
      wrapper.find('.cropper-action-wrapper').attributes('style'),
    ).toContain('height: 400px');
  });

  it('原始尺寸为 0 时保持容器默认尺寸', /** 图片尺寸未知时按 0 计算会让容器塌成 0 像素。 */ async () => {
    const { wrapper } = mountCropper();
    const image = wrapper.find('.cropper-image').element;
    Object.defineProperty(image, 'naturalWidth', {
      configurable: true,
      value: 0,
    });

    await wrapper.find('.cropper-image').trigger('load');

    expect(wrapper.find('.cropper-container').attributes('style')).toContain(
      'width: 500px',
    );
    expect(wrapper.find('.cropper-container').attributes('style')).toContain(
      'height: 400px',
    );
  });
});

describe('裁剪器比例解析', /** 比例解析决定裁剪框是否按调用方要求约束。 */ () => {
  it('不传比例时使用初始尺寸', /** 未传比例却强行按比例裁剪会让裁剪框突然跳变。 */ async () => {
    const { wrapper } = mountCropper();

    await wrapper.find('.cropper-image').trigger('load');

    expect(dimensionOf(wrapper)).toEqual([37, 37, 37, 37]);
  });

  it('比例高度超出容器时按高度优先收敛', /** 高度溢出会让裁剪框超出图片下边界。 */ async () => {
    const { wrapper } = mountCropper({ aspectRatio: '1:1' });

    await wrapper.find('.cropper-image').trigger('load');

    // 500 / 1 = 500 超出容器高度 375，改为按高度换算并水平居中。
    expect(dimensionOf(wrapper)).toEqual([0, 62.5, 0, 62.5]);
  });

  it('比例宽度优先时按宽度铺满', /** 宽度未铺满会让裁剪框比预期小。 */ async () => {
    const { wrapper } = mountCropper({ aspectRatio: '2:1' });

    await wrapper.find('.cropper-image').trigger('load');

    // 宽度取满 500，高度 250 未超出容器高度 375，垂直居中。
    expect(dimensionOf(wrapper)).toEqual([62.5, 0, 62.5, 0]);
  });

  it('比例格式非法时告警并退回初始尺寸', /** 非法比例静默生效会让裁剪框比例无法预期。 */ async () => {
    const warn = vi
      .spyOn(console, 'warn')
      .mockImplementation(/** 忽略告警输出，仅记录调用。 */ () => {});
    const { wrapper } = mountCropper({ aspectRatio: 'DUMMY-非法比例' });

    await wrapper.find('.cropper-image').trigger('load');

    expect(warn).toHaveBeenCalledWith(
      '裁剪比例格式错误，应为 "数字:数字" 格式，如 "16:9"',
    );
    expect(dimensionOf(wrapper)).toEqual([37, 37, 37, 37]);
  });

  it('比例取值为零时告警并退回初始尺寸', /** 0 宽或 0 高构不成比例，静默生效会让裁剪框比例无法预期。 */ async () => {
    const warn = vi
      .spyOn(console, 'warn')
      .mockImplementation(/** 忽略告警输出，仅记录调用。 */ () => {});

    // 格式正确但取值为 0：必须落在取值校验上，而不是被格式校验一并拒绝。
    const zeroWidth = mountCropper({ aspectRatio: '0:9' });
    await zeroWidth.wrapper.find('.cropper-image').trigger('load');

    expect(warn).toHaveBeenCalledWith('裁剪比例解析失败，宽高必须为正整数');
    expect(dimensionOf(zeroWidth.wrapper)).toEqual([37, 37, 37, 37]);

    warn.mockClear();
    const zeroHeight = mountCropper({ aspectRatio: '16:0' });
    await zeroHeight.wrapper.find('.cropper-image').trigger('load');

    expect(warn).toHaveBeenCalledWith('裁剪比例解析失败，宽高必须为正整数');
    expect(dimensionOf(zeroHeight.wrapper)).toEqual([37, 37, 37, 37]);
  });

  it('带前导零的比例段仍按格式非法处理', /** "09:9" 不是合法比例段，放宽格式校验会让它被当成有效比例。 */ async () => {
    const warn = vi
      .spyOn(console, 'warn')
      .mockImplementation(/** 忽略告警输出，仅记录调用。 */ () => {});
    const { wrapper } = mountCropper({ aspectRatio: '09:9' });

    await wrapper.find('.cropper-image').trigger('load');

    expect(warn).toHaveBeenCalledWith(
      '裁剪比例格式错误，应为 "数字:数字" 格式，如 "16:9"',
    );
    expect(dimensionOf(wrapper)).toEqual([37, 37, 37, 37]);
  });

  it('运行期改动比例立即重算裁剪框', /** 比例改动不生效会让用户切换比例时看不到变化。 */ async () => {
    const { wrapper } = mountCropper();
    await wrapper.find('.cropper-image').trigger('load');
    expect(dimensionOf(wrapper)).toEqual([37, 37, 37, 37]);

    await wrapper.setProps({ aspectRatio: '1:1' });

    expect(dimensionOf(wrapper)).toEqual([0, 62.5, 0, 62.5]);
  });

  it('运行期改动宽高重新计算容器尺寸', /** 宽高改动不重算会让容器与传入尺寸不一致。 */ async () => {
    const { wrapper } = mountCropper();
    await wrapper.find('.cropper-image').trigger('load');

    await wrapper.setProps({ height: 300, width: 300 });
    await nextTick();

    // 300 / 800 = 0.375 与 300 / 600 = 0.5 中取更小的比例。
    expect(wrapper.find('.cropper-container').attributes('style')).toContain(
      'width: 300px',
    );
    expect(wrapper.find('.cropper-container').attributes('style')).toContain(
      'height: 225px',
    );
  });
});

describe('裁剪器自由拖拽', /** 无比例约束时必须拖得出且拖不坏。 */ () => {
  it('拖拽右边把手按位移收窄裁剪框', /** 位移方向反了会让裁剪框越拖越大。 */ async () => {
    const { wrapper } = mountCropper();
    await wrapper.find('.cropper-image').trigger('load');

    await dragPoint(wrapper, 'e', { x: 100, y: 0 });

    // 右边界贴到容器右侧，裁剪框变宽。
    expect(dimensionOf(wrapper)).toEqual([37, 0, 37, 37]);
  });

  it('拖拽左边把手越过最小宽度时按最小宽度兜底', /** 不做最小宽度兜底会把裁剪框拖成一条线。 */ async () => {
    const { wrapper } = mountCropper();
    await wrapper.find('.cropper-image').trigger('load');

    await dragPoint(wrapper, 'w', { x: 400, y: 0 });

    // 右边保持 37，左边收到 500 - 37 - 60。
    expect(dimensionOf(wrapper)).toEqual([37, 37, 37, 403]);
  });

  it('拖拽右边把手越过最小宽度时按最小宽度兜底', /** 另一侧越界同样需要兜底，否则导出尺寸非法。 */ async () => {
    const { wrapper } = mountCropper();
    await wrapper.find('.cropper-image').trigger('load');

    await dragPoint(wrapper, 'e', { x: -400, y: 0 });

    expect(dimensionOf(wrapper)).toEqual([37, 403, 37, 37]);
  });

  it('拖拽上边把手越过最小高度时按最小高度兜底', /** 高度越界兜底缺失会让导出高度为负。 */ async () => {
    const { wrapper } = mountCropper();
    await wrapper.find('.cropper-image').trigger('load');

    await dragPoint(wrapper, 'n', { x: 0, y: 400 });

    // 下边保持 37，上边收到 400 - 37 - 60。
    expect(dimensionOf(wrapper)).toEqual([278, 37, 37, 37]);
  });

  it('拖拽下边把手越过最小高度时按最小高度兜底', /** 下边越界兜底缺失会让导出高度为负。 */ async () => {
    const { wrapper } = mountCropper();
    await wrapper.find('.cropper-image').trigger('load');

    await dragPoint(wrapper, 's', { x: 0, y: -400 });

    expect(dimensionOf(wrapper)).toEqual([37, 37, 278, 37]);
  });

  it('拖拽角点同时改变两条边', /** 角点只改一条边会让拖拽手感与视觉不符。 */ async () => {
    const { wrapper } = mountCropper();
    await wrapper.find('.cropper-image').trigger('load');

    await dragPoint(wrapper, 'se', { x: 60, y: 40 });

    // 右下角同时把右边与下边推到容器边界，裁剪框变大。
    expect(dimensionOf(wrapper)).toEqual([37, 0, 0, 37]);
  });

  it('拖拽右上角把手同时收窄上边与右边', /** 右上角只改一条边会让拖拽方向与视觉不符。 */ async () => {
    const { wrapper } = mountCropper();
    await wrapper.find('.cropper-image').trigger('load');

    await dragPoint(wrapper, 'ne', { x: 20, y: 30 });

    expect(dimensionOf(wrapper)).toEqual([67, 17, 37, 37]);
  });

  it('拖拽左上角把手同时收窄上边与左边', /** 左上角只改一条边会让拖拽方向与视觉不符。 */ async () => {
    const { wrapper } = mountCropper();
    await wrapper.find('.cropper-image').trigger('load');

    await dragPoint(wrapper, 'nw', { x: 20, y: 30 });

    expect(dimensionOf(wrapper)).toEqual([67, 37, 37, 57]);
  });

  it('拖拽左下角把手同时收窄下边与左边', /** 左下角只改一条边会让拖拽方向与视觉不符。 */ async () => {
    const { wrapper } = mountCropper();
    await wrapper.find('.cropper-image').trigger('load');

    await dragPoint(wrapper, 'sw', { x: 20, y: 30 });

    expect(dimensionOf(wrapper)).toEqual([37, 37, 7, 57]);
  });

  it('未按下时移动鼠标不改变裁剪框', /** 未按下就跟随会让鼠标经过时裁剪框乱跳。 */ async () => {
    const { wrapper } = mountCropper();
    await wrapper.find('.cropper-image').trigger('load');

    document.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        clientX: 300,
        clientY: 300,
      }),
    );
    await nextTick();

    expect(dimensionOf(wrapper)).toEqual([37, 37, 37, 37]);
  });
});

describe('裁剪器固定比例拖拽', /** 固定比例下拖拽必须同时满足比例与容器边界。 */ () => {
  it('拖拽右边把手按比例放大并受容器宽度限制', /** 未按比例换算会让裁剪框比例失真。 */ async () => {
    const { wrapper } = mountCropper({ aspectRatio: '1:1' });
    await wrapper.find('.cropper-image').trigger('load');

    await dragPoint(wrapper, 'e', { x: 300, y: 0 });

    // 宽度先被容器宽度截断为 500，再由容器高度收敛为 375，垂直居中。
    expect(dimensionOf(wrapper)).toEqual([0, 62.5, 0, 62.5]);
  });

  it('拖拽下边把手按比例缩小并保持水平居中', /** 非角点拖拽未居中会让裁剪框跑偏。 */ async () => {
    const { wrapper } = mountCropper({ aspectRatio: '1:1' });
    await wrapper.find('.cropper-image').trigger('load');

    await dragPoint(wrapper, 's', { x: 0, y: -200 });

    // 高度收到 175，水平方向按原中心重新居中。
    expect(dimensionOf(wrapper)).toEqual([0, 162.5, 200, 162.5]);
  });

  it('拖拽角点按位移较大的方向换算', /** 角点换算方向选错会让裁剪框跟手方向相反。 */ async () => {
    const { wrapper } = mountCropper({ aspectRatio: '1:1' });
    await wrapper.find('.cropper-image').trigger('load');

    await dragPoint(wrapper, 'se', { x: -100, y: -20 });

    // 水平位移更大，按宽度换算并同步高度，右边与下边一起内收。
    expect(dimensionOf(wrapper)).toEqual([0, 162.5, 100, 62.5]);
  });

  it('拖拽角点竖直位移更大时按高度换算', /** 竖直方向更明显时按宽度换算会让拖拽不跟手。 */ async () => {
    const { wrapper } = mountCropper({ aspectRatio: '1:1' });
    await wrapper.find('.cropper-image').trigger('load');

    await dragPoint(wrapper, 'se', { x: -20, y: -100 });

    // 竖直位移更大，按高度换算后结果与按宽度换算一致。
    expect(dimensionOf(wrapper)).toEqual([0, 162.5, 100, 62.5]);
  });

  it('拖拽角点缩到最小时按最小宽度兜底', /** 比例拖拽缺少最小尺寸兜底会让裁剪框消失。 */ async () => {
    const { wrapper } = mountCropper({ aspectRatio: '1:1' });
    await wrapper.find('.cropper-image').trigger('load');

    await dragPoint(wrapper, 'se', { x: -500, y: -500 });

    // 缩到最小边长 60 后停止，左上两条边保持不动。
    expect(dimensionOf(wrapper)).toEqual([0, 377.5, 315, 62.5]);
  });

  it('拖拽上边把手时以下边界为基准换算', /** 上边界换算基准错会让裁剪框跳到容器外。 */ async () => {
    const { wrapper } = mountCropper({ aspectRatio: '1:1' });
    await wrapper.find('.cropper-image').trigger('load');

    await dragPoint(wrapper, 'n', { x: 0, y: -100 });

    // 放大到容器高度后按比例收敛并水平居中。
    expect(dimensionOf(wrapper)).toEqual([0, 62.5, 0, 62.5]);
  });

  it('拖拽左边把手时以右边界为基准换算', /** 左边界换算基准错会让裁剪框跳到容器外。 */ async () => {
    const { wrapper } = mountCropper({ aspectRatio: '1:1' });
    await wrapper.find('.cropper-image').trigger('load');

    await dragPoint(wrapper, 'w', { x: -100, y: 0 });

    // 宽度受容器宽度限制为 500 后按高度收敛为 375。
    expect(dimensionOf(wrapper)).toEqual([0, 62.5, 0, 62.5]);
  });

  it('拖拽上边把手越界时收敛到容器高度', /** 高度溢出会让裁剪框超出图片上边界。 */ async () => {
    const { wrapper } = mountCropper({ aspectRatio: '1:1' });
    await wrapper.find('.cropper-image').trigger('load');

    await dragPoint(wrapper, 'n', { x: 0, y: 300 });

    // 上边界下移后裁剪框变小并贴着下边界。
    expect(dimensionOf(wrapper)).toEqual([300, 212.5, 0, 212.5]);
  });
});

describe('裁剪器移动裁剪框', /** 移动只改位置不改尺寸。 */ () => {
  it('拖拽裁剪框内部整体平移', /** 平移时改变尺寸会让用户无法微调取景。 */ async () => {
    const { wrapper } = mountCropper();
    await wrapper.find('.cropper-image').trigger('load');

    await wrapper.find('.cropper-move-area').trigger('mousedown', {
      clientX: 100,
      clientY: 100,
    });
    document.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        clientX: 150,
        clientY: 130,
      }),
    );
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await nextTick();

    // 尺寸保持 426 x 301 不变，右边与下边被容器边界夹住。
    expect(dimensionOf(wrapper)).toEqual([67, 0, 7, 74]);
  });

  it('平移越界时贴住容器边界且尺寸不变', /** 越界未夹紧会让裁剪框移出图片。 */ async () => {
    const { wrapper } = mountCropper();
    await wrapper.find('.cropper-image').trigger('load');

    await wrapper.find('.cropper-move-area').trigger('mousedown', {
      clientX: 100,
      clientY: 100,
    });
    document.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        clientX: -5000,
        clientY: -5000,
      }),
    );
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await nextTick();

    expect(dimensionOf(wrapper)).toEqual([0, 74, 74, 0]);
  });

  it('鼠标抬起后结束拖拽状态', /** 不结束拖拽会让裁剪框继续跟着鼠标乱动。 */ async () => {
    const { wrapper } = mountCropper();
    await wrapper.find('.cropper-image').trigger('load');

    await wrapper.find('.cropper-point-e').trigger('mousedown', {
      clientX: 100,
      clientY: 100,
    });
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    document.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        clientX: 400,
        clientY: 100,
      }),
    );
    await nextTick();

    expect(dimensionOf(wrapper)).toEqual([37, 37, 37, 37]);
  });
});

describe('裁剪器导出图片', /** 导出映射决定裁下来的到底是不是用户框选的区域。 */ () => {
  it('按原图像素映射裁剪区域并导出二进制', /** 坐标系错位会裁到错误区域，这是最严重的可见故障。 */ async () => {
    const { api, wrapper } = mountCropper();
    await wrapper.find('.cropper-image').trigger('load');

    const pending = api.getCropImage();
    const image = ImageStub.instances.at(-1);
    image?.emitLoad();
    const blob = await pending;

    expect(blob).toBeInstanceOf(Blob);
    expect(canvasCalls.drawImage).toEqual([
      [image, 59, 39, 681, 521, 0, 0, 681, 521],
    ]);
    expect(canvasCalls.toBlob).toEqual([['image/jpeg', 0.92]]);
  });

  it('支持导出 base64 与自定义格式质量', /** 导出格式丢失会让业务方拿到无法预览的结果。 */ async () => {
    const { api, wrapper } = mountCropper();
    await wrapper.find('.cropper-image').trigger('load');

    const pending = api.getCropImage('image/png', 0.5, 'base64');
    const image = ImageStub.instances.at(-1);
    image?.emitLoad();
    const result = await pending;

    expect(result).toBe('data:image/png;base64,DUMMY');
    expect(canvasCalls.toDataURL).toEqual([['image/png', 0.5]]);
  });

  it('质量参数越界时收敛到 0 与 1', /** 越界质量会让浏览器导出接口抛错。 */ async () => {
    const { api, wrapper } = mountCropper();
    await wrapper.find('.cropper-image').trigger('load');

    const lowPending = api.getCropImage('image/jpeg', -5, 'base64');
    ImageStub.instances.at(-1)?.emitLoad();
    await lowPending;

    const highPending = api.getCropImage('image/jpeg', 5, 'base64');
    ImageStub.instances.at(-1)?.emitLoad();
    await highPending;

    expect(canvasCalls.toDataURL).toEqual([
      ['image/jpeg', 0],
      ['image/jpeg', 1],
    ]);
  });

  it('传入目标尺寸时按目标尺寸绘制画布', /** 忽略目标尺寸会让业务方拿到错误分辨率。 */ async () => {
    const { api, wrapper } = mountCropper();
    await wrapper.find('.cropper-image').trigger('load');

    const pending = api.getCropImage('image/jpeg', 0.92, 'blob', 120, 80);
    const image = ImageStub.instances.at(-1);
    image?.emitLoad();
    await pending;

    expect(canvasCalls.drawImage.at(-1)?.slice(5)).toEqual([0, 0, 120, 80]);
    expect(canvasCalls.scale).toEqual([[1, 1]]);
  });

  it('导出失败时回退为空 Blob', /** 画布导出失败时返回 null 会让调用方崩溃。 */ async () => {
    const { api, wrapper } = mountCropper();
    await wrapper.find('.cropper-image').trigger('load');
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
      /**
       * 模拟导出失败：真实浏览器会回调 null。
       * @param callback 接收导出结果的回调。
       */
      (callback: BlobCallback) => {
        callback(null);
      },
    );

    const pending = api.getCropImage('image/png');
    const image = ImageStub.instances.at(-1);
    image?.emitLoad();
    const blob = await pending;

    expect(blob).toBeInstanceOf(Blob);
    expect((blob as Blob).type).toBe('image/png');
  });

  it('图片加载失败时导出被拒绝', /** 加载失败仍继续导出会让调用方拿到空白图片。 */ async () => {
    const { api, wrapper } = mountCropper();
    await wrapper.find('.cropper-image').trigger('load');

    const pending = api.getCropImage();
    const image = ImageStub.instances.at(-1);
    image?.emitError();

    await expect(pending).rejects.toThrow('图片加载失败: DUMMY-加载失败');
  });

  it('图片加载超时后导出被拒绝', /** 不设超时会让导出一直挂起，调用方无法提示用户。 */ async () => {
    vi.useFakeTimers();
    const { api, wrapper } = mountCropper();
    await wrapper.find('.cropper-image').trigger('load');

    const pending = api.getCropImage();
    const assertion =
      expect(pending).rejects.toThrow('图片加载超时，超时时间10秒');
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    vi.useRealTimers();
  });

  it('导出接口抛错时记录错误并返回空结果', /** 导出接口异常未兜底会让业务流程直接被异常中断。 */ async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(/** 忽略错误输出，仅记录调用。 */ () => {});
    const { api, wrapper } = mountCropper();
    await wrapper.find('.cropper-image').trigger('load');
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(
      /** 模拟画布被跨域图片污染后导出抛错。 */ () => {
        throw new Error('DUMMY-画布被污染');
      },
    );

    const pending = api.getCropImage('image/jpeg', 0.92, 'base64');
    ImageStub.instances.at(-1)?.emitLoad();

    await expect(pending).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith('图片导出失败:', expect.any(Error));
  });

  it('图片地址为空时直接返回', /** 空地址继续导出会让画布绘制空白结果。 */ async () => {
    const wrapper = mount(Cropper, { props: { img: '' } });
    const api = wrapper.vm as unknown as CropperApi;

    await expect(api.getCropImage()).resolves.toBeUndefined();
  });

  it('取不到画布上下文时直接返回', /** 不支持画布的环境必须安全退出而不是抛错。 */ async () => {
    vi.spyOn(
      HTMLCanvasElement.prototype,
      'getContext' as const,
    ).mockImplementation(/** 模拟不支持 2D 画布的环境。 */ () => null);
    const { api, wrapper } = mountCropper();
    await wrapper.find('.cropper-image').trigger('load');

    const pending = api.getCropImage();
    const image = ImageStub.instances.at(-1);
    image?.emitLoad();

    await expect(pending).resolves.toBeUndefined();
  });

  it('裁剪区域非法时直接返回', /** 裁剪尺寸非法仍导出会让调用方拿到空图。 */ async () => {
    const { api, wrapper } = mountCropper();
    await wrapper.find('.cropper-image').trigger('load');
    // 容器矩形退化为 0 时裁剪宽高换算为非法值，必须直接返回。
    const container = wrapper.find('.cropper-container').element;
    Object.defineProperty(container, 'getBoundingClientRect', {
      configurable: true,
      value: emptyRect,
    });

    const pending = api.getCropImage();
    const image = ImageStub.instances.at(-1);
    image?.emitLoad();

    await expect(pending).resolves.toBeUndefined();
  });

  it('跨域图片设置匿名跨域属性', /** 跨域图片未设置匿名会让画布被污染而无法导出。 */ async () => {
    const { api, wrapper } = mountCropper({
      img: 'https://DUMMY-cropper.example.com/picture.png',
    });
    await wrapper.find('.cropper-image').trigger('load');

    const pending = api.getCropImage();
    const image = ImageStub.instances.at(-1);
    image?.emitLoad();
    await pending;

    expect(image?.crossOrigin).toBe('anonymous');
  });

  it('同源图片不设置跨域属性', /** 同源图片设置跨域会多一次无谓的协商。 */ async () => {
    const { api, wrapper } = mountCropper({ img: '/DUMMY-local.png' });
    await wrapper.find('.cropper-image').trigger('load');

    const pending = api.getCropImage();
    const image = ImageStub.instances.at(-1);
    image?.emitLoad();
    await pending;

    expect(image?.crossOrigin).toBe('');
  });

  it('地址非法时跳过跨域设置继续导出', /** 解析失败就中断会让带端口等地址无法导出。 */ async () => {
    const { api, wrapper } = mountCropper({ img: 'https://' });
    await wrapper.find('.cropper-image').trigger('load');

    const pending = api.getCropImage();
    const image = ImageStub.instances.at(-1);
    image?.emitLoad();
    await pending;

    expect(image?.crossOrigin).toBe('');
    expect(canvasCalls.drawImage).toHaveLength(1);
  });

  it('图片已缓存时挂载即完成初始化', /** 缓存图片不初始化会让裁剪框永远不出现。 */ async () => {
    // 模拟浏览器缓存命中：图片元素在挂载时就已经是加载完成状态。
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(
      true,
    );
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(
      IMAGE_WIDTH,
    );
    vi.spyOn(
      HTMLImageElement.prototype,
      'naturalHeight',
      'get',
    ).mockReturnValue(IMAGE_HEIGHT);

    const { wrapper } = mountCropper();
    await nextTick();

    expect(wrapper.find('.cropper-mask').attributes('style')).toContain(
      'display: block',
    );
    expect(dimensionOf(wrapper)).toEqual([37, 37, 37, 37]);
  });

  it('卸载后解绑文档上的拖拽监听', /** 卸载未解绑会让已关闭的弹窗继续响应鼠标。 */ async () => {
    const { wrapper } = mountCropper();
    await wrapper.find('.cropper-image').trigger('load');
    const removeListener = vi.spyOn(document, 'removeEventListener');

    wrapper.unmount();

    expect(removeListener).toHaveBeenCalledWith(
      'mousemove',
      expect.any(Function),
    );
    expect(removeListener).toHaveBeenCalledWith(
      'mouseup',
      expect.any(Function),
    );
  });
});
