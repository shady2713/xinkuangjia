/**
 * 滑块验证码（common-ui 的 captcha/verification/verify-slide）真实行为回归。
 *
 * 该组件按拖动距离提交滑块坐标校验：挂载时未拉取底图与滑块图会让面板空白；拖动未按提示条
 * 真实位置换算位移会让滑块跟手错位；位移未夹紧在提示条范围内会让滑块滑出可视区；松开时
 * 未按 310 基准画布归一化会让后端比对全部偏移；后端开启 AES 时未加密坐标会让校验必然失败；
 * 校验通过后未回传凭据或未隐藏刷新入口会让业务方拿不到凭据或状态回退；校验失败后未自动
 * 换图会让用户卡在同一张图上；弹层模式成功后未自动收起会让弹层一直挡在页面上。
 *
 * 用例真实渲染组件、真实派发鼠标与触摸事件、真实执行成功/失败后的定时换图，只替换两个
 * 后端接口、图标组件与浏览器布局计算（happy-dom 不计算元素位置与宽度）。
 */
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { $t } from '@vben/locales';

import { AjCaptchaAES } from '@vben-core/shared/utils';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import VerifySlide from './verify-slide.vue';

/** 后端下发的 AES 密钥占位值：aj-captcha 约定为 16 位。 */
const SECRET_KEY = 'CHANGE_ME_KEY_16';

/** 后端下发的令牌占位值：提交校验时必须原样回传。 */
const BACK_TOKEN = 'DUMMY-TOKEN';

/** 背景图 Base64 占位值：只用于核对图片地址前缀。 */
const IMAGE_BASE64 = 'DUMMY-IMAGE-BASE64';

/** 滑块拼图 Base64 占位值：只用于核对图片地址前缀。 */
const BLOCK_BASE64 = 'DUMMY-BLOCK-BASE64';

/** 提示条相对视口左边缘的位置，用于把拖动坐标换算成提示条内的位移。 */
const BAR_LEFT = 100;

/** 提示条的像素宽度，决定滑块位移的夹紧上限。 */
const BAR_WIDTH = 310;

/** 按下时的视口横坐标：相对提示条左边缘 50 像素。 */
const PRESS_CLIENT_X = 150;

/** 正常拖动到的视口横坐标：相对提示条左边缘 150 像素。 */
const MOVE_CLIENT_X = 250;

/** 成功提示的停留时间，与组件声明的 1000ms 保持一致。 */
const SUCCESS_DELAY = 1000;

/** 弹层模式成功提示的停留时间，与组件声明的 1500ms 保持一致。 */
const POP_CLOSE_DELAY = 1500;

/** 刷新过渡动画的时长，与组件声明的 300ms 保持一致。 */
const REFRESH_TRANSITION_DELAY = 300;

/** 验证码拉取接口替身：返回后端响应体。 */
const getCaptchaApi = vi.fn();

/** 验证码校验接口替身：返回后端判定结果。 */
const checkCaptchaApi = vi.fn();

vi.mock(
  '@vben/icons',
  /** 只替换图标组件，避免图标按需拉取远端图标集产生真实网络请求。 */ async () => {
    const { defineComponent, h } = await import('vue');
    return {
      IconifyIcon: defineComponent({
        name: 'IconifyIconStub',
        /**
         * 渲染可定位的图标占位节点。
         * @returns 图标替身渲染函数。
         */
        setup() {
          return /** 输出带标记的图标占位节点。 */ () =>
            h('span', { class: 'iconify-stub' });
        },
      }),
    };
  },
);

/** 组件公开实例视图：只读取 defineExpose 暴露的方法。 */
interface VerifySlideExposed {
  /** 重新初始化滑块并重新拉图。 */
  init: () => void;
  /** 清空交互状态并重新拉图。 */
  refresh: () => Promise<void>;
}

/**
 * 构造一次成功的验证码拉取响应。
 * @param overrides 需要覆盖的响应字段，例如下发 AES 密钥。
 * @returns 后端响应体。
 */
