/**
 * 分析页概览指标（common-ui 的 ui/dashboard/analysis/analysis-overview）渲染回归。
 *
 * 组件把后端指标按卡片铺开：每张卡片必须显示自己的标题、主指标数字、图标与总计说明，任何
 * 一项错位或丢失都会让运营读到别人的数字。用例真实挂载组件，真实等待数字滚动动画结束，
 * 并断言真实 DOM 中的标题、图标与格式化后的最终数值。
 */
import { mount } from '@vue/test-utils';
import { h, nextTick } from 'vue';

import { describe, expect, it, vi } from 'vitest';

import AnalysisOverview from './analysis-overview.vue';

/** 概览指标夹具：一项用组件形态图标，一项用离线 lucide 图标名，覆盖两种图标形态。 */
const ITEMS = [
  {
    /** 组件形态图标：核心图标组件必须按组件渲染而不是当字符串处理。 */
    icon: () => h('span', { class: 'custom-metric-icon' }, 'DUMMY-图标'),
    title: 'DUMMY-访问量',
    totalTitle: 'DUMMY-日均',
    totalValue: 6789,
    value: 12_345,
  },
  {
    icon: 'lucide:activity',
    title: 'DUMMY-销售额',
    totalTitle: 'DUMMY-月均',
    totalValue: 321,
    value: 42,
  },
];

describe('分析页概览指标', /** 指标与标题错位会让运营直接读错数据。 */ () => {
  it('按标题渲染卡片并滚动到最终数值', /** 数值没有滚动到结束值会让概览永远停在起始值。 */ async () => {
    const wrapper = mount(AnalysisOverview, { props: { items: ITEMS } });
    await nextTick();

    const cards = wrapper.findAll('.bg-card');
    expect(cards).toHaveLength(2);
    expect(cards[0]?.text()).toContain('DUMMY-访问量');
    expect(cards[0]?.text()).toContain('DUMMY-日均');
    expect(cards[1]?.text()).toContain('DUMMY-销售额');
    // 卡片组件未声明 title 属性，标题会透传到根节点，调用方仍能拿到原生悬停提示。
    expect(cards[0]?.attributes('title')).toBe('DUMMY-访问量');
    // 组件形态图标必须真实渲染出调用方给的组件。
    expect(cards[0]?.find('.custom-metric-icon').exists()).toBe(true);

    await vi.waitFor(
      /** 等待滚动动画把主指标与总计带到结束值，再核对千分位格式。 */ () => {
        expect(cards[0]?.text()).toContain('12,345');
        expect(cards[0]?.text()).toContain('6,789');
      },
      { timeout: 5000 },
    );

    await vi.waitFor(
      /** 等待离线图标集合命中，字符串图标才会渲染出真实图元。 */ () => {
        expect(cards[1]?.find('svg.iconify--lucide').exists()).toBe(true);
      },
      { timeout: 5000 },
    );

    // 第二张卡片的图标与主指标同样要落到结束值。
    expect(cards[1]?.text()).toContain('DUMMY-月均');
    expect(cards[1]?.text()).toContain('321');
    wrapper.unmount();
  });

  it('未提供指标时只渲染空栅格', /** 空数据渲染出无名卡片会让概览出现无意义的占位。 */ () => {
    const wrapper = mount(AnalysisOverview);

    expect(wrapper.classes()).toContain('grid');
    expect(wrapper.findAll('.bg-card')).toHaveLength(0);
    expect(wrapper.text()).toBe('');
    wrapper.unmount();
  });
});
