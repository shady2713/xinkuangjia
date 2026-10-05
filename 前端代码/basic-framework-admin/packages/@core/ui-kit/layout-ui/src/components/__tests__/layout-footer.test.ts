/**
 * 布局页脚（layout-ui 的 components/layout-footer）样式换算与插槽回归。
 *
 * 页脚承载版权与备案信息，其高度、定位与显示开关决定它是否占用文档流：换算写错会让页脚遮住
 * 内容、跟着内容滚走，或在隐藏后仍留出空白。用例真实挂载页脚，逐项核对真实内联样式与插槽。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import LayoutFooter from '../layout-footer.vue';

describe('布局页脚样式换算', /** 定位与高度换算错误会让页脚遮挡内容或留下空白。 */ () => {
  it('显示时按属性换算高度、宽度、层级与静态定位', /** 换算写错会让页脚尺寸与父级布局不一致。 */ () => {
    const wrapper = mount(LayoutFooter, {
      props: {
        fixed: false,
        height: 48,
        show: true,
        width: '100%',
        zIndex: 10,
      },
      slots: { default: 'DUMMY-版权信息' },
    });
    const style = wrapper.attributes('style') ?? '';

    expect(wrapper.element.tagName).toBe('FOOTER');
    expect(style).toContain('height: 48px');
    expect(style).toContain('width: 100%');
    expect(style).toContain('z-index: 10');
    expect(style).toContain('position: static');
    expect(style).toContain('margin-bottom: 0');
    expect(wrapper.text()).toBe('DUMMY-版权信息');
    expect(wrapper.classes()).toContain('bg-background-deep');
  });

  it('隐藏时用负外边距收起并保持固定定位', /** 隐藏页脚仍占位会留下空白，固定定位失效会跟着内容滚走。 */ () => {
    const wrapper = mount(LayoutFooter, {
      props: {
        fixed: true,
        height: 48,
        show: false,
        width: '200px',
        zIndex: 20,
      },
    });
    const style = wrapper.attributes('style') ?? '';

    expect(style).toContain('margin-bottom: -48px');
    expect(style).toContain('position: fixed');
    expect(style).toContain('width: 200px');
    expect(style).toContain('z-index: 20');
  });

  it('未传 show 时默认显示页脚', /** 默认值写错会让页脚在首屏就被收起。 */ () => {
    const wrapper = mount(LayoutFooter, {
      props: { height: 60, width: '100%', zIndex: 1 },
    });

    expect(wrapper.attributes('style')).toContain('margin-bottom: 0');
    expect(wrapper.attributes('style')).toContain('height: 60px');
  });
});
