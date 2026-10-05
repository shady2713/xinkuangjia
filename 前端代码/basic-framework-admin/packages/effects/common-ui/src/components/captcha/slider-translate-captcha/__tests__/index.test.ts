/**
 * 拼图滑动验证码（common-ui 的 captcha/slider-translate-captcha）真实行为回归。
 *
 * 组件在 canvas 上随机抠出一块拼图，用户拖动滑块把拼图块水平移动到缺口，松手时位移差在容差内
 * 判定通过并抛出耗时与凭据，超出容差则把拼图块拉回起点并提示重试；点击图片可以复位重新出题。
 * 随机缺口不重新生成会让重放同一张图就能通过，位移差判断写反会让用户永远验证不过，复位逻辑
 * 失效会让失败后无法重试，通过结果未回写 v-model 会让父级拿不到验证状态。
 *
 * 用例真实挂载组件、真实派发按下/移动/松开鼠标序列，并真实调用组件注册到画布上的点击复位。
 * canvas 2D 上下文与图片加载是本组件依赖的两个浏览器外部边界：happy-dom 不实现画布也不加载
 * 图片，因此这里按浏览器契约提供可记录的画布上下文，并由用例在合适的时机触发图片加载完成。
 */
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { $t } from '@vben/locales';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SliderTranslateCaptcha from '../index.vue';

/** 画布宽度，组件默认值。 */
const CANVAS_WIDTH = 420;

/** 画布高度，组件默认值。 */
const CANVAS_HEIGHT = 280;

/** 固定随机数后抠出的拼图缺口横坐标：等于取值的下界。 */
const PIECE_X = 42 + 2 * 10;

/** 容差内的一次拖动位移，与缺口横坐标相同，位移差为 0。 */
const MATCH_MOVE_X = PIECE_X;

/** 远离缺口的一次拖动位移，位移差远超容差。 */
const MISS_MOVE_X = 300;

/** 画布上下文替身：每个绘制入口都是可断言的替身函数。 */
type ContextStub = Record<string, ReturnType<typeof vi.fn>>;

/** 图片加载事件监听器签名。 */
type ImageLoadListener = () => void;

/** 记录本次用例创建的全部画布上下文替身。 */
let contexts: ContextStub[] = [];

/** 图片替身：组件通过 src 与 load 事件驱动出题，这里由用例控制加载时机。 */
class ImageStub {
  /** 本次用例创建的全部图片替身。 */
  static instances: ImageStub[] = [];

  /** 跨域属性；组件对非同源图片会设置为 anonymous。 */
  crossOrigin = '';

  /** 原始图片宽度，用于把渲染尺寸换算回原始像素。 */
  height = CANVAS_HEIGHT;

  /** 组件登记的事件监听器，按事件名分组。 */
  listeners = new Map<string, Set<ImageLoadListener>>();

  /** 图片地址，组件据此加载待抠图的底图。 */
  src = '';

  /** 原始图片宽度，用于把渲染尺寸换算回原始像素。 */
  width = CANVAS_WIDTH;

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
 * @returns 每个绘制入口都被记录的上下文替身。
 */
function createContext(): ContextStub {
  return {
    arc: vi.fn(),
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    clip: vi.fn(),
    drawImage: vi.fn(),
    fill: vi.fn(),
    getImageData: vi.fn(
      /** 返回一片与请求尺寸无关的像素数据，组件只负责把它放回画布。 */ () => ({
        data: new Uint8ClampedArray(4),
        height: 1,
        width: 1,
      }),
    ),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    putImageData: vi.fn(),
    stroke: vi.fn(),
  };
}

/**
 * 取滑块按钮元素。
 * @param wrapper 已挂载的验证码包装器。
 * @returns 滑块按钮包装器。
 */
function actionWrapper(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('[name="captcha-action"]');
}

/**
 * 取滑块轨道元素，拖动过程中的移动与松开事件都派发在它上面。
 * @param wrapper 已挂载的验证码包装器。
 * @returns 轨道元素包装器。
 */
function barWrapper(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('.h-10');
}

/**
 * 取拼图块画布（第二个 canvas）。
 * @param wrapper 已挂载的验证码包装器。
 * @returns 拼图块画布包装器。
 * @throws 拼图块画布未渲染时抛错，说明出题模板已破损，用例不应继续在假象上断言。
 */
function pieceCanvasWrapper(wrapper: ReturnType<typeof mount>) {
  const canvas = wrapper.findAll('canvas')[1];
  if (!canvas) {
    throw new Error('拼图块画布未渲染，验证码出题模板异常');
  }
  return canvas;
}

/**
 * 触发一次图片加载完成，让组件真正走到抠图流程。
 */
function loadImage() {
  ImageStub.instances.at(-1)?.emitLoad();
}

/**
 * 完成一次完整的按下、拖动与松开。
 * @param wrapper 已挂载的验证码包装器。
 * @param movePageX 拖动到的页面横坐标，相对按下位置的位移即由它决定。
 */
async function dragTo(wrapper: ReturnType<typeof mount>, movePageX: number) {
  await actionWrapper(wrapper).trigger('mousedown', { pageX: 0 });
  await barWrapper(wrapper).trigger('mousemove', { pageX: movePageX });
  await barWrapper(wrapper).trigger('mouseup', { pageX: movePageX });
}

beforeEach(
  /** 固定随机数、登记画布与图片替身，让出题结果与加载时机都可预期。 */ () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    contexts = [];
    ImageStub.instances = [];
    vi.stubGlobal('Image', ImageStub);
    vi.spyOn(
      HTMLCanvasElement.prototype,
      'getContext' as const,
    ).mockImplementation(
      /** 按浏览器契约返回可记录的 2D 上下文替身，替代 happy-dom 缺失的画布实现。 */ () => {
        const context = createContext();
        contexts.push(context);
        return context as unknown as CanvasRenderingContext2D;
      },
    );
  },
);

