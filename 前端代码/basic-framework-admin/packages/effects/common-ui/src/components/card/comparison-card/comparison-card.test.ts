/**
 * 对比卡片（common-ui 的 components/card/comparison-card/comparison-card）真实行为回归。
 *
 * 卡片用图标表示被统计的对象，并展示累计值与今日新增：图标名映射写错会让「消息」显示成
 * 「应用」的图标，未知图标未回退会让卡片空一块，缺失值未显示为 `--` 会把「暂无数据」显示成
 * 0，加载态未透传会让用户对着旧数字做判断。用例真实挂载卡片、真实等待数字滚动结束，
 * 并断言真实 DOM 中的图标、数值与加载态。
 *
 * 远程 Iconify 图标集合与数字滚动动画是本组件的外部边界：测试环境不应联网取图标，因此把
 * 用到的四个 ant-design 图标离线登记并给每个图标一个专属形状，用于核对映射结果。
 */
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { addIcon } from '@vben/icons';

import { describe, expect, it, vi } from 'vitest';

import ComparisonCard from './comparison-card.vue';

/** 离线登记的图标名到专属形状类名的映射，形状类名用于断言图标映射结果。 */
const ICON_BODY_CLASS: Record<string, string> = {
  'ant-design:appstore-outlined': 'DUMMY-icon-menu',
  'ant-design:box-plot-outlined': 'DUMMY-icon-box',
  'ant-design:cluster-outlined': 'DUMMY-icon-cpu',
  'ant-design:message-outlined': 'DUMMY-icon-message',
};

for (const [name, className] of Object.entries(ICON_BODY_CLASS)) {
  addIcon(name, {
    body: `<path class="${className}" d="M0 0h1v1z"></path>`,
    height: 24,
    width: 24,
  });
}

describe('对比卡片渲染', /** 图标与数值决定用户能否正确理解统计对象。 */ () => {
  it('按图标名渲染对应图标', /** 图标映射错位会让用户把消息量当成应用数。 */ async () => {
    const wrapper = mount(ComparisonCard, {
      props: {
        icon: 'box',
        title: 'DUMMY-数据总量',
        todayCount: 12,
        value: 1234,
      },
    });

    expect(wrapper.text()).toContain('DUMMY-数据总量');
    expect(wrapper.text()).toContain('今日新增');
    expect(wrapper.text()).toContain('+12');
    await nextTick();
    await vi.waitFor(
      /** 等待离线图标渲染，确认图标名真的映射到 box 图标。 */ () => {
        expect(wrapper.find('.DUMMY-icon-box').exists()).toBe(true);
      },
    );
    expect(wrapper.find('.DUMMY-icon-menu').exists()).toBe(false);
    wrapper.unmount();
  });

  it('未知图标名回退到默认图标', /** 未回退会让新业务传入的图标名把卡片渲染成空白。 */ async () => {
    const wrapper = mount(ComparisonCard, {
      props: {
        icon: 'DUMMY-unknown-icon',
        title: 'DUMMY-数据总量',
        todayCount: 0,
        value: 42,
      },
    });

    await nextTick();
    await vi.waitFor(
      /** 等待回退图标渲染，确认默认映射生效。 */ () => {
        expect(wrapper.find('.DUMMY-icon-menu').exists()).toBe(true);
      },
    );
    expect(wrapper.find('.DUMMY-icon-box').exists()).toBe(false);
    wrapper.unmount();
  });

  it('数值滚动到结束值并保留千位分组', /** 数字停在起始值或丢掉分组会让统计数字不可信。 */ async () => {
    const wrapper = mount(ComparisonCard, {
      props: {
        icon: 'cpu',
        title: 'DUMMY-数据总量',
        todayCount: 7,
        value: 1234,
      },
    });

    await vi.waitFor(
      /** 等待滚动动画把累计值带到结束值，再核对千位分组。 */ () => {
        expect(wrapper.text()).toContain('1,234');
      },
      { timeout: 5000 },
    );
    expect(wrapper.text()).toContain('+7');
    wrapper.unmount();
  });

  it('数值缺失时显示占位符而不是零', /** 把缺失值显示成 0 会让用户以为统计结果真的是零。 */ async () => {
    const wrapper = mount(ComparisonCard, {
      props: {
        icon: 'menu',
        title: 'DUMMY-数据总量',
        todayCount: -1,
        value: -1,
      },
    });

    expect(wrapper.text()).toContain('--');
    expect(wrapper.text()).not.toContain('+');
    // 缺失值不得再渲染滚动数字。
    expect(wrapper.findAll('span.absolute')).toHaveLength(0);
    wrapper.unmount();
  });

  it('图标颜色类名按调用方传入渲染', /** 颜色类丢失会让不同指标的卡片无法区分。 */ async () => {
    const wrapper = mount(ComparisonCard, {
      props: {
        icon: 'message',
        iconColor: 'text-blue-500',
        title: 'DUMMY-消息量',
        todayCount: 3,
        value: 9,
      },
    });

    expect(wrapper.find('div.text-4xl').classes()).toContain('text-blue-500');
    await nextTick();
    await vi.waitFor(
      /** 等待图标渲染后核对映射到消息图标。 */ () => {
        expect(wrapper.find('.DUMMY-icon-message').exists()).toBe(true);
      },
    );
    wrapper.unmount();
  });
});

describe('对比卡片加载态', /** 加载态决定用户看到的是新数据还是过期数据。 */ () => {
  it('未加载时不显示遮罩', /** 遮罩常驻会挡住卡片内容，用户什么都读不到。 */ () => {
    const wrapper = mount(ComparisonCard, {
      props: {
        icon: 'box',
        loading: false,
        title: 'DUMMY-数据总量',
        todayCount: 1,
        value: 1,
      },
    });

    const overlay = wrapper.find('div.absolute.left-0');
    expect(overlay.classes()).toContain('invisible');
    expect(overlay.classes()).toContain('opacity-0');
    wrapper.unmount();
  });

  it('加载中时在最短加载时间后显示遮罩', /** 加载态未透传会让用户对着旧数字做判断。 */ async () => {
    const wrapper = mount(ComparisonCard, {
      props: {
        icon: 'box',
        loading: true,
        title: 'DUMMY-数据总量',
        todayCount: 1,
        value: 1,
      },
    });

    const overlay = wrapper.find('div.absolute.left-0');
    await vi.waitFor(
      /** 等待实现声明的最短加载时间结束后遮罩出现。 */ () => {
        expect(overlay.classes()).not.toContain('invisible');
      },
    );
    expect(overlay.find('.dot').exists()).toBe(true);
    wrapper.unmount();
  });
});