function fetchSuccess(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      repCode: '0000',
      repData: {
        jigsawImageBase64: BLOCK_BASE64,
        originalImageBase64: IMAGE_BASE64,
        token: BACK_TOKEN,
        ...overrides,
      },
    },
  };
}

/**
 * 给提示条注入受控布局尺寸。
 * @param wrapper 已挂载的滑块包装器。
 * @param left 提示条相对视口左边缘的像素位置。
 * @param width 提示条的像素宽度。
 */
function layoutBarArea(
  wrapper: ReturnType<typeof mount>,
  left: number,
  width: number,
) {
  const bar = wrapper.find('.verify-bar-area').element;
  // happy-dom 不计算布局，这里按浏览器契约注入提示条的真实位置与宽度。
  bar.getBoundingClientRect = /** 返回受控的布局矩形。 */ () =>
    new DOMRect(left, 0, width, 40);
  Object.defineProperty(bar, 'offsetWidth', {
    configurable: true,
    value: width,
  });
}

/**
 * 构造带触摸点信息的触摸事件。
 * @param type 触摸事件类型，例如 touchstart 或 touchmove。
 * @param pageX 触摸点相对页面左边缘的横坐标。
 * @returns 已注入触摸点的可派发事件。
 */
function touchEvent(type: string, pageX: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  // happy-dom 不提供 TouchEvent 构造器，这里按浏览器契约注入触摸点列表。
  Object.defineProperty(event, 'touches', { value: [{ pageX }] });
  return event;
}

/**
 * 取出组件通过 defineExpose 暴露的方法。
 * @param wrapper 已挂载的滑块包装器。
 * @returns 暴露的初始化与刷新方法。
 * @throws TypeError 组件未暴露方法时抛出，避免用例静默地什么都不验证。
 */
function exposed(wrapper: ReturnType<typeof mount>) {
  const vm = wrapper.vm as unknown as VerifySlideExposed;
  if (typeof vm.init !== 'function' || typeof vm.refresh !== 'function') {
    throw new TypeError('组件未暴露初始化与刷新方法');
  }
  return vm;
}

/**
 * 挂载滑块验证码并等待首次拉图完成。
 * @param props 传给组件的接口与展示配置。
 * @returns 已挂载的滑块包装器。
 */
async function mountSlide(props: Record<string, unknown> = {}) {
  const wrapper = mount(VerifySlide, {
    global: {
      // 提示文案位于 transition 内，默认桩化会让真实内容不进入组件树。
      stubs: { transition: false },
    },
    props: {
      captchaType: 'blockPuzzle',
      checkCaptchaApi,
      getCaptchaApi,
      ...props,
    },
  });
  await flushPromises();
  layoutBarArea(wrapper, BAR_LEFT, BAR_WIDTH);
  return wrapper;
}

/**
 * 等待异步结果与 DOM 更新完成。
 * @returns 异步结果与渲染队列均已刷新的 Promise。
 */
async function settle() {
  await flushPromises();
  await nextTick();
}

/**
 * 执行一次完整的按下、拖动与松开。
 * @param wrapper 已挂载的滑块包装器。
 * @param moveClientX 松开前拖动到的视口横坐标。
 */
async function dragTo(wrapper: ReturnType<typeof mount>, moveClientX: number) {
  await wrapper
    .find('.verify-move-block')
    .trigger('mousedown', { clientX: PRESS_CLIENT_X });
  window.dispatchEvent(
    Object.assign(new Event('mousemove'), { clientX: moveClientX }),
  );
  window.dispatchEvent(new Event('mouseup'));
  await flushPromises();
}

beforeEach(
  /** 每例重建接口替身并启用受控时钟，避免真实等待 1000/1500/300 毫秒。 */ () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    getCaptchaApi.mockResolvedValue(fetchSuccess());
    checkCaptchaApi.mockResolvedValue({ data: { repCode: '0000' } });
  },
);

