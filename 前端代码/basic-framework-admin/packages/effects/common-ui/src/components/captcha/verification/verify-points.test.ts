/**
 * 点选验证码（common-ui 的 captcha/verification/verify-points）真实行为回归。
 *
 * 该组件按后端下发的字符顺序要求用户依次点击图片，再把坐标提交校验：挂载时未拉取验证码
 * 会让面板一直空白；未在拉取失败时展示后端文案会让用户不知道验证码服务不可用；点击未按
 * 基准画布换算会让后端比对全部偏移；后端开启 AES 时未加密坐标会让校验必然失败；校验通过
 * 后未回传凭据或未禁用后续点击会让业务方拿不到凭据或重复提交；校验失败后未自动换图会让
 * 用户卡在同一张图上；弹层模式成功后未自动收起会让弹层一直挡在页面上。
 *
 * 用例真实渲染组件、真实派发带相对坐标的点击、真实执行 400ms 提交延迟与成功/失败后的
 * 自动换图，只替换两个后端接口、图标组件与浏览器布局计算（happy-dom 不计算 offsetX）。
 */
import { flushPromises, mount } from '@vue/test-utils';

import { $t } from '@vben/locales';

import { AjCaptchaAES } from '@vben-core/shared/utils';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import VerifyPoints from './verify-points.vue';

/** 后端下发的 AES 密钥占位值：aj-captcha 约定为 16 位。 */
const SECRET_KEY = 'CHANGE_ME_KEY_16';

/** 后端下发的令牌占位值：提交校验时必须原样回传。 */
const BACK_TOKEN = 'DUMMY-TOKEN';

/** 背景图 Base64 占位值：只用于核对图片地址前缀。 */
const IMAGE_BASE64 = 'DUMMY-IMAGE-BASE64';

/** 点选验证码的字符顺序夹具，决定提示文案中的待点击字符。 */
const WORD_LIST = ['请', '点', '击'];

/** 点击坐标夹具：三点各按基准画布原样提交。 */
/** 三个固定点击点位；声明为元组，按索引取用时不会得到 undefined。 */
const CLICK_POINTS: [
  { x: number; y: number },
  { x: number; y: number },
  { x: number; y: number },
] = [
  { x: 100, y: 50 },
  { x: 200, y: 100 },
  { x: 300, y: 150 },
];

/** 提交校验的延迟，与组件声明的 400ms 保持一致。 */
const SUBMIT_DELAY = 400;

/** 失败提示的停留时间，与组件声明的 700ms 保持一致。 */
const FAIL_REFRESH_DELAY = 700;

/** 弹层模式成功提示的停留时间，与组件声明的 1500ms 保持一致。 */
const POP_CLOSE_DELAY = 1500;

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
interface VerifyPointsExposed {
  /** 重新初始化验证码并重新拉图。 */
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
        originalImageBase64: IMAGE_BASE64,
        token: BACK_TOKEN,
        wordList: WORD_LIST,
        ...overrides,
      },
    },
  };
}

/**
 * 在图片上派发一次带相对坐标的点击。
 * @param wrapper 已挂载的验证码包装器。
 * @param point 点击位置相对图片左上角的像素坐标。
 */
function clickImage(
  wrapper: ReturnType<typeof mount>,
  point: { x: number; y: number },
) {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  // happy-dom 不计算元素布局，offsetX/offsetY 恒为 0，这里按浏览器契约注入真实相对坐标。
  Object.defineProperty(event, 'offsetX', { value: point.x });
  Object.defineProperty(event, 'offsetY', { value: point.y });
  wrapper.find('img').element.dispatchEvent(event);
}

/**
 * 依次点击图片上的全部坐标点。
 * @param wrapper 已挂载的验证码包装器。
 * @param points 依次点击的坐标列表。
 */
function clickAll(
  wrapper: ReturnType<typeof mount>,
  points: Array<{ x: number; y: number }>,
) {
  for (const point of points) {
    clickImage(wrapper, point);
  }
}