afterEach(
  /** 还原全局替身与随机数，避免影响其它用例。 */ () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  },
);

describe('拼图验证码渲染', /** 画布尺寸与提示决定用户能否看懂要做什么。 */ () => {
  it('按传入尺寸渲染两块画布与默认提示', /** 画布尺寸错会让缺口与背景错位。 */ () => {
    const wrapper = mount(SliderTranslateCaptcha, {
      props: { src: 'DUMMY-puzzle.png' },
    });
    const canvases = wrapper.findAll('canvas');

    expect(canvases).toHaveLength(2);
    expect(canvases[0]?.attributes('width')).toBe(String(CANVAS_WIDTH));
    expect(canvases[0]?.attributes('height')).toBe(String(CANVAS_HEIGHT));
    expect(wrapper.text()).toContain(
      $t('ui.captcha.sliderTranslateDefaultTip'),
    );
  });

  it('未传画布尺寸时使用组件默认值', /** 尺寸缺省值丢失会让画布退化到 0 像素而看不见。 */ () => {
    const wrapper = mount(SliderTranslateCaptcha, {
      props: {
        canvasHeight: 200,
        canvasWidth: 300,
        defaultTip: 'DUMMY-拖动拼图',
      },
    });
    const canvases = wrapper.findAll('canvas');

    expect(canvases[0]?.attributes('width')).toBe('300');
    expect(canvases[1]?.attributes('height')).toBe('200');
    expect(wrapper.text()).toContain('DUMMY-拖动拼图');
  });

  it('透传调用方插槽给滑块', /** 插槽不转发会让业务方无法定制滑块文案与图标。 */ () => {
    const wrapper = mount(SliderTranslateCaptcha, {
      slots: {
        actionIcon: '<i class="DUMMY-action-icon"></i>',
        text: '<i class="DUMMY-slider-text"></i>',
      },
    });

    expect(wrapper.find('.DUMMY-action-icon').exists()).toBe(true);
    expect(wrapper.find('.DUMMY-slider-text').exists()).toBe(true);
  });
});

describe('拼图验证码出题', /** 抠图与随机缺口决定验证码是否可解且不可猜。 */ () => {
  it('挂载后按非同源图片准备底图', /** 未设置跨域会让画布被污染而无法取像素。 */ () => {
    mount(SliderTranslateCaptcha, {
      props: { src: 'https://DUMMY-captcha.example.com/puzzle.png' },
    });

    const image = ImageStub.instances.at(-1);
    expect(image?.src).toBe('https://DUMMY-captcha.example.com/puzzle.png');
    expect(image?.crossOrigin).toBe('Anonymous');
  });

  it('图片加载完成后随机抠图并重置拼图块位置', /** 不随机缺口会让同一张图每次都在同一位置。 */ async () => {
    const wrapper = mount(SliderTranslateCaptcha, {
      props: { src: 'DUMMY-puzzle.png' },
    });

    loadImage();
    await nextTick();

    // 背景画布用填充画出缺口，拼图块画布用裁剪取出同一块形状，两者各自描边一次。
    expect(contexts[0]?.arc).toHaveBeenCalledTimes(3);
    expect(contexts[0]?.fill).toHaveBeenCalledTimes(1);
    expect(contexts[0]?.drawImage).toHaveBeenCalledTimes(1);
    expect(contexts[1]?.clip).toHaveBeenCalledTimes(1);
    expect(contexts[1]?.stroke).toHaveBeenCalledTimes(1);
    expect(contexts[1]?.getImageData).toHaveBeenCalled();
    expect(contexts[1]?.putImageData).toHaveBeenCalledTimes(1);
    expect(pieceCanvasWrapper(wrapper).attributes('style')).toContain(
      'left: 0px',
    );
  });

  it('画布不可用时出题流程安全退出', /** 取不到画布上下文时抛错会让整个验证码挂载失败。 */ async () => {
    vi.spyOn(
      HTMLCanvasElement.prototype,
      'getContext' as const,
    ).mockImplementation(
      /** 模拟不支持 2D 画布的环境，组件必须安全退出而不是抛错。 */ () => null,
    );
    const wrapper = mount(SliderTranslateCaptcha, {
      props: { src: 'DUMMY-puzzle.png' },
    });

    loadImage();
    await nextTick();
    await pieceCanvasWrapper(wrapper).trigger('click');

    // 取不到画布上下文时连底图都不创建，点击复位同样安全退出。
    expect(ImageStub.instances).toHaveLength(0);
    expect(pieceCanvasWrapper(wrapper).attributes('style')).toContain(
      'left: 0px',
    );
  });
});

