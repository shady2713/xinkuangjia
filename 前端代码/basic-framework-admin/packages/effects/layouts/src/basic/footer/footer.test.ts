/**
 * 基础布局页脚（effects/layouts 的 basic/footer）插槽渲染回归。
 *
 * 页脚承载版权与备案信息：插槽内容未渲染会让页面底部丢失版权声明。用例真实挂载组件并读取
 * 真实 DOM 与插槽内容。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import LayoutFooter from './footer.vue';

describe('基础布局页脚', /** 版权信息缺失会让交付页面不符合合规要求。 */ () => {
  it('渲染插槽内容', /** 插槽未渲染会让页脚变成空白条。 */ () => {
    const wrapper = mount(LayoutFooter, {
      slots: { default: 'DUMMY-版权信息' },
    });

    expect(wrapper.text()).toBe('DUMMY-版权信息');
    expect(wrapper.classes()).toContain('text-muted-foreground');
    expect(wrapper.classes()).toContain('h-full');
  });
});
