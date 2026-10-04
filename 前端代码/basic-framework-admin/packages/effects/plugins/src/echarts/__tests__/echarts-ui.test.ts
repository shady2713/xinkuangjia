/**
 * 图表外壳组件（echarts-ui.vue）的真实渲染回归。
 *
 * 组件只负责提供可挂载的容器：默认填充父级宽度、固定高度，并允许调用方覆盖尺寸与透传其余属性。
 * 断言读取真实渲染出的节点、内联尺寸与属性落点。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import EchartsUi from '../echarts-ui.vue';

describe('图表容器渲染（echarts-ui.vue）', /** 尺寸默认值、覆盖值与属性透传。 */ () => {
  it('未声明尺寸时使用默认高度与全宽', /** 默认尺寸是图表的兜底布局，缺失会让图表高度塌陷为 0。 */ () => {
    const wrapper = mount(EchartsUi);

    const chart = wrapper.find('div');
    expect(chart.attributes('style')).toContain('height: 300px');
    expect(chart.attributes('style')).toContain('width: 100%');
  });

  it('声明的尺寸覆盖默认值', /** 调用方按卡片布局指定尺寸时必须生效。 */ () => {
    const wrapper = mount(EchartsUi, {
      props: { height: '12rem', width: '480px' },
    });

    const chart = wrapper.find('div');
    expect(chart.attributes('style')).toContain('height: 12rem');
    expect(chart.attributes('style')).toContain('width: 480px');
    expect(chart.attributes('style')).not.toContain('300px');
  });

  it('其余属性透传到容器节点', /** 调用方依赖 class 与 data 属性做布局与选择器定位，透传不能丢失。 */ () => {
    const wrapper = mount(EchartsUi, {
      attrs: {
        class: 'chart-shell',
        'data-test': 'chart-shell',
      },
      props: { height: '200px' },
    });

    const chart = wrapper.find('div');
    expect(chart.classes()).toContain('chart-shell');
    expect(chart.attributes('data-test')).toBe('chart-shell');
    expect(chart.attributes('style')).toContain('height: 200px');
  });
});