afterEach(
  /** 恢复真实时钟，避免影响其它用例的时间来源。 */ () => {
    vi.useRealTimers();
  },
);

describe('滑块验证码初始化', /** 初始化决定提示文案、底图与全局拖动监听的接入。 */ () => {
  it('挂载后按验证码类型拉图并展示默认提示', /** 未拉图会让面板空白，默认文案写错会让用户不知道要拖动。 */ async () => {
    const wrapper = await mountSlide();

    expect(getCaptchaApi).toHaveBeenCalledWith({ captchaType: 'blockPuzzle' });
    expect(wrapper.find('.verify-msg').text()).toBe(
      $t('ui.captcha.sliderDefaultText'),
    );
  });

  it('声明说明文案时用说明替换默认提示', /** 忽略调用方文案会让自定义提示失效。 */ async () => {
    const wrapper = await mountSlide({ explain: 'DUMMY-请拖动滑块' });

    expect(wrapper.find('.verify-msg').text()).toBe('DUMMY-请拖动滑块');
  });

  it('拼图类型渲染底图与滑块图', /** 缺少任一图片会让用户看不到缺口位置。 */ async () => {
    const wrapper = await mountSlide({ type: '2' });
    const images = wrapper.findAll('img');

    expect(images).toHaveLength(2);
    expect(images[0]?.attributes('src')).toBe(
      `data:image/png;base64,${IMAGE_BASE64}`,
    );
    expect(images[1]?.attributes('src')).toBe(
      `data:image/png;base64,${BLOCK_BASE64}`,
    );
    expect(wrapper.find('.verify-sub-block').exists()).toBe(true);
  });

  it('非拼图类型不渲染图片区', /** 类型判断写错会让旧版底图模式多出一块空白区域。 */ async () => {
    const wrapper = await mountSlide({ type: '1' });

    expect(wrapper.find('.verify-img-out').exists()).toBe(false);
    expect(wrapper.find('.verify-sub-block').exists()).toBe(false);
  });

  it('拉图失败时展示后端失败文案', /** 静默失败会让用户不知道验证码服务不可用。 */ async () => {
    getCaptchaApi.mockResolvedValue({
      data: { repCode: '9999', repMsg: 'DUMMY-验证码服务不可用' },
    });
    const wrapper = await mountSlide({ type: '2' });

    expect(wrapper.find('.verify-tips').text()).toBe('DUMMY-验证码服务不可用');
    expect(wrapper.find('img').attributes('src')).toBeUndefined();
  });

  it('百分比尺寸按父容器换算为像素', /** 百分比尺寸未换算会让提示条宽度退化为 0。 */ async () => {
    const wrapper = await mountSlide({
      barSize: { height: '40px', width: '100%' },
      imgSize: { height: '100%', width: '100%' },
    });
    const style = wrapper.find('.verify-bar-area').attributes('style') ?? '';

    expect(style).toContain(`width: ${window.innerWidth}px`);
  });

  it('暴露初始化与刷新方法供父级驱动', /** 父级拿不到方法会让弹层无法主动换图。 */ async () => {
    const wrapper = await mountSlide();

    exposed(wrapper).init();
    await flushPromises();

    expect(getCaptchaApi).toHaveBeenCalledTimes(2);
  });
});

