/**
 * 验证码分发组件（captcha/verification/index）真实行为回归。
 *
 * 该组件按 captchaType 异步装载点选或滑块子组件，把尺寸与后端接口透传下去，并把子组件的
 * 就绪、失败、通过、关闭事件转发给业务方；弹层模式下还要负责展开与收起。
 * 类型分发写错会让管理端拼图类型退化成旧版底图或点选；异步子组件未被真正装载会让面板一直
 * 空白；尺寸与接口未透传会让子组件拿不到图片与校验入口；就绪后未换图会让首帧尺寸未定时锁死
 * 画布；失败后未换图会让用户卡在同一张图上；通过事件未原样转发会让业务方拿不到凭据；
 * 弹层模式下关闭未收起或展开未生效会让弹层一直挡在页面上。
 *
 * 用例真实挂载组件、真实等待异步子组件装载、真实派发关闭点击，只替换两个后端接口（外部边界）。
 */
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { i18n } from '@vben/locales';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import Verification from './index.vue';

/** 验证码拉取接口替身：返回后端响应体。 */
const getCaptchaApi = vi.fn();

/** 验证码校验接口替身：返回后端判定结果。 */
const checkCaptchaApi = vi.fn();

/** 后端下发的令牌占位值：只用于核对图片与提示的渲染。 */
const BACK_TOKEN = 'DUMMY-TOKEN';

/** 背景图 Base64 占位值：只用于核对图片地址前缀。 */
const IMAGE_BASE64 = 'DUMMY-IMAGE-BASE64';

/** 组件公开实例视图：只读取 defineExpose 暴露的方法。 */
interface VerificationExposed {
  /** 收起弹层并转发关闭事件。 */
  onClose: () => void;
  /** 转发失败事件并换图。 */
  onError: (proxy: unknown) => void;
  /** 转发就绪事件并换图。 */
  onReady: (proxy: unknown) => void;
  /** 原样转发通过凭据。 */
  onSuccess: (data: { captchaVerification: string }) => void;
  /** 重新初始化子组件。 */
  refresh: () => void;
  /** 弹层模式下展开面板。 */
  show: () => void;
}

/**
 * 构造一次成功的验证码拉取响应。
 * @returns 后端响应体。
 */
function fetchSuccess() {
  return {
    data: {
      repCode: '0000',
      repData: {
        jigsawImageBase64: IMAGE_BASE64,
        originalImageBase64: IMAGE_BASE64,
        token: BACK_TOKEN,
        wordList: ['甲', '乙', '丙'],
      },
    },
  };
}

/**
 * 挂载验证码分发组件。
 * @param props 传给组件的验证码类型、模式与尺寸配置。
 * @returns 已挂载的分发组件包装器。
 */
function mountVerification(props: Record<string, unknown> = {}) {
  return mount(Verification, {
    // 组件的模板使用全局注入的 $t（应用启动时由 vue-i18n 注入），这里装入同一个真实插件。
    global: { plugins: [i18n] },
    props: {
      checkCaptchaApi,
      getCaptchaApi,
      ...props,
    },
  });
}

/**
 * 等待异步子组件装载完成。
 * @param wrapper 已挂载的分发组件包装器。
 * @returns 子组件渲染出刷新入口后的 Promise。
 */
async function waitForChild(wrapper: ReturnType<typeof mount>) {
  await vi.waitFor(
    /** 等待异步子组件解析并渲染出刷新入口。 */ () => {
      expect(wrapper.find('.verify-refresh').exists()).toBe(true);
    },
    { timeout: 5000 },
  );
}

/**
 * 取出组件通过 defineExpose 暴露的方法。
 * @param wrapper 已挂载的分发组件包装器。
 * @returns 暴露的事件转发与弹层控制方法。
 * @throws TypeError 组件未暴露方法时抛出，避免用例静默地什么都不验证。
 */
function exposed(wrapper: ReturnType<typeof mount>) {
  const vm = wrapper.vm as unknown as VerificationExposed;
  if (
    typeof vm.onClose !== 'function' ||
    typeof vm.onError !== 'function' ||
    typeof vm.onReady !== 'function' ||
    typeof vm.onSuccess !== 'function' ||
    typeof vm.refresh !== 'function' ||
    typeof vm.show !== 'function'
  ) {
    throw new TypeError('分发组件未暴露事件转发与弹层控制方法');
  }
  return vm;
}

beforeEach(
  /** 每例重建接口替身，避免用例之间互相看到对方的调用记录。 */ () => {
    vi.clearAllMocks();
    getCaptchaApi.mockResolvedValue(fetchSuccess());
    checkCaptchaApi.mockResolvedValue({ data: { repCode: '0000' } });
  },
);

