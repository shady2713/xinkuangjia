/**
 * 工作台快捷入口（common-ui 的 ui/dashboard/workbench/workbench-quick-nav）渲染与点击回归。
 *
 * 组件按三列铺开快捷入口：每个入口要显示自己的图标与标题，边角与分隔线样式由序号决定，
 * 序号判断写错会让格子出现缺边或多边；点击入口必须把该条目原样抛出，否则调用方无法跳转。
 * 用例真实挂载组件、真实点击入口，并断言真实 DOM 样式类与抛出的载荷。
 */
import { mount } from '@vue/test-utils';
import { h } from 'vue';

import { describe, expect, it } from 'vitest';

import WorkbenchQuickNav from './workbench-quick-nav.vue';

/**
 * 快捷入口图标替身：渲染一个可识别的图标占位。
 * @returns 图标节点的虚拟 DOM。
 */
function quickNavIcon() {
  return h('span', { class: 'quick-nav-icon' }, 'DUMMY-图标');
}

/** 快捷入口夹具：四个条目，序号同时覆盖三列分隔线与四角圆角的判断分支。 */
const NAV_ITEMS = [
  { color: '#1677ff', icon: quickNavIcon, title: 'DUMMY-待办' },
  { color: '#52c41a', icon: quickNavIcon, title: 'DUMMY-消息' },
  { color: '#faad14', icon: quickNavIcon, title: 'DUMMY-日程' },
  { color: '#f5222d', icon: quickNavIcon, title: 'DUMMY-报表' },
];

/**
 * 挂载快捷入口组件。
 * @param items 快捷入口条目；传空数组时走组件的空列表分支。
 * @returns 已挂载的组件包装器。
 */
function mountQuickNav(items: typeof NAV_ITEMS) {
  return mount(WorkbenchQuickNav, {
    props: { items, title: 'DUMMY-快捷入口' },
  });
}

describe('工作台快捷入口渲染', /** 图标与标题错位会让用户点进错误的入口。 */ () => {
  it('渲染标题与每个入口的图标标题', /** 条目丢失会让用户少看到可用的快捷入口。 */ () => {
    const wrapper = mountQuickNav(NAV_ITEMS);
    const cells = wrapper.findAll('.group');

    expect(wrapper.text()).toContain('DUMMY-快捷入口');
    expect(cells).toHaveLength(4);
    expect(cells[0]?.text()).toContain('DUMMY-待办');
    expect(cells[3]?.text()).toContain('DUMMY-报表');
    expect(cells[0]?.find('.quick-nav-icon').exists()).toBe(true);
    wrapper.unmount();
  });

  it('按序号设置分隔线与圆角样式', /** 序号判断写错会让格子出现缺边、多边或方角。 */ () => {
    const wrapper = mountQuickNav(NAV_ITEMS);
    const cells = wrapper.findAll('.group');

    // 每行第三个去掉右边框，前三个去掉下边框。
    expect(cells[0]?.classes()).toContain('border-b-0');
    expect(cells[0]?.classes()).not.toContain('border-r-0');
    expect(cells[2]?.classes()).toContain('border-r-0');
    expect(cells[2]?.classes()).toContain('border-b-0');
    // 第二行补下内边距，并给首尾格子分别补左下、右下圆角。
    expect(cells[3]?.classes()).toContain('pb-4');
    expect(cells[1]?.classes()).toContain('rounded-bl-xl');
    expect(cells[3]?.classes()).toContain('rounded-br-xl');
    expect(cells[0]?.classes()).not.toContain('rounded-bl-xl');
    wrapper.unmount();
  });

  it('未提供条目时只渲染卡片标题', /** 空列表渲染出空格子会让卡片出现无内容的占位块。 */ () => {
    const wrapper = mountQuickNav([]);

    expect(wrapper.text()).toContain('DUMMY-快捷入口');
    expect(wrapper.findAll('.group')).toHaveLength(0);
    wrapper.unmount();
  });
});

describe('工作台快捷入口点击', /** 点击载荷决定调用方能否跳到正确页面。 */ () => {
  it('点击入口抛出该条目的完整数据', /** 载荷丢失或抛错条目会让跳转指向别人的地址。 */ async () => {
    const wrapper = mountQuickNav(NAV_ITEMS);

    await wrapper.findAll('.group')[1]?.trigger('click');

    const emitted = wrapper.emitted('click');
    expect(emitted).toHaveLength(1);
    expect(emitted?.[0]?.[0]).toEqual(NAV_ITEMS[1]);
    wrapper.unmount();
  });
});