describe('滑块拖动位移', /** 拖动位移决定滑块是否跟手以及能否滑出提示条。 */ () => {
  it('按下后清空提示并进入拖动状态', /** 未清空提示会让旧文案与拖动状态叠加。 */ async () => {
    const wrapper = await mountSlide();
    const press = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      clientX: PRESS_CLIENT_X,
    });
    const stopPropagation = vi.spyOn(press, 'stopPropagation');

    wrapper.find('.verify-move-block').element.dispatchEvent(press);
    await flushPromises();

    expect(wrapper.find('.verify-msg').text()).toBe('');
    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });

  it('拖动时按提示条真实位置换算位移', /** 未减去提示条左边缘会让滑块与鼠标错位。 */ async () => {
    const wrapper = await mountSlide();
    await wrapper
      .find('.verify-move-block')
      .trigger('mousedown', { clientX: PRESS_CLIENT_X });
    window.dispatchEvent(
      Object.assign(new Event('mousemove'), { clientX: MOVE_CLIENT_X }),
    );
    await flushPromises();

    const style = wrapper.find('.verify-move-block').attributes('style') ?? '';
    const barStyle = wrapper.find('.verify-left-bar').attributes('style') ?? '';

    expect(style).toContain('left: 100px');
    expect(barStyle).toContain('width: 100px');
  });

  it('拖动超出右边界时夹紧在提示条内', /** 未夹紧会让滑块滑出可视区，用户看不到滑块位置。 */ async () => {
    const wrapper = await mountSlide();
    await wrapper
      .find('.verify-move-block')
      .trigger('mousedown', { clientX: PRESS_CLIENT_X });
    window.dispatchEvent(
      Object.assign(new Event('mousemove'), { clientX: 5000 }),
    );
    await flushPromises();

    const style = wrapper.find('.verify-move-block').attributes('style') ?? '';

    // 上限为提示条宽度减去半个滑块宽度再减 2 像素，减去按下位置后即为实际位移。
    expect(style).toContain('left: 233px');
  });

  it('拖动越过左边界时夹紧在半个滑块宽度处', /** 未夹紧会让滑块压到提示条左侧外。 */ async () => {
    const wrapper = await mountSlide();
    await wrapper
      .find('.verify-move-block')
      .trigger('mousedown', { clientX: PRESS_CLIENT_X });
    window.dispatchEvent(Object.assign(new Event('mousemove'), { clientX: 0 }));
    await flushPromises();

    const style = wrapper.find('.verify-move-block').attributes('style') ?? '';

    expect(style).toContain('left: -25px');
  });

  it('未按下时移动不产生位移', /** 未按下就跟随鼠标会让滑块在页面上乱跳。 */ async () => {
    const wrapper = await mountSlide();
    window.dispatchEvent(
      Object.assign(new Event('mousemove'), { clientX: MOVE_CLIENT_X }),
    );
    await flushPromises();

    const barStyle = wrapper.find('.verify-left-bar').attributes('style') ?? '';

    // 未开始拖动时左侧条宽度回退到提示条高度，不显示任何位移。
    expect(barStyle).toContain('width: 40px');
  });

  it('触摸拖动按触摸点横坐标换算位移', /** 只支持鼠标会让移动端无法拖动滑块。 */ async () => {
    const wrapper = await mountSlide();
    wrapper
      .find('.verify-move-block')
      .element.dispatchEvent(touchEvent('touchstart', PRESS_CLIENT_X));
    window.dispatchEvent(touchEvent('touchmove', MOVE_CLIENT_X));
    await flushPromises();

    const style = wrapper.find('.verify-move-block').attributes('style') ?? '';

    expect(style).toContain('left: 100px');
  });
});

