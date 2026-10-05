/**
 * 分析页图表页签（common-ui 的 ui/dashboard/analysis/analysis-charts-tabs）页签与面板回归。
 *
 * 组件把多个图表按页签分组：默认值必须取第一个页签的取值，否则首屏没有选中项、看不到任何
 * 图表；每个页签对应的具名插槽要渲染进同名面板，插槽名与取值不一致会让切换后内容缺失；
 * 未传页签时要渲染出空的外壳而不是报错。用例真实挂载组件、真实点击页签切换面板，并断言
 * 真实 DOM 的选中态、隐藏态与面板内容。
 */
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { describe, expect, it } from 'vitest';

import AnalysisChartsTabs from './analysis-charts-tabs.vue';

/** 页签夹具：两个图表页签，取值用于关联同名的面板插槽。 */
const TABS = [
  { label: 'DUMMY-访问量', value: 'visits' },
  { label: 'DUMMY-销售额', value: 'sales' },
];

/**
 * 挂载图表页签组件。
 * @param withTabs 是否传入页签配置；为假时走组件默认的空页签分支。
 * @returns 已挂载的组件包装器。
 */
function mountTabs(withTabs: boolean) {
  return mount(AnalysisChartsTabs, {
    props: withTabs ? { tabs: TABS } : {},
    slots: {
      sales: '<div class="sales-chart">DUMMY-销售额图表</div>',
      visits: '<div class="visits-chart">DUMMY-访问量图表</div>',
    },
  });
}

describe('分析页图表页签默认态', /** 默认页签决定首屏展示哪一张图表。 */ () => {
  it('默认选中第一个页签并渲染对应面板', /** 默认值取错会让首屏空白或显示错误图表。 */ () => {
    const wrapper = mountTabs(true);
    const triggers = wrapper.findAll('[role="tab"]');
    const panels = wrapper.findAll('[role="tabpanel"]');

    expect(triggers).toHaveLength(2);
    expect(triggers[0]?.text()).toContain('DUMMY-访问量');
    expect(triggers[1]?.text()).toContain('DUMMY-销售额');
    expect(triggers[0]?.attributes('data-state')).toBe('active');
    // 未选中的面板保持挂载但被隐藏，面板内容按需渲染，切换时不必重新创建图表容器。
    expect(panels).toHaveLength(2);
    expect(panels[0]?.attributes('data-state')).toBe('active');
    expect(panels[0]?.attributes('hidden')).toBeUndefined();
    expect(panels[0]?.text()).toContain('DUMMY-访问量图表');
    expect(panels[1]?.attributes('data-state')).toBe('inactive');
    expect(panels[1]?.attributes('hidden')).toBeDefined();
    expect(panels[1]?.find('.sales-chart').exists()).toBe(false);
    wrapper.unmount();
  });

  it('页签缺省时不渲染任何页签与面板', /** 未传页签却渲染出空页签会让用户点到没有内容的面板。 */ () => {
    const wrapper = mountTabs(false);

    expect(wrapper.find('.card-box').exists()).toBe(true);
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(0);
    expect(wrapper.findAll('[role="tabpanel"]')).toHaveLength(0);
    wrapper.unmount();
  });
});

describe('分析页图表页签切换', /** 切换结果决定用户点开的图表是否真的显示。 */ () => {
  it('点击其他页签后互换选中态与隐藏态', /** 选中态不跟随点击会让面板停留在旧图表上。 */ async () => {
    const wrapper = mountTabs(true);

    await wrapper.findAll('[role="tab"]')[1]?.trigger('mousedown');
    await wrapper.findAll('[role="tab"]')[1]?.trigger('click');
    await nextTick();

    const panels = wrapper.findAll('[role="tabpanel"]');
    expect(panels[1]?.attributes('data-state')).toBe('active');
    expect(panels[1]?.attributes('hidden')).toBeUndefined();
    expect(panels[0]?.attributes('data-state')).toBe('inactive');
    expect(panels[0]?.attributes('hidden')).toBeDefined();
    // 切换后展示的是销售额面板的内容，插槽与页签取值的关联不能错位。
    expect(
      wrapper.find('[role="tabpanel"][data-state="active"]').text(),
    ).toContain('DUMMY-销售额图表');
    wrapper.unmount();
  });
});
