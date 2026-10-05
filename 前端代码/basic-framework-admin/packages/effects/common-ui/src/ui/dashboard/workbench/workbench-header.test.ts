/**
 * 工作台页头（common-ui 的 ui/dashboard/workbench/workbench-header）插槽与统计回归。
 *
 * 页头承载头像、标题与说明插槽以及固定的待办/项目/团队统计：插槽条件判断写错会让标题或
 * 说明整行消失，统计文案丢失会让用户看不到关键数字。用例真实挂载组件并断言真实 DOM。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import WorkbenchHeader from './workbench-header.vue';

describe('工作台页头插槽', /** 插槽条件决定欢迎语与说明能否显示。 */ () => {
  it('同时提供标题与说明时渲染两行文案', /** 插槽内容被吞掉会让页头只剩头像和数字。 */ () => {
    const wrapper = mount(WorkbenchHeader, {
      props: { avatar: 'https://DUMMY-avatar.example.com/avatar.png' },
      slots: {
        description: 'DUMMY-今天也要加油',
        title: 'DUMMY-早上好，管理员',
      },
    });

    expect(wrapper.find('h1').text()).toBe('DUMMY-早上好，管理员');
    expect(wrapper.find('h1').classes()).toContain('font-semibold');
    // 说明行用 mt-1 与统计区的三个说明标签区分开。
    expect(wrapper.find('span.mt-1').text()).toBe('DUMMY-今天也要加油');
    // 头像容器按传入尺寸渲染，尺寸类丢失会让头像撑变形。
    expect(wrapper.find('div.size-20').exists()).toBe(true);
    wrapper.unmount();
  });

  it('只提供标题时不渲染说明行', /** 说明插槽为空却渲染出空行会让页头出现多余留白。 */ () => {
    const wrapper = mount(WorkbenchHeader, {
      slots: { title: 'DUMMY-早上好，管理员' },
    });

    expect(wrapper.find('h1').text()).toBe('DUMMY-早上好，管理员');
    expect(wrapper.find('span.mt-1').exists()).toBe(false);
    wrapper.unmount();
  });

  it('未提供任何插槽时不渲染标题与说明', /** 空插槽渲染空标题会破坏页头布局与语义。 */ () => {
    const wrapper = mount(WorkbenchHeader);

    expect(wrapper.find('h1').exists()).toBe(false);
    expect(wrapper.find('span.mt-1').exists()).toBe(false);
    expect(wrapper.findAll(String.raw`span.text-foreground\/80`)).toHaveLength(
      3,
    );
    wrapper.unmount();
  });
});

describe('工作台页头统计', /** 统计数字是页头的核心信息，缺失会让用户失去工作概览。 */ () => {
  it('渲染待办、项目与团队数字', /** 数字错位会让用户按错误的数量安排工作。 */ () => {
    const wrapper = mount(WorkbenchHeader);
    const text = wrapper.text();

    expect(text).toContain('待办');
    expect(text).toContain('2/10');
    expect(text).toContain('项目');
    expect(text).toContain('团队');
    expect(text).toContain('300');
    wrapper.unmount();
  });
});
