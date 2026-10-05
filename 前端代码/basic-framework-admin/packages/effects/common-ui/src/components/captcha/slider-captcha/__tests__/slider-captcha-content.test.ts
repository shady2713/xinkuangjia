/**
 * 滑块验证码内容层（slider-captcha/slider-captcha-content）真实行为回归。
 *
 * 该组件是滑块验证码的文案承载层：未通过时展示默认提示，通过后换成成功文案并叠上成功态样式，
 * 同时把调用方的 contentStyle 合并进根元素、并通过 getEl 把挂载元素交给父级做宽度回位。
 * 默认文案丢失会让用户不知道要按住滑块；成功文案与成功态样式不生效会让用户看不出已经通过；
 * contentStyle 未合并会让调用方无法调整提示层外观；getEl 取不到元素会让父级的回位动画作用在
 * 空节点上，进度条无法复位。
 *
 * 用例真实挂载组件并读取真实 DOM 与真实暴露元素，不替换任何依赖。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import SliderCaptchaContent from '../slider-captcha-content.vue';

/** 组件公开实例视图：只读取 defineExpose 暴露的方法。 */
interface ContentExposed {
  /** 读取内容层的根元素。 */
  getEl: () => HTMLDivElement | null;
}

/**
 * 取出组件通过 defineExpose 暴露的根元素读取方法。
 * @param wrapper 已挂载的内容层包装器。
 * @returns 暴露的根元素读取方法。
 * @throws TypeError 组件未暴露 getEl 时抛出，避免用例静默地什么都不验证。
 */
function exposed(wrapper: ReturnType<typeof mount>) {
  const vm = wrapper.vm as unknown as ContentExposed;
  if (typeof vm.getEl !== 'function') {
    throw new TypeError('内容层未暴露 getEl');
  }
  return vm;
}

/**
 * 挂载内容层。
 * @param isPassing 当前是否已经通过校验。
 * @returns 已挂载的内容层包装器。
 */
function mountContent(isPassing: boolean) {
  return mount(SliderCaptchaContent, {
    props: {
      contentStyle: { color: 'rgb(1, 2, 3)' },
      isPassing,
      successText: 'DUMMY-验证通过',
      text: 'DUMMY-请按住滑块拖动',
    },
  });
}

describe('滑块验证码内容层', /** 文案与样式的切换决定用户能否看懂当前校验状态。 */ () => {
  it('未通过时展示默认提示并合并调用方样式', /** 默认提示丢失会让用户不知道怎么操作滑块。 */ () => {
    const wrapper = mountContent(false);

    expect(wrapper.text()).toBe('DUMMY-请按住滑块拖动');
    expect(wrapper.attributes('style')).toContain('color: rgb(1, 2, 3)');
    expect(
      wrapper
        .classes()
        .some(
          /** 判断类名是否带成功态标记。 */ (name) => name.includes('success'),
        ),
    ).toBe(false);
  });

  it('通过后展示成功文案并叠上成功态样式类', /** 成功文案不切换会让用户以为校验没有生效。 */ () => {
    const wrapper = mountContent(true);

    expect(wrapper.text()).toBe('DUMMY-验证通过');
    expect(
      wrapper
        .classes()
        .some(
          /** 判断类名是否带成功态标记。 */ (name) => name.includes('success'),
        ),
    ).toBe(true);
    // 通过态的样式类只用于文字填充色，不能反过来影响调用方传入的颜色。
    expect(wrapper.attributes('style')).toContain('color: rgb(1, 2, 3)');
  });

  it('调用方提供 text 插槽时用插槽内容替换默认文案', /** 插槽被默认内容顶掉会让业务方无法定制提示。 */ () => {
    const wrapper = mount(SliderCaptchaContent, {
      props: {
        contentStyle: {},
        isPassing: false,
        successText: 'DUMMY-验证通过',
        text: 'DUMMY-请按住滑块拖动',
      },
      slots: { text: '<span class="DUMMY-custom-text">DUMMY-插槽提示</span>' },
    });

    expect(wrapper.find('.DUMMY-custom-text').exists()).toBe(true);
    expect(wrapper.text()).toBe('DUMMY-插槽提示');
    expect(wrapper.text()).not.toContain('DUMMY-请按住滑块拖动');
  });

  it('getEl 返回真实挂载的根元素', /** 父级拿不到元素会让进度条宽度无法回位。 */ () => {
    const wrapper = mountContent(true);

    expect(exposed(wrapper).getEl()).toBe(wrapper.element);
  });
});
