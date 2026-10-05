/**
 * 工作台项目列表（common-ui 的 ui/dashboard/workbench/workbench-project）渲染与点击回归。
 *
 * 组件按栅格铺开项目条目：每条要显示图标、标题、分组说明与进度文本，字段取错会让用户看到
 * 别的项目信息；边角与分隔线样式由序号决定，序号判断写错会让格子缺边或多边；点击条目必须
 * 把该条目原样抛出，否则调用方无法跳转到项目详情。用例真实挂载组件、真实点击条目并断言
 * 真实 DOM 与抛出载荷。
 */
import { mount } from '@vue/test-utils';
import { h } from 'vue';

import { describe, expect, it } from 'vitest';

import WorkbenchProject from './workbench-project.vue';

/**
 * 项目图标替身：渲染一个可识别的图标占位。
 * @returns 图标节点的虚拟 DOM。
 */
function projectIcon() {
  return h('span', { class: 'project-icon' }, 'DUMMY-图标');
}

/** 项目条目夹具：四个条目，序号同时覆盖三列分隔线与四角圆角的判断分支。 */
const PROJECT_ITEMS = [
  {
    color: '#1677ff',
    content: 'DUMMY-已完成 8/10',
    date: '2024-05-01',
    group: 'DUMMY-中台组',
    icon: projectIcon,
    title: 'DUMMY-报表中心',
    url: 'https://DUMMY-project.example.com/report',
  },
  {
    color: '#52c41a',
    content: 'DUMMY-已完成 3/8',
    date: '2024-05-02',
    group: 'DUMMY-业务组',
    icon: projectIcon,
    title: 'DUMMY-订单中心',
  },
  {
    color: '#faad14',
    content: 'DUMMY-已完成 1/4',
    date: '2024-05-03',
    group: 'DUMMY-基础组',
    icon: projectIcon,
    title: 'DUMMY-权限中心',
  },
  {
    color: '#f5222d',
    content: 'DUMMY-已完成 5/5',
    date: '2024-05-04',
    group: 'DUMMY-数据组',
    icon: projectIcon,
    title: 'DUMMY-数据看板',
  },
];

/**
 * 挂载项目列表组件。
 * @param items 项目条目；传空数组时走组件的空列表分支。
 * @returns 已挂载的组件包装器。
 */
function mountProject(items: typeof PROJECT_ITEMS) {
  return mount(WorkbenchProject, {
    props: { items, title: 'DUMMY-进行中的项目' },
  });
}

describe('工作台项目列表渲染', /** 项目字段错位会让用户看到别人的进度。 */ () => {
  it('渲染标题与每个项目的分组与进度', /** 分组或进度丢失会让项目条目只剩一个名字。 */ () => {
    const wrapper = mountProject(PROJECT_ITEMS);
    const cells = wrapper.findAll('.group');

    expect(wrapper.text()).toContain('DUMMY-进行中的项目');
    expect(cells).toHaveLength(4);
    expect(cells[0]?.text()).toContain('DUMMY-报表中心');
    expect(cells[0]?.text()).toContain('DUMMY-中台组');
    expect(cells[0]?.text()).toContain('DUMMY-已完成 8/10');
    expect(cells[3]?.text()).toContain('DUMMY-数据看板');
    expect(cells[0]?.find('.project-icon').exists()).toBe(true);
    wrapper.unmount();
  });

  it('按序号设置分隔线与圆角样式', /** 序号判断写错会让栅格出现缺边、多边或方角。 */ () => {
    const wrapper = mountProject(PROJECT_ITEMS);
    const cells = wrapper.findAll('.group');

    expect(cells[0]?.classes()).toContain('border-b-0');
    expect(cells[2]?.classes()).toContain('border-r-0');
    expect(cells[3]?.classes()).toContain('pb-4');
    expect(cells[1]?.classes()).toContain('rounded-bl-xl');
    expect(cells[3]?.classes()).toContain('rounded-br-xl');
    // 栅格断点类决定项目条目在不同屏幕宽度下的列数。
    expect(cells[0]?.classes()).toContain('lg:w-1/3');
    wrapper.unmount();
  });

  it('未提供项目时只渲染卡片标题', /** 空列表渲染出空条目会让卡片出现无内容的占位块。 */ () => {
    const wrapper = mountProject([]);

    expect(wrapper.text()).toContain('DUMMY-进行中的项目');
    expect(wrapper.findAll('.group')).toHaveLength(0);
    wrapper.unmount();
  });
});

describe('工作台项目点击', /** 点击载荷决定调用方能否跳到正确项目。 */ () => {
  it('点击项目抛出该条目的完整数据', /** 载荷丢失或抛错条目会让跳转指向别人的项目。 */ async () => {
    const wrapper = mountProject(PROJECT_ITEMS);

    await wrapper.findAll('.group')[2]?.trigger('click');

    const emitted = wrapper.emitted('click');
    expect(emitted).toHaveLength(1);
    expect(emitted?.[0]?.[0]).toEqual(PROJECT_ITEMS[2]);
    wrapper.unmount();
  });
});