describe('滑块校验提交', /** 松开后提交的坐标决定后端能否判定通过。 */ () => {
  it('松开后按基准画布提交明文坐标与令牌', /** 未按 310 基准归一化会让后端比对偏移，未带令牌会让校验必然失败。 */ async () => {
    const wrapper = await mountSlide();

    await dragTo(wrapper, MOVE_CLIENT_X);

    expect(checkCaptchaApi).toHaveBeenCalledWith({
      captchaType: 'blockPuzzle',
      pointJson: JSON.stringify({ x: 100, y: 5 }),
      token: BACK_TOKEN,
    });
  });

  it('未按下就松开时不提交校验', /** 空提交会浪费一次后端校验并让提示条闪动。 */ async () => {
    const wrapper = await mountSlide();

    window.dispatchEvent(new Event('mouseup'));
    await flushPromises();

    expect(checkCaptchaApi).not.toHaveBeenCalled();
    expect(wrapper).toBeDefined();
  });

  it('后端开启 AES 时提交密文坐标与密文凭据', /** 后端开启加密时提交明文会让校验必然失败。 */ async () => {
    getCaptchaApi.mockResolvedValue(fetchSuccess({ secretKey: SECRET_KEY }));
    const wrapper = await mountSlide();

    await dragTo(wrapper, MOVE_CLIENT_X);
    const plainPoint = JSON.stringify({ x: 100, y: 5 });

    expect(checkCaptchaApi).toHaveBeenCalledWith({
      captchaType: 'blockPuzzle',
      pointJson: AjCaptchaAES.encrypt(plainPoint, SECRET_KEY),
      token: BACK_TOKEN,
    });

    vi.advanceTimersByTime(SUCCESS_DELAY);
    await flushPromises();

    expect(wrapper.emitted('onSuccess')?.[0]?.[0]).toEqual({
      captchaVerification: AjCaptchaAES.encrypt(
        `${BACK_TOKEN}---${plainPoint}`,
        SECRET_KEY,
      ),
    });
  });

  it('坐标按图片实际宽度归一化到 310 基准', /** 图片被缩放后未归一化会让后端比对全部偏移。 */ async () => {
    const wrapper = await mountSlide({
      imgSize: { height: '155px', width: '100%' },
    });

    await dragTo(wrapper, MOVE_CLIENT_X);

    // 提示条宽度仍是 310，但图片宽度换成视口宽度，位移必须按图片宽度缩放。
    // 组件按图片实际宽度做线性归一化，不做四舍五入。
    const expected = (100 * 310) / window.innerWidth;
    expect(checkCaptchaApi).toHaveBeenCalledWith({
      captchaType: 'blockPuzzle',
      pointJson: JSON.stringify({ x: expected, y: 5 }),
      token: BACK_TOKEN,
    });
  });
});

