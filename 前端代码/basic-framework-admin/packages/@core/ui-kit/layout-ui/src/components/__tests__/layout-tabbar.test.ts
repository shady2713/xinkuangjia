/**
 * 布局页签栏（layout-ui 的 components/layout-tabbar）高度换算与插槽回归。
 *
 * 页签栏高度由业务配置注入：高度换算写错会让页签栏与内容区错位、遮挡或留出空白，插槽未渲染
 * 会让页签整体消失。用例真实挂载页签栏，读取真实样式与插槽内容，并在属性变化后核对重算结果。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import LayoutTabbar from '../layout-tabbar.vue';

describe('布局页签栏', /** 高度换算错误会让页签栏与内容区互相遮挡。 */ () => {
  it('按高度属性换算样式并渲染插槽', /** 样式或插槽丢失会让页签区域整体不可用。 */ () => {
    const wrapper = mount(LayoutTabbar, {
      props: { height: 44 },
      slots: { default: 'DUMMY-页签内容' },
    });

    expect(wrapper.element.tagName).toBe('SECTION');
    expect(wrapper.attributes('style')).toContain('height: 44px');
    expect(wrapper.text()).toBe('DUMMY-页签内容');
    expect(wrapper.classes()).toContain('border-b');
    expect(wrapper.classes()).toContain('bg-background');
  });

  it('高度属性变化后重新计算样式', /** 缓存错误会让页签栏停留在旧高度。 */ async () => {
    const wrapper = mount(LayoutTabbar, { props: { height: 44 } });

    await wrapper.setProps({ height: 60 });

    expect(wrapper.attributes('style')).toContain('height: 60px');
  });
});