describe('拼图验证码拖动与校验', /** 位移换算与容差判定决定用户能否验证通过。 */ () => {
  it('拖动时拼图块跟随位移并隐藏默认提示', /** 拼图块不跟手会让用户无法对齐缺口。 */ async () => {
    const wrapper = mount(SliderTranslateCaptcha, {
      props: { defaultTip: 'DUMMY-按住拖动', src: 'DUMMY-puzzle.png' },
    });
    loadImage();
    await nextTick();
    expect(wrapper.text()).toContain('DUMMY-按住拖动');

    await actionWrapper(wrapper).trigger('mousedown', { pageX: 0 });
    await barWrapper(wrapper).trigger('mousemove', { pageX: 100 });

    expect(pieceCanvasWrapper(wrapper).attributes('style')).toContain(
      'left: 100px',
    );
    expect(wrapper.text()).not.toContain('DUMMY-按住拖动');
  });

  it('容差内松手判定通过并回传耗时', /** 判定不通过会让用户永远拿不到凭据，耗时格式错会让业务方拿到脏数据。 */ async () => {
    const wrapper = mount(SliderTranslateCaptcha, {
      props: { src: 'DUMMY-puzzle.png' },
    });
    loadImage();
    await nextTick();

    await dragTo(wrapper, MATCH_MOVE_X);

    const success = wrapper.emitted('success')?.[0]?.[0] as {
      isPassing: boolean;
      time: string;
    };
    expect(success.isPassing).toBe(true);
    expect(success.time).toMatch(/^\d+\.\d$/);
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([true]);
    expect(wrapper.text()).toContain(
      $t('ui.captcha.sliderTranslateSuccessTip', [success.time]),
    );
  });

  it('超出容差松手把拼图块拉回起点并提示失败', /** 失败后不归位会让用户下一次从错误位置开始。 */ async () => {
    const wrapper = mount(SliderTranslateCaptcha, {
      props: { src: 'DUMMY-puzzle.png' },
    });
    loadImage();
    await nextTick();

    await dragTo(wrapper, MISS_MOVE_X);

    expect(pieceCanvasWrapper(wrapper).attributes('style')).toContain(
      'left: 0px',
    );
    expect(wrapper.text()).toContain($t('ui.captcha.sliderTranslateFailTip'));
  });

  it('容差传 0 时按默认容差兜底', /** 容差为 0 会让用户必须像素级对齐，兜底缺失会让验证无法完成。 */ async () => {
    const wrapper = mount(SliderTranslateCaptcha, {
      props: { diffDistance: 0, src: 'DUMMY-puzzle.png' },
    });
    loadImage();
    await nextTick();

    await dragTo(wrapper, MATCH_MOVE_X);

    expect(wrapper.emitted('success')).toHaveLength(1);
  });

  it('点击画布复位并重新出题', /** 不能复位会让用户在一次失败后无法重试。 */ async () => {
    const wrapper = mount(SliderTranslateCaptcha, {
      props: { src: 'DUMMY-puzzle.png' },
    });
    loadImage();
    await nextTick();
    await dragTo(wrapper, MISS_MOVE_X);
    expect(wrapper.text()).toContain($t('ui.captcha.sliderTranslateFailTip'));

    await pieceCanvasWrapper(wrapper).trigger('click');
    await nextTick();

    expect(wrapper.text()).not.toContain(
      $t('ui.captcha.sliderTranslateFailTip'),
    );
    // 复位会重新创建图片并再次出题。
    expect(ImageStub.instances).toHaveLength(2);
  });

  it('已通过后点击画布可以重新验证', /** 通过后再点画布必须恢复可拖动状态，否则用户无法重新校验。 */ async () => {
    const wrapper = mount(SliderTranslateCaptcha, {
      props: { src: 'DUMMY-puzzle.png' },
    });
    loadImage();
    await nextTick();
    await dragTo(wrapper, MATCH_MOVE_X);
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([true]);

    await wrapper.findAll('canvas')[0]?.trigger('click');

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false]);
  });
});