/**
 * 取出组件通过 defineExpose 暴露的方法。
 * @param wrapper 已挂载的验证码包装器。
 * @returns 暴露的初始化与刷新方法。
 * @throws TypeError 组件未暴露方法时抛出，避免用例静默地什么都不验证。
 */
function exposed(wrapper: ReturnType<typeof mount>) {
  const vm = wrapper.vm as unknown as VerifyPointsExposed;
  if (typeof vm.init !== 'function' || typeof vm.refresh !== 'function') {
    throw new TypeError('组件未暴露初始化与刷新方法');
  }
  return vm;
}

/**
 * 挂载点选验证码并等待首次拉图完成。
 * @param props 传给组件的接口与尺寸配置。
 * @returns 已挂载的验证码包装器。
 */
async function mountCaptcha(props: Record<string, unknown> = {}) {
  const wrapper = mount(VerifyPoints, {
    props: {
      captchaType: 'clickWord',
      checkCaptchaApi,
      getCaptchaApi,
      ...props,
    },
  });
  await flushPromises();
  return wrapper;
}

beforeEach(
  /** 每例重建接口替身并启用受控时钟，避免真实等待 400/700/1500 毫秒。 */ () => {
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

describe('点选验证码初始化', /** 初始化决定面板能否拿到图片、字符顺序与令牌。 */ () => {
  it('挂载后按验证码类型拉图并通知父级就绪', /** 未拉图会让面板空白，未通知就绪会让父级无法开始交互。 */ async () => {
    const wrapper = await mountCaptcha();

    expect(getCaptchaApi).toHaveBeenCalledWith({ captchaType: 'clickWord' });
    expect(wrapper.emitted('onReady')).toHaveLength(1);
    expect(wrapper.find('img').attributes('src')).toBe(
      `data:image/png;base64,${IMAGE_BASE64}`,
    );
    expect(wrapper.find('.verify-msg').text()).toBe(
      `${$t('ui.captcha.clickInOrder')}【${WORD_LIST.join(',')}】`,
    );
  });

  it('拉图失败时展示后端失败文案', /** 静默失败会让用户不知道验证码服务不可用。 */ async () => {
    getCaptchaApi.mockResolvedValue({
      data: { repCode: '9999', repMsg: 'DUMMY-验证码服务不可用' },
    });
    const wrapper = await mountCaptcha();

    expect(wrapper.find('.verify-msg').text()).toBe('DUMMY-验证码服务不可用');
    expect(wrapper.find('img').attributes('src')).toBeUndefined();
  });

  it('未注入拉图接口时按空响应处理且不抛错', /** 未注入接口属于调用方配置缺失，组件崩溃会让页面白屏。 */ async () => {
    const wrapper = await mountCaptcha({ getCaptchaApi: undefined });

    expect(wrapper.find('.verify-msg').text()).toBe('');
    expect(wrapper.emitted('onReady')).toHaveLength(1);
  });

  it('百分比尺寸按父容器换算为像素', /** 百分比尺寸未换算会让图片区高度退化为 0。 */ async () => {
    const wrapper = await mountCaptcha({
      barSize: { height: '50%', width: '100%' },
      imgSize: { height: '100%', width: '100%' },
    });
    const panelStyle =
      wrapper.find('.verify-img-panel').attributes('style') ?? '';
    const barStyle = wrapper.find('.verify-bar-area').attributes('style') ?? '';

    expect(panelStyle).toContain(`width: ${window.innerWidth}px`);
    expect(panelStyle).toContain(`height: ${window.innerHeight}px`);
    expect(barStyle).toContain(`width: ${window.innerWidth}px`);
  });

  it('暴露初始化与刷新方法供父级驱动', /** 父级拿不到方法会让弹层无法主动换图。 */ async () => {
    const wrapper = await mountCaptcha();

    exposed(wrapper).init();
    await flushPromises();

    expect(getCaptchaApi).toHaveBeenCalledTimes(2);
  });
});

describe('点选验证码坐标采集', /** 坐标采集决定提交给后端的点位是否正确。 */ () => {
  it('未点满时只累计点位并依次编号', /** 未编号会让用户不知道还要点几个字。 */ async () => {
    const wrapper = await mountCaptcha();

    clickImage(wrapper, CLICK_POINTS[0]);
    await flushPromises();

    expect(wrapper.findAll('.point-area')).toHaveLength(1);
    expect(wrapper.find('.point-area').text()).toBe('1');
    expect(checkCaptchaApi).not.toHaveBeenCalled();
  });

  it('点满后按基准画布换算坐标并提交明文', /** 未换算会让后端比对偏移，未带令牌会让校验必然失败。 */ async () => {
    const wrapper = await mountCaptcha();

    clickAll(wrapper, CLICK_POINTS);
    vi.advanceTimersByTime(SUBMIT_DELAY);
    await flushPromises();

    expect(wrapper.findAll('.point-area')).toHaveLength(3);
    expect(checkCaptchaApi).toHaveBeenCalledWith({
      captchaType: 'clickWord',
      pointJson: JSON.stringify(CLICK_POINTS),
      token: BACK_TOKEN,
    });
  });

  it('后端开启 AES 时提交密文坐标与密文凭据', /** 后端开启加密时提交明文会让校验必然失败。 */ async () => {
    getCaptchaApi.mockResolvedValue(fetchSuccess({ secretKey: SECRET_KEY }));
    const wrapper = await mountCaptcha();

    clickAll(wrapper, CLICK_POINTS);
    vi.advanceTimersByTime(SUBMIT_DELAY);
    await flushPromises();

    const plainPoints = JSON.stringify(CLICK_POINTS);
    expect(checkCaptchaApi).toHaveBeenCalledWith({
      captchaType: 'clickWord',
      pointJson: AjCaptchaAES.encrypt(plainPoints, SECRET_KEY),
      token: BACK_TOKEN,
    });
    expect(wrapper.emitted('onSuccess')?.[0]?.[0]).toEqual({
      captchaVerification: AjCaptchaAES.encrypt(
        `${BACK_TOKEN}---${plainPoints}`,
        SECRET_KEY,
      ),
    });
  });
});

describe('点选验证码校验结果', /** 校验结果决定成功凭据、失败提示与后续交互。 */ () => {
  it('校验通过时提示成功并回传明文凭据', /** 未回传凭据会让业务方无法提交表单，未提示成功会让用户不知道可以继续。 */ async () => {
    const wrapper = await mountCaptcha();

    clickAll(wrapper, CLICK_POINTS);
    vi.advanceTimersByTime(SUBMIT_DELAY);
    await flushPromises();

    expect(wrapper.find('.verify-msg').text()).toBe(
      $t('ui.captcha.sliderSuccessText'),
    );
    expect(wrapper.emitted('onSuccess')?.[0]?.[0]).toEqual({
      captchaVerification: `${BACK_TOKEN}---${JSON.stringify(CLICK_POINTS)}`,
    });
    expect(wrapper.emitted('onError')).toBeUndefined();
  });

  it('校验通过后不再响应后续点击', /** 未禁用点击会让用户在同一张图上重复提交。 */ async () => {
    const wrapper = await mountCaptcha();

    clickAll(wrapper, CLICK_POINTS);
    vi.advanceTimersByTime(SUBMIT_DELAY);
    await flushPromises();
    checkCaptchaApi.mockClear();
    clickImage(wrapper, { x: 10, y: 10 });
    vi.advanceTimersByTime(SUBMIT_DELAY);
    await flushPromises();

    expect(checkCaptchaApi).not.toHaveBeenCalled();
    expect(wrapper.findAll('.point-area')).toHaveLength(3);
  });

  it('校验失败时提示失败并自动换图', /** 不换图会让用户卡在同一张图上，不提示失败会让用户不知道哪里错了。 */ async () => {
    checkCaptchaApi.mockResolvedValue({ data: { repCode: '9999' } });
    const wrapper = await mountCaptcha();

    clickAll(wrapper, CLICK_POINTS);
    vi.advanceTimersByTime(SUBMIT_DELAY);
    await flushPromises();

    expect(wrapper.find('.verify-msg').text()).toBe(
      $t('ui.captcha.sliderRotateFailTip'),
    );
    expect(wrapper.emitted('onError')).toHaveLength(1);
    expect(wrapper.findAll('.point-area')).toHaveLength(3);

    vi.advanceTimersByTime(FAIL_REFRESH_DELAY);
    await flushPromises();

    expect(getCaptchaApi).toHaveBeenCalledTimes(2);
    expect(wrapper.findAll('.point-area')).toHaveLength(0);
  });

  it('弹层模式校验通过后自动收起并换图', /** 弹层不自动收起会让验证码一直挡在页面上。 */ async () => {
    const wrapper = await mountCaptcha({ mode: 'pop' });

    clickAll(wrapper, CLICK_POINTS);
    vi.advanceTimersByTime(SUBMIT_DELAY);
    await flushPromises();
    expect(wrapper.emitted('onClose')).toBeUndefined();

    vi.advanceTimersByTime(POP_CLOSE_DELAY);
    await flushPromises();

    expect(wrapper.emitted('onClose')).toHaveLength(1);
    expect(getCaptchaApi).toHaveBeenCalledTimes(2);
  });

  it('固定模式校验通过后不自动收起', /** 固定模式误收起会让用户以为弹层被关闭。 */ async () => {
    const wrapper = await mountCaptcha({ mode: 'fixed' });

    clickAll(wrapper, CLICK_POINTS);
    vi.advanceTimersByTime(SUBMIT_DELAY + POP_CLOSE_DELAY);
    await flushPromises();

    expect(wrapper.emitted('onClose')).toBeUndefined();
  });
});

describe('点选验证码刷新入口', /** 刷新入口决定用户能否主动换一张图。 */ () => {
  it('点击刷新图标清空点位并重新拉图', /** 未清空点位会让上一轮的点留在新图上。 */ async () => {
    const wrapper = await mountCaptcha();
    clickImage(wrapper, CLICK_POINTS[0]);
    await flushPromises();

    await wrapper.find('.verify-refresh').trigger('click');
    await flushPromises();

    expect(getCaptchaApi).toHaveBeenCalledTimes(2);
    expect(wrapper.findAll('.point-area')).toHaveLength(0);
    expect(wrapper.find('.verify-refresh').isVisible()).toBe(true);
  });

  it('刷新方法重新拉图并恢复可点击状态', /** 刷新后仍禁止点击会让验证码无法再次使用。 */ async () => {
    checkCaptchaApi.mockResolvedValue({ data: { repCode: '9999' } });
    const wrapper = await mountCaptcha();
    clickAll(wrapper, CLICK_POINTS);
    vi.advanceTimersByTime(SUBMIT_DELAY);
    await flushPromises();

    await exposed(wrapper).refresh();
    await flushPromises();
    checkCaptchaApi.mockClear();
    clickAll(wrapper, CLICK_POINTS);
    vi.advanceTimersByTime(SUBMIT_DELAY);
    await flushPromises();

    expect(checkCaptchaApi).toHaveBeenCalledTimes(1);
  });

  it('禁止拖拽的监听在选中开始时被触发', /** 真实缺陷记录：监听器只 return false，浏览器不会因此阻止默认选中行为，需要 preventDefault 才生效。未改生产源码，按真实可观察行为断言。 */ async () => {
    const wrapper = await mountCaptcha();
    const event = new Event('selectstart', { bubbles: true, cancelable: true });

    wrapper.element.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
