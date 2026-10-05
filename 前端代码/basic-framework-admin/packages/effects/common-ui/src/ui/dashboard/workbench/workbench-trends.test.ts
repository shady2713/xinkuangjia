/**
 * 工作台动态列表（common-ui 的 ui/dashboard/workbench/workbench-trends）渲染回归。
 *
 * 组件把动态条目按卡片列出：每个条目要显示自己的头像、标题、摘要与时间，任何一项错位都会
 * 让用户把别人的动态当成自己的，头像缺失或条目丢失会让动态区变成一片空白。用例真实挂载
 * 组件、等待离线图标渲染，并断言真实 DOM 中的条目结构与文案。
 */
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { describe, expect, it, vi } from 'vitest';

import WorkbenchTrends from './workbench-trends.vue';

/** 动态条目夹具：两条内容不同的动态，用于核对字段不会串位。 */
const ITEMS = [
  {
    avatar: 'lucide:user',
    content: 'DUMMY-在客户管理系统发布了新版本',
    date: 'DUMMY-2024-05-01',
    title: 'DUMMY-版本发布',
  },
  {
    avatar: 'lucide:activity',
    content: 'DUMMY-完成了季度安全巡检',
    date: 'DUMMY-2024-05-02',
    title: 'DUMMY-安全巡检',
  },
];

describe('工作台动态列表', /** 条目字段与数量决定用户能否读懂团队动态。 */ () => {
  it('渲染标题与每个条目的头像、标题、摘要和时间', /** 字段串位会让用户读错动态内容与时间。 */ async () => {
    const wrapper = mount(WorkbenchTrends, {
      props: { items: ITEMS, title: 'DUMMY-最新动态' },
    });
    const rows = wrapper.findAll('li');

    expect(wrapper.find('h3').text()).toBe('DUMMY-最新动态');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.text()).toContain('DUMMY-版本发布');
    expect(rows[0]?.text()).toContain('DUMMY-在客户管理系统发布了新版本');
    expect(rows[0]?.text()).toContain('DUMMY-2024-05-01');
    expect(rows[1]?.text()).toContain('DUMMY-安全巡检');
    expect(rows[1]?.text()).toContain('DUMMY-完成了季度安全巡检');
    // 头像用离线 lucide 图标集合，等待图标数据写入后必须渲染出真实图元。
    await nextTick();
    await vi.waitFor(
      /** 等待两个条目的头像图标真实渲染。 */ () => {
        expect(wrapper.findAll('svg.iconify--lucide')).toHaveLength(2);
      },
    );
    wrapper.unmount();
  });

  it('未传入条目时只渲染空列表', /** 空数据渲染出无名条目会让动态区出现占位垃圾。 */ () => {
    const wrapper = mount(WorkbenchTrends, {
      props: { title: 'DUMMY-最新动态' },
    });

    expect(wrapper.find('h3').text()).toBe('DUMMY-最新动态');
    expect(wrapper.findAll('li')).toHaveLength(0);
    expect(wrapper.find('ul').attributes('role')).toBe('list');
    wrapper.unmount();
  });

  it('传入空数组时同样不渲染条目', /** 空数组被当成有数据会让列表出现空行。 */ () => {
    const wrapper = mount(WorkbenchTrends, {
      props: { items: [], title: 'DUMMY-最新动态' },
    });

    expect(wrapper.findAll('li')).toHaveLength(0);
    wrapper.unmount();
  });
});
