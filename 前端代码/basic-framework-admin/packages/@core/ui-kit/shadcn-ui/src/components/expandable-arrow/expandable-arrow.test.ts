/**
 * 展开箭头（expandable-arrow）的真实行为回归。
 *
 * 箭头组件是折叠区域的唯一点击入口：点击必须切换折叠状态、图标必须跟随旋转、
 * 默认插槽必须拿到当前展开状态，未提供插槽时还要渲染出状态文本兜底。
 * 用例挂载真实组件并断言点击前后的 DOM 与插槽取值，不镜像内部变量。
 */
import { mount } from '@vue/test-utils';
import { h } from 'vue';

import { describe, expect, it } from 'vitest';

import ExpandableArrow from './expandable-arrow.vue';

describe('展开箭头交互', /** 点击失效或状态不传递会让折叠区域无法展开。 */ () => {
  it('未提供插槽时渲染状态文本并在点击后切换', /** 缺少兜底内容会让没有插槽的调用方看到一个空箭头。 */ async () => {
    const wrapper = mount(ExpandableArrow);

    expect(wrapper.text()).toBe('false');
    expect(wrapper.find('.rotate-180').exists()).toBe(true);

    await wrapper.trigger('click');

    expect(wrapper.text()).toBe('true');
    // 折叠后箭头必须回转，否则展开方向提示与实际状态相反。
    expect(wrapper.find('.rotate-180').exists()).toBe(false);
  });

  it('默认插槽读取到真实展开状态', /** 插槽参数写错会让调用方展示的状态与真实折叠状态相反。 */ async () => {
    const wrapper = mount(ExpandableArrow, {
      slots: {
        /** 渲染插槽收到的展开状态。 */
        default: /** 把插槽参数渲染成可读文本。 */ (slotProps: {
          isExpanded: boolean;
        }) => h('span', { 'data-test': 'state' }, String(slotProps.isExpanded)),
      },
    });

    expect(wrapper.get('[data-test="state"]').text()).toBe('false');

    await wrapper.trigger('click');

    expect(wrapper.get('[data-test="state"]').text()).toBe('true');
  });

  it('图标插槽可替换默认图标', /** 不支持替换图标会让业务无法统一不同区域的图标风格。 */ () => {
    const wrapper = mount(ExpandableArrow, {
      slots: {
        /** 渲染自定义图标内容。 */
        icon: /** 渲染可识别的自定义图标。 */ () =>
          h('i', { 'data-test': 'custom-icon' }),
      },
    });

    expect(wrapper.find('[data-test="custom-icon"]').exists()).toBe(true);
    expect(wrapper.find('.vben-link').exists()).toBe(true);
  });

  it('外部类名与内部类名真实合并', /** 覆盖类名会让业务无法调整箭头间距。 */ () => {
    const wrapper = mount(ExpandableArrow, { props: { class: 'ml-1' } });

    const root = wrapper.get('.vben-link');
    expect(root.classes()).toEqual(
      expect.arrayContaining(['vben-link', 'inline-flex', 'items-center']),
    );
    expect(root.classes()).toContain('ml-1');
  });

  it('父组件传入的模型值决定初始展开状态', /** 受控用法下组件必须尊重外部传入的状态。 */ () => {
    const wrapper = mount(ExpandableArrow, { props: { modelValue: true } });

    expect(wrapper.text()).toBe('true');
    expect(wrapper.find('.rotate-180').exists()).toBe(false);
  });
});
