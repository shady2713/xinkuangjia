/**
 * 按钮组（shadcn-ui 的 components/button/button-group）外观回归。
 *
 * 按钮组用于把多个相关操作拼成一条工具栏：尺寸类决定内部按钮的高度，间距决定按钮之间是否
 * 留缝，无间距模式必须给首尾按钮补圆角。尺寸或间距算错会让工具栏高度不齐或出现双重圆角。
 * 用例真实挂载组件并读取真实 class 与间距样式。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import ButtonGroup from './button-group.vue';

describe('按钮组外观', /** 尺寸与间距决定工具栏是否整齐。 */ () => {
  it('默认使用中等尺寸且无间距', /** 默认值缺失会让按钮组缺少尺寸类。 */ () => {
    const wrapper = mount(ButtonGroup, {
      attrs: { class: 'custom-group' },
      slots: { default: '<button>编辑</button>' },
    });

    expect(wrapper.classes()).toContain('vben-button-group');
    expect(wrapper.classes()).toContain('size-middle');
    expect(wrapper.classes()).toContain('no-gap');
    expect(wrapper.classes()).toContain('custom-group');
    expect(wrapper.attributes('style')).toContain('gap: 0px');
    expect(wrapper.find('button').text()).toBe('编辑');
  });

  it('指定尺寸与间距时按调用方渲染', /** 间距失效会让相邻按钮贴在一起无法区分。 */ () => {
    const wrapper = mount(ButtonGroup, {
      props: { gap: 8, size: 'small' },
    });

    expect(wrapper.classes()).toContain('size-small');
    expect(wrapper.classes()).toContain('with-gap');
    expect(wrapper.attributes('style')).toContain('gap: 8px');
  });
});