describe('验证码分发：类型装配', /** 类型分发决定业务方拿到的是点选还是滑块验证码。 */ () => {
  it('点选文字类型装载点选子组件并透传接口', /** 类型分发写错会让点选退化成滑块，接口未透传会让面板一直空白。 */ async () => {
    const wrapper = mountVerification({ captchaType: 'clickWord' });
    await waitForChild(wrapper);

    expect(getCaptchaApi).toHaveBeenCalledWith({ captchaType: 'clickWord' });
    expect(wrapper.find('.verify-img-panel').exists()).toBe(true);
    expect(wrapper.findAll('img')).toHaveLength(1);
  });

  it('拼图类型装载滑块子组件并带上拼图标记', /** 缺少拼图标记会让滑块退化成旧版底图模式。 */ async () => {
    const wrapper = mountVerification({ captchaType: 'blockPuzzle' });
    await waitForChild(wrapper);

    expect(getCaptchaApi).toHaveBeenCalledWith({ captchaType: 'blockPuzzle' });
    // 拼图标记让子组件渲染底图与拼图块两张图片。
    expect(wrapper.findAll('img')).toHaveLength(2);
  });

  it('管理端拼图类型同样装载滑块子组件', /** 管理端类型未分发会让后台登录页拿不到验证码。 */ async () => {
    const wrapper = mountVerification({ captchaType: 'adminBlockPuzzle' });
    await waitForChild(wrapper);

    expect(getCaptchaApi).toHaveBeenCalledWith({
      captchaType: 'adminBlockPuzzle',
    });
    expect(wrapper.findAll('img')).toHaveLength(2);
  });

  it('未知类型不装载子组件且刷新不抛错', /** 子组件未就绪时刷新未判空会让业务方的主动刷新直接抛错。 */ () => {
    const wrapper = mountVerification({ captchaType: 'DUMMY-未知类型' });
    exposed(wrapper).show();

    expect(wrapper.find('.verify-refresh').exists()).toBe(false);
    expect(wrapper.find('.verifybox-bottom').exists()).toBe(true);

    expect(
      /** 未装载子组件时刷新应当是空操作。 */ () => {
        exposed(wrapper).refresh();
      },
    ).not.toThrow();
  });
});

describe('验证码分发：弹层与事件转发', /** 弹层展开与事件转发决定业务方能否拿到凭据并收起面板。 */ () => {
  it('弹层模式展开后才显示内容', /** 展开未生效会让验证码永远不显示。 */ async () => {
    const wrapper = mountVerification({ mode: 'pop' });

    expect(wrapper.element.style.display).toBe('none');

    exposed(wrapper).show();
    await nextTick();

    expect(wrapper.element.style.display).toBe('');
    expect(wrapper.find('.verifybox').exists()).toBe(true);
    expect(wrapper.find('.verifybox-top').exists()).toBe(true);
  });

  it('固定模式不展开弹层且不带弹层外框', /** 固定模式误加弹层外框会让内嵌场景多出关闭栏与内边距。 */ () => {
    const wrapper = mountVerification({ mode: 'fixed' });

    exposed(wrapper).show();

    expect(wrapper.element.style.display).toBe('none');
    expect(wrapper.find('.verifybox').exists()).toBe(false);
    expect(wrapper.find('.verifybox-top').exists()).toBe(false);
    expect(wrapper.find('.verifybox-bottom').attributes('style')).toContain(
      'padding: 0',
    );
  });

  it('点击关闭按钮收起弹层并转发关闭事件', /** 未收起会让弹层一直挡在页面上。 */ async () => {
    const wrapper = mountVerification({ mode: 'pop' });
    exposed(wrapper).show();

    await wrapper.find('.verifybox-close').trigger('click');

    expect(wrapper.emitted('onClose')).toHaveLength(1);
    expect(wrapper.element.style.display).toBe('none');
  });

  it('子组件就绪后转发事件并立即换图', /** 就绪后未换图会让首帧尺寸未定时锁死画布。 */ async () => {
    const wrapper = mountVerification({ captchaType: 'clickWord' });
    await waitForChild(wrapper);

    expect(wrapper.emitted('onReady')).toHaveLength(1);
    // 挂载时拉一次图，转发就绪事件时再换一张。
    expect(getCaptchaApi).toHaveBeenCalledTimes(2);
  });

  it('子组件失败后转发事件并立即换图', /** 失败后未换图会让用户卡在同一张图上。 */ async () => {
    const wrapper = mountVerification({ captchaType: 'clickWord' });
    await waitForChild(wrapper);
    getCaptchaApi.mockClear();
    const proxy = { DUMMY: '子组件实例' };

    exposed(wrapper).onError(proxy);
    await flushPromises();

    expect(wrapper.emitted('onError')?.[0]).toEqual([proxy]);
    expect(getCaptchaApi).toHaveBeenCalledTimes(1);
  });

  it('子组件就绪事件转发时立即换图', /** 未换图会让业务方主动刷新后仍看到旧图。 */ async () => {
    const wrapper = mountVerification({ captchaType: 'clickWord' });
    await waitForChild(wrapper);
    getCaptchaApi.mockClear();
    const proxy = { DUMMY: '子组件实例' };

    exposed(wrapper).onReady(proxy);
    await flushPromises();

    expect(wrapper.emitted('onReady')?.[1]).toEqual([proxy]);
    expect(getCaptchaApi).toHaveBeenCalledTimes(1);
  });

  it('校验通过时原样转发凭据', /** 凭据被改写或吞掉会让业务方无法提交表单。 */ () => {
    const wrapper = mountVerification({ captchaType: 'clickWord' });
    const payload = { captchaVerification: 'DUMMY-密文凭据' };

    exposed(wrapper).onSuccess(payload);

    expect(wrapper.emitted('onSuccess')?.[0]).toEqual([payload]);
  });
});
