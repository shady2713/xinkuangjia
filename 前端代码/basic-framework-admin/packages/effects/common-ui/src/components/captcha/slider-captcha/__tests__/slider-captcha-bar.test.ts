/**
 * 滑块验证码进度条（slider-captcha/slider-captcha-bar）真实行为回归。
 *
 * 该组件是滑块左侧的进度提示条：拖动时由父级通过 setWidth 推入实时宽度，松开后由父级用
 * toLeft 触发宽度回零的过渡动画，barStyle 则负责调用方定制的外观。
 * setWidth 写入的宽度没有渲染会让用户看不到拖动进度；宽度计算被 barStyle 里的 width 覆盖会让
 * 进度条永远停在调用方给的固定宽度；toLeft 未切换过渡类会让回位动作生硬跳变；getEl 取不到元素
 * 会让父级在复位时读不到真实宽度。
 *
 * 用例真实挂载组件、真实调用暴露的 setWidth 并读取重渲染后的真实 DOM，不替换任何依赖。
 */
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { describe, expect, it } from 'vitest';

import SliderCaptchaBar from '../slider-captcha-bar.vue';

/** 组件公开实例视图：只读取 defineExpose 暴露的方法。 */
interface BarExposed {
  /** 读取进度条的根元素。 */
  getEl: () => HTMLDivElement | null;
  /** 推入进度条的实时宽度。 */
  setWidth: (val: string) => void;
}

/**
 * 取出组件通过 defineExpose 暴露的宽度写入与元素读取方法。
 * @param wrapper 已挂载的进度条包装器。
 * @returns 暴露的 getEl 与 setWidth。
 * @throws TypeError 组件未暴露方法时抛出，避免用例静默地什么都不验证。
 */
function exposed(wrapper: ReturnType<typeof mount>) {
  const vm = wrapper.vm as unknown as BarExposed;
  if (typeof vm.getEl !== 'function' || typeof vm.setWidth !== 'function') {
    throw new TypeError('进度条未暴露 getEl 与 setWidth');
  }
  return vm;
}

describe('滑块验证码进度条', /** 进度宽度与过渡类决定拖动反馈是否跟手。 */ () => {
  it('初始宽度归零且不被调用方样式覆盖', /** 调用方的固定宽度覆盖实时宽度会让进度条永远不跟随拖动。 */ () => {
    const wrapper = mount(SliderCaptchaBar, {
      props: {
        barStyle: { backgroundColor: 'rgb(9, 8, 7)', width: '5px' },
        toLeft: false,
      },
    });

    expect(wrapper.element.style.width).toBe('0px');
    expect(wrapper.attributes('style')).toContain(
      'background-color: rgb(9, 8, 7)',
    );
    expect(wrapper.classes()).not.toContain('!w-0');
  });

  it('setWidth 推入的宽度真实渲染到进度条上', /** 宽度没渲染会让用户看不到拖动进度。 */ async () => {
    const wrapper = mount(SliderCaptchaBar, {
      props: { barStyle: {}, toLeft: false },
    });

    exposed(wrapper).setWidth('120px');
    await nextTick();

    expect(wrapper.element.style.width).toBe('120px');
    expect(wrapper.attributes('style')).toContain('width: 120px');
    expect(exposed(wrapper).getEl()).toBe(wrapper.element);
  });

  it('toLeft 打开时挂上回零过渡类', /** 缺少过渡类会让进度条复位时生硬跳变。 */ () => {
    const wrapper = mount(SliderCaptchaBar, {
      props: { barStyle: {}, toLeft: true },
    });

    expect(wrapper.classes()).toContain('transition-width');
    expect(wrapper.classes()).toContain('!w-0');
    expect(wrapper.classes()).toContain('duration-300');
  });
});
