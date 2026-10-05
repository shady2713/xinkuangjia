/**
 * 页签工具栏更多按钮（tabs-ui 的 widgets/tool-more）菜单透传与回调回归。
 *
 * “更多”入口把被挤出的页签与批量操作收进下拉菜单：图标缺失会让工具栏出现空白热区，菜单
 * 未透传给下拉组件会让用户看不到任何操作项。用例真实挂载按钮，用真实指针事件展开 reka-ui
 * 的下拉菜单，读取传送节点里的真实 DOM 并执行菜单项回调。
 */
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import ToolMore from '../tool-more.vue';

/** 每个用例挂载的宿主，用例结束后统一卸载并清理传送节点。 */
let mounted: ReturnType<typeof mount> | undefined;

afterEach(
  /** 卸载宿主并清理传送节点，避免残留菜单影响后续用例。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    document.body.innerHTML = '';
  },
);

/**
 * 用真实指针事件展开更多按钮的下拉菜单。
 * @param wrapper 已挂载的更多按钮包装器。
 * @returns 菜单项真实渲染完成后的 Promise。
 */
async function openMoreMenu(wrapper: ReturnType<typeof mount>) {
  const trigger = wrapper.get('button');
  await trigger.trigger('pointerdown', { button: 0 });
  await trigger.trigger('click');
  await trigger.trigger('keydown', { key: 'ArrowDown' });
  await vi.waitFor(
    /** 等待传送节点真实渲染出菜单项。 */ () => {
      expect(document.querySelector('[role="menuitem"]')).not.toBeNull();
    },
  );
}

describe('页签更多按钮', /** 入口缺失或菜单未接线会让被挤出的页签无法访问。 */ () => {
  it('渲染更多入口图标与触发件', /** 图标缺失会让工具栏出现空白热区。 */ () => {
    mounted = mount(ToolMore, { props: { menus: [] } });

    expect(mounted.find('svg.lucide-layout-grid').exists()).toBe(true);
    expect(mounted.find('button').exists()).toBe(true);
  });

  it('展开后按 menus 渲染菜单项并执行回调', /** 菜单未透传会让“更多”入口形同虚设。 */ async () => {
    /** 记录菜单项回调，用于验证点击真实驱动业务。 */
    const handler = vi.fn();
    const menus = [
      { handler, label: 'DUMMY-关闭其他', value: 'close-others' },
      { disabled: true, handler, label: 'DUMMY-删除页签', value: 'delete' },
    ];
    mounted = mount(ToolMore, { props: { menus } });

    await openMoreMenu(mounted);

    expect(document.body.textContent).toContain('DUMMY-关闭其他');
    const items = [...document.querySelectorAll('[role="menuitem"]')];
    expect(items).toHaveLength(2);

    (items[0] as HTMLElement).click();
    await vi.waitFor(
      /** 等待点击回调真实执行。 */ () => {
        expect(handler).toHaveBeenCalledTimes(1);
      },
    );
    // 下拉组件把自身属性作为点击载荷交给 handler，业务据此读取当前菜单配置。
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ menus });
  });

  it('禁用菜单项被标记禁用且不执行回调', /** 禁用态失效会让用户触发不该做的批量操作。 */ async () => {
    /** 记录菜单项回调，用于验证禁用项被拦下。 */
    const handler = vi.fn();
    mounted = mount(ToolMore, {
      props: {
        menus: [
          { disabled: true, handler, label: 'DUMMY-删除页签', value: 'x' },
        ],
      },
    });

    await openMoreMenu(mounted);
    const item = document.querySelector('[role="menuitem"]') as HTMLElement;
    expect(item.dataset.disabled).toBe('');

    item.click();
    await nextTick();

    expect(handler).not.toHaveBeenCalled();
  });
});