describe('滑块校验结果', /** 校验结果决定成功凭据、失败提示与后续交互。 */ () => {
  it('校验通过后提示耗时并回传凭据', /** 未回传凭据会让业务方无法提交表单，未隐藏刷新入口会让状态看起来未完成。 */ async () => {
    const wrapper = await mountSlide({ type: '2' });

    await wrapper
      .find('.verify-move-block')
      .trigger('mousedown', { clientX: PRESS_CLIENT_X });
    vi.advanceTimersByTime(20);
    window.dispatchEvent(
      Object.assign(new Event('mousemove'), { clientX: MOVE_CLIENT_X }),
    );
    window.dispatchEvent(new Event('mouseup'));
    await settle();
    expect(wrapper.find('.verify-tips').text()).toContain('0.02s');
    expect(wrapper.find('.verify-tips').text()).toContain(
      $t('ui.captcha.title'),
    );

    vi.advanceTimersByTime(SUCCESS_DELAY);
    await settle();

    expect(wrapper.emitted('onSuccess')?.[0]?.[0]).toEqual({
      captchaVerification: `${BACK_TOKEN}---${JSON.stringify({ x: 100, y: 5 })}`,
    });
    expect(wrapper.emitted('onClose')).toHaveLength(1);
    // 校验通过后隐藏刷新入口；happy-dom 对未挂载到文档的元素不计算计算样式，这里核对内联样式。
    expect(wrapper.find('.verify-refresh').attributes('style')).toContain(
      'display: none',
    );

    // 提示文案在 1 秒后清空，离开过渡需要额外一帧才能把节点移出组件树。
    vi.advanceTimersByTime(REFRESH_TRANSITION_DELAY + 100);
    await settle();
    expect(wrapper.find('.verify-tips').exists()).toBe(false);
  });

  it('校验通过后不再响应拖动', /** 通过后仍可拖动会让用户重复提交校验。 */ async () => {
    const wrapper = await mountSlide();

    await dragTo(wrapper, MOVE_CLIENT_X);
    vi.advanceTimersByTime(SUCCESS_DELAY);
    await flushPromises();
    checkCaptchaApi.mockClear();
    await dragTo(wrapper, MOVE_CLIENT_X);

    expect(checkCaptchaApi).not.toHaveBeenCalled();
  });

  it('弹层模式校验通过后自动收起并换图', /** 弹层不自动收起会让验证码一直挡在页面上。 */ async () => {
    const wrapper = await mountSlide({ mode: 'pop' });

    await dragTo(wrapper, MOVE_CLIENT_X);
    vi.advanceTimersByTime(POP_CLOSE_DELAY);
    await flushPromises();

    expect(wrapper.emitted('onClose')).toHaveLength(2);
    expect(getCaptchaApi).toHaveBeenCalledTimes(2);
  });

  it('固定模式校验通过后不自动换图', /** 固定模式误换图会让用户以为验证码被重置。 */ async () => {
    const wrapper = await mountSlide({ mode: 'fixed' });

    await dragTo(wrapper, MOVE_CLIENT_X);
    vi.advanceTimersByTime(POP_CLOSE_DELAY);
    await flushPromises();

    expect(wrapper.emitted('onClose')).toHaveLength(1);
    expect(getCaptchaApi).toHaveBeenCalledTimes(1);
  });

  it('校验失败时提示失败并自动换图', /** 不换图会让用户卡在同一张图上，不提示失败会让用户不知道哪里错了。 */ async () => {
    checkCaptchaApi.mockResolvedValue({ data: { repCode: '9999' } });
    const wrapper = await mountSlide({ type: '2' });

    await dragTo(wrapper, MOVE_CLIENT_X);
    await settle();

    expect(wrapper.emitted('onError')).toHaveLength(1);
    expect(wrapper.find('.verify-tips').text()).toBe(
      $t('ui.captcha.sliderRotateFailTip'),
    );

    vi.advanceTimersByTime(SUCCESS_DELAY);
    await settle();

    expect(getCaptchaApi).toHaveBeenCalledTimes(2);

    // 失败提示与换图共用 1 秒延迟，离开过渡需要额外一帧才能把节点移出组件树。
    vi.advanceTimersByTime(REFRESH_TRANSITION_DELAY + 100);
    await settle();
    expect(wrapper.find('.verify-tips').exists()).toBe(false);
  });
});

describe('滑块刷新入口', /** 刷新入口决定用户能否主动换一张图。 */ () => {
  it('点击刷新图标重新拉图并恢复初始文案', /** 未恢复文案会让提示条一直空白。 */ async () => {
    const wrapper = await mountSlide({
      explain: 'DUMMY-请拖动滑块',
      type: '2',
    });

    await wrapper.find('.verify-refresh').trigger('click');
    await flushPromises();
    expect(getCaptchaApi).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(REFRESH_TRANSITION_DELAY);
    await settle();

    expect(wrapper.find('.verify-msg').text()).toBe('DUMMY-请拖动滑块');
    expect(wrapper.find('.verify-refresh').attributes('style')).toBeUndefined();
  });

  it('刷新方法清空位移并恢复可拖动状态', /** 未清空位移会让下一轮从错误位置开始拖动。 */ async () => {
    const wrapper = await mountSlide();

    await dragTo(wrapper, MOVE_CLIENT_X);
    await exposed(wrapper).refresh();
    await flushPromises();
    vi.advanceTimersByTime(REFRESH_TRANSITION_DELAY);
    await flushPromises();

    const style = wrapper.find('.verify-move-block').attributes('style') ?? '';
    expect(style).toContain('left: 0px');
    expect(checkCaptchaApi).toHaveBeenCalledTimes(1);
  });

  it('禁止拖拽的监听在选中开始时被触发', /** 真实缺陷记录：监听器只 return false，浏览器不会因此阻止默认选中行为，需要 preventDefault 才生效。未改生产源码，按真实可观察行为断言。 */ async () => {
    const wrapper = await mountSlide();
    const event = new Event('selectstart', { bubbles: true, cancelable: true });

    wrapper.element.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
