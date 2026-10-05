/**
 * 工作台待办列表（common-ui 的 ui/dashboard/workbench/workbench-todo）渲染与勾选回归。
 *
 * 组件按行列出待办：已完成条目必须加上删除线与弱化样式，否则用户分不清哪些事情还没做；
 * 勾选复选框要通过 v-model 真实写回条目的 completed 字段，写不回去会让刷新后勾选状态丢失；
 * 标题、内容与日期取错会让用户看到别人的待办。用例真实挂载组件、真实点击复选框，并断言
 * 真实 DOM 样式与条目对象的真实变更。
 */
import { mount } from '@vue/test-utils';
import { nextTick, reactive } from 'vue';

import { describe, expect, it } from 'vitest';

import WorkbenchTodo from './workbench-todo.vue';

/**
 * 构造待办夹具。
 * @returns 可被组件真实写回的可变待办数组，首条未完成、次条已完成。
 */
function createTodoItems() {
  return reactive([
    {
      completed: false,
      content: 'DUMMY-整理季度报表',
      date: '2024-05-01',
      title: 'DUMMY-季度复盘',
    },
    {
      completed: true,
      content: 'DUMMY-回复客户邮件',
      date: '2024-05-02',
      title: 'DUMMY-客户跟进',
    },
  ]);
}

/**
 * 挂载待办列表组件。
 * @param items 待办条目；传空数组时走组件的空列表分支。
 * @returns 已挂载的组件包装器。
 */
function mountTodo(items: ReturnType<typeof createTodoItems>) {
  return mount(WorkbenchTodo, {
    props: { items, title: 'DUMMY-待办事项' },
  });
}

describe('工作台待办渲染', /** 完成态样式决定用户能否一眼看出剩余工作。 */ () => {
  it('已完成条目带删除线与弱化样式', /** 完成态样式缺失会让用户重复处理已经做完的事。 */ () => {
    const items = createTodoItems();
    const wrapper = mountTodo(items);
    const rows = wrapper.findAll('li');

    expect(wrapper.text()).toContain('DUMMY-待办事项');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.classes()).not.toContain('line-through');
    expect(rows[0]?.classes()).not.toContain('opacity-60');
    expect(rows[1]?.classes()).toContain('line-through');
    expect(rows[1]?.classes()).toContain('opacity-60');
    expect(rows[1]?.classes()).toContain('select-none');
    wrapper.unmount();
  });

  it('渲染每条待办的标题、内容与日期', /** 字段错位会让用户看到别人的待办内容。 */ () => {
    const wrapper = mountTodo(createTodoItems());
    const rows = wrapper.findAll('li');

    expect(rows[0]?.text()).toContain('DUMMY-季度复盘');
    expect(rows[0]?.text()).toContain('DUMMY-整理季度报表');
    expect(rows[0]?.text()).toContain('2024-05-01');
    expect(rows[1]?.text()).toContain('DUMMY-客户跟进');
    wrapper.unmount();
  });

  it('未提供待办时不渲染任何条目', /** 空列表渲染出行会让卡片出现无内容的占位行。 */ () => {
    const wrapper = mountTodo([]);

    expect(wrapper.text()).toContain('DUMMY-待办事项');
    expect(wrapper.findAll('li')).toHaveLength(0);
    wrapper.unmount();
  });
});

describe('工作台待办勾选', /** 勾选写回决定完成状态能否被业务方保存。 */ () => {
  it('点击复选框写回 completed 并刷新完成态样式', /** 写不回条目会让用户勾了又弹回未完成。 */ async () => {
    const items = createTodoItems();
    const wrapper = mountTodo(items);

    const checkbox = wrapper.findAll('li')[0]?.find('button[role="checkbox"]');
    expect(checkbox?.attributes('data-state')).toBe('unchecked');

    await checkbox?.trigger('click');
    await nextTick();

    // 真实写回条目对象，刷新后完成状态才不会丢失。
    expect(items[0]?.completed).toBe(true);
    const rows = wrapper.findAll('li');
    expect(rows[0]?.classes()).toContain('line-through');
    expect(
      rows[0]?.find('button[role="checkbox"]').attributes('data-state'),
    ).toBe('checked');
    wrapper.unmount();
  });

  it('点击已完成条目的复选框可取消勾选', /** 只能单向勾选会让用户无法纠正误操作。 */ async () => {
    const items = createTodoItems();
    const wrapper = mountTodo(items);

    await wrapper
      .findAll('li')[1]
      ?.find('button[role="checkbox"]')
      .trigger('click');
    await nextTick();

    expect(items[1]?.completed).toBe(false);
    const rows = wrapper.findAll('li');
    expect(rows[1]?.classes()).not.toContain('line-through');
    wrapper.unmount();
  });
});
