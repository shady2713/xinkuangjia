/**
 * 滑块验证码拖动手柄（slider-captcha/slider-captcha-action）真实行为回归。
 *
 * 该组件是跟随鼠标移动的滑块按钮：父级通过 setLeft 推入实时位移，按钮据此切换拖动外观，
 * 通过态换成对勾图标并锁掉拖动样式，toLeft 负责回位过渡，调用方还能用 icon 插槽替换图标。
 * setLeft 未渲染会让滑块不跟手；拖动判定写错会让未拖动或已通过的滑块显示成可拖动；
 * 通过态仍显示右箭头会让用户以为还能继续拖动；getStyle 读不到内联样式会让父级无法按当前
 * 位移计算下一次拖动距离；icon 插槽被默认图标顶掉会让业务方无法定制。
 *
 * 用例真实挂载组件、真实调用暴露的 setLeft/getStyle/getEl 并读取重渲染后的真实 DOM，
 * 图标为本地 lucide 组件（不联网），不替换任何依赖。
 */
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { describe, expect, it } from 'vitest';

import SliderCaptchaAction from '../slider-captcha-action.vue';

/** 组件公开实例视图：只读取 defineExpose 暴露的方法。 */
interface ActionExposed {
  /** 读取手柄的根元素。 */
  getEl: () => HTMLDivElement | null;
  /** 读取手柄当前的内联样式。 */
  getStyle: () => CSSStyleDeclaration | undefined;
  /** 推入手柄的实时位移。 */
  setLeft: (val: string) => void;
}

/**
 * 取出组件通过 defineExpose 暴露的位移写入与样式读取方法。
 * @param wrapper 已挂载的手柄包装器。
 * @returns 暴露的 getEl、getStyle 与 setLeft。
 * @throws TypeError 组件未暴露方法时抛出，避免用例静默地什么都不验证。
 */
function exposed(wrapper: ReturnType<typeof mount>) {
  const vm = wrapper.vm as unknown as ActionExposed;
  if (
    typeof vm.getEl !== 'function' ||
    typeof vm.getStyle !== 'function' ||
    typeof vm.setLeft !== 'function'
  ) {
    throw new TypeError('手柄未暴露 getEl、getStyle 与 setLeft');
  }
  return vm;
}

/**
 * 挂载拖动手柄。
 * @param overrides 覆盖手柄状态，例如已通过或回位中。
 * @param slots 传给手柄的插槽内容。
 * @returns 已挂载的手柄包装器。
 */
function mountAction(
  overrides: Record<string, unknown> = {},
  slots: Record<string, string> = {},
) {
  return mount(SliderCaptchaAction, {
    props: {
      actionStyle: { backgroundColor: 'rgb(9, 8, 7)' },
      isPassing: false,
      toLeft: false,
      ...overrides,
    },
    slots,
  });
}

describe('滑块验证码拖动手柄', /** 位移渲染与图标切换决定滑块是否跟手、状态是否可读。 */ () => {
  it('未拖动时展示右箭头且不带拖动外观', /** 未拖动就显示拖动外观会让用户误判进度。 */ () => {
    const wrapper = mountAction();

    expect(wrapper.attributes('style')).toContain(
      'background-color: rgb(9, 8, 7)',
    );
    expect(wrapper.element.style.left).toBe('0px');
    expect(wrapper.classes()).not.toContain('rounded-md');
    expect(wrapper.find('svg.lucide-chevrons-right').exists()).toBe(true);
    expect(wrapper.find('svg.lucide-check').exists()).toBe(false);
  });

  it('setLeft 推入的位移真实渲染并切换成拖动外观', /** 位移没渲染会让滑块不跟手，拖动外观不切换会让用户看不出正在拖动。 */ async () => {
    const wrapper = mountAction();

    exposed(wrapper).setLeft('20px');
    await nextTick();

    expect(wrapper.element.style.left).toBe('20px');
    expect(wrapper.classes()).toContain('rounded-md');
    expect(exposed(wrapper).getEl()).toBe(wrapper.element);
    expect(exposed(wrapper).getStyle()?.left).toBe('20px');
  });

  it('已通过时改用对勾图标并锁掉拖动外观', /** 通过后仍显示右箭头会让用户以为还能继续拖动。 */ async () => {
    const wrapper = mountAction({ isPassing: true, toLeft: true });

    exposed(wrapper).setLeft('20px');
    await nextTick();

    expect(wrapper.find('svg.lucide-check').exists()).toBe(true);
    expect(wrapper.find('svg.lucide-chevrons-right').exists()).toBe(false);
    expect(wrapper.classes()).not.toContain('rounded-md');
    expect(wrapper.classes()).toContain('transition-width');
    expect(wrapper.classes()).toContain('!left-0');
    expect(wrapper.classes()).toContain('duration-300');
  });

  it('icon 插槽替换默认图标', /** 插槽被默认图标顶掉会让业务方无法定制滑块外观。 */ () => {
    const wrapper = mountAction(
      {},
      { icon: '<i class="DUMMY-custom-icon"></i>' },
    );

    expect(wrapper.find('.DUMMY-custom-icon').exists()).toBe(true);
    expect(wrapper.find('svg.lucide-chevrons-right').exists()).toBe(false);
  });
});
