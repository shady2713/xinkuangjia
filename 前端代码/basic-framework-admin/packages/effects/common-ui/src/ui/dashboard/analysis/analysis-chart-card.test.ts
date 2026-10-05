/**
 * 分析页图表卡片（common-ui 的 ui/dashboard/analysis/analysis-chart-card）标题与内容回归。
 *
 * 卡片是分析页每个图表的容器：标题缺失会让用户分不清图表含义，默认插槽未渲染会让图表整块
 * 消失，调用方传入的类名未落到卡片根节点会让栅格与间距失效。用例真实挂载组件并断言真实 DOM
 * 中的标题文本、插槽内容与根节点样式类。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import AnalysisChartCard from './analysis-chart-card.vue';

describe('分析页图表卡片', /** 标题与内容缺失会让图表卡片变成一块没有信息的空板。 */ () => {
  it('渲染标题与默认插槽内容', /** 标题或插槽丢失会让用户看不到图表说明与图形。 */ () => {
    const wrapper = mount(AnalysisChartCard, {
      props: { title: 'DUMMY-访问趋势' },
      slots: { default: '<div class="chart-body">DUMMY-图表占位</div>' },
    });

    expect(wrapper.text()).toContain('DUMMY-访问趋势');
    expect(wrapper.find('.chart-body').text()).toBe('DUMMY-图表占位');
    // 卡片根节点的圆角与背景来自核心卡片组件，丢失会让卡片与页面底色糊在一起。
    expect(wrapper.classes()).toContain('rounded-xl');
    expect(wrapper.classes()).toContain('bg-card');
    wrapper.unmount();
  });

  it('未提供插槽时只渲染标题', /** 空插槽注入占位内容会让用户看到并不存在的图表。 */ () => {
    const wrapper = mount(AnalysisChartCard, {
      props: { title: 'DUMMY-销售占比' },
    });

    expect(wrapper.text()).toBe('DUMMY-销售占比');
    expect(wrapper.find('.chart-body').exists()).toBe(false);
    wrapper.unmount();
  });
});
