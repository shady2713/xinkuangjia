/**
 * 流光文字（shadcn-ui 的 components/spine-text）动画参数回归。
 *
 * 流光文字用于欢迎语与品牌标语：动画时长与播放次数必须按调用方传入的值写进内联样式，
 * 否则流光会以默认速度播放或无限循环。用例真实挂载组件并读取真实内联样式与插槽内容。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import SpineText from './spine-text.vue';

describe('流光文字动画参数', /** 动画参数写错会让流光速度或播放次数与设计不符。 */ () => {
  it('默认按 2 秒无限循环播放', /** 默认值缺失会让动画时长退化为 0 秒。 */ () => {
    const wrapper = mount(SpineText, { slots: { default: '欢迎回来' } });

    expect(wrapper.attributes('style')).toContain(
      'animation: shine 2s linear infinite',
    );
    expect(wrapper.classes()).toContain('text-transparent');
    expect(wrapper.text()).toBe('欢迎回来');
  });

  it('按调用方传入的时长与次数播放', /** 覆盖失效会让只能播放一次的标语一直闪烁。 */ () => {
    const wrapper = mount(SpineText, {
      props: { animationDuration: 5, animationIterationCount: 1 },
      slots: { default: '公告' },
    });

    expect(wrapper.attributes('style')).toContain(
      'animation: shine 5s linear 1',
    );
  });
});
