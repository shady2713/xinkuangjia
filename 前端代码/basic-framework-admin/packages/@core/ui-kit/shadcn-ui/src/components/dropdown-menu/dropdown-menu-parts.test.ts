/**
 * 下拉菜单封装（shadcn-ui 的 components/dropdown-menu）菜单项与选中反馈回归。
 *
 * 普通下拉菜单按 menus 渲染菜单项与分隔线，点击时执行 handler 并跳过禁用项；单选下拉菜单用当前
 * 选中值标记激活项，点击后更新选中值。菜单项漏渲染、禁用项仍执行或选中反馈丢失都会让工具栏操作
 * 出错。用例真实挂载 reka-ui 的菜单根节点，用真实指针事件打开菜单并读取真实 DOM 与回调。
 */
import { mount } from '@vue/test-utils';
import { h } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import DropdownMenu from './dropdown-menu.vue';
import DropdownRadioMenu from './dropdown-radio-menu.vue';

/** 每个用例挂载的宿主，用例结束后统一卸载以清理传送节点。 */
let mounted: ReturnType<typeof mount> | undefined;

afterEach(
  /** 卸载宿主并清理传送节点，避免残留影响后续用例。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    document.body.innerHTML = '';
  },
);

/**
 * 点击下拉菜单触发件把菜单真正展开。
 * @param wrapper 已挂载的菜单宿主包装器。
 * @param triggerSelector 触发件选择器，单选菜单的触发件由调用方插槽提供。
 * @returns 菜单展开后的 Promise。
 */
async function openMenu(
  wrapper: ReturnType<typeof mount>,
  triggerSelector = 'button',
) {
  // get 在找不到触发件时会直接失败，比 find 更适合作为用例前置条件。
  const trigger = wrapper.get(triggerSelector);
  await trigger.trigger('pointerdown', { button: 0 });
  await trigger.trigger('click');
  await trigger.trigger('keydown', { key: 'ArrowDown' });
  await new Promise(
    /** 等待传送节点真实渲染完成。 */ (resolve) => {
      setTimeout(resolve, 0);
    },
  );
}

describe('普通下拉菜单', /** 菜单项与禁用逻辑决定工具栏操作是否正确。 */ () => {
  it('按 menus 渲染菜单项文案与分隔线', /** 菜单项漏渲染会让用户看不到操作入口。 */ async () => {
    mounted = mount(DropdownMenu, {
      props: {
        menus: [
          { handler: vi.fn(), label: 'DUMMY-刷新', value: 'refresh' },
          {
            label: 'DUMMY-更多',
            separator: true,
            value: 'more',
          },
        ],
      },
      slots: { default: '操作' },
    });

    await openMenu(mounted);

    expect(document.body.textContent).toContain('DUMMY-刷新');
    expect(document.body.textContent).toContain('DUMMY-更多');
    expect(document.querySelectorAll('[role="menuitem"]').length).toBe(2);
    expect(document.querySelectorAll('[role="separator"]').length).toBe(1);
  });

  it('点击菜单项执行 handler 并透传菜单属性', /** payload 未透传会让业务拿不到当前菜单配置。 */ async () => {
    const handler = vi.fn();
    const menus = [{ handler, label: 'DUMMY-编辑', value: 'edit' }];
    mounted = mount(DropdownMenu, {
      props: { menus },
      slots: { default: '操作' },
    });
    await openMenu(mounted);

    const item = document.querySelector('[role="menuitem"]') as HTMLElement;
    item.click();
    await new Promise(
      /** 等待点击回调真实执行。 */ (resolve) => {
        setTimeout(resolve, 0);
      },
    );

    expect(handler).toHaveBeenCalledTimes(1);
    // 组件把自身属性作为点击载荷交给 handler，业务据此读取菜单配置。
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ menus });
  });

  it('禁用菜单项不执行 handler', /** 禁用项仍执行会让用户触发不该做的操作。 */ async () => {
    const handler = vi.fn();
    mounted = mount(DropdownMenu, {
      props: {
        menus: [{ disabled: true, handler, label: 'DUMMY-删除', value: 'del' }],
      },
      slots: { default: '操作' },
    });
    await openMenu(mounted);

    const item = document.querySelector('[role="menuitem"]') as HTMLElement;
    item.click();
    await new Promise(
      /** 等待点击事件真实派发完成。 */ (resolve) => {
        setTimeout(resolve, 0);
      },
    );

    expect(handler).not.toHaveBeenCalled();
    expect(item.dataset.disabled).toBe('');
  });
});

describe('单选下拉菜单', /** 选中反馈决定用户能否辨认当前生效项。 */ () => {
  it('按当前值标记激活项并渲染未选中圆点', /** 缺少激活标记会让用户不知道当前选的是哪一项。 */ async () => {
    mounted = mount(DropdownRadioMenu, {
      props: {
        menus: [
          { label: 'DUMMY-按名称', value: 'name' },
          { label: 'DUMMY-按时间', value: 'created' },
        ],
        modelValue: 'name',
      },
      slots: { default: '<button class="radio-trigger">排序</button>' },
    });

    await openMenu(mounted, '.radio-trigger');

    const items = [...document.querySelectorAll('[role="menuitem"]')];
    expect(items).toHaveLength(2);
    // 用 class 列表而不是整串匹配：未选中项也带 data-[state=checked]:bg-accent 条件类。
    expect(items[0]?.classList.contains('bg-accent')).toBe(true);
    expect(items[1]?.classList.contains('bg-accent')).toBe(false);
    // 未带图标的菜单项渲染圆点占位，选中项用前景色填充。
    expect(items[0]?.querySelector('span')?.className).toContain(
      'bg-foreground',
    );
  });

  it('点击菜单项更新选中值', /** 不更新会让排序条件始终停留在旧值。 */ async () => {
    const updates: unknown[] = [];
    mounted = mount(DropdownRadioMenu, {
      props: {
        menus: [{ label: 'DUMMY-按时间', value: 'created' }],
        modelValue: 'name',
        /** 记录取值更新。 */
        'onUpdate:modelValue': (value: unknown) => {
          updates.push(value);
        },
      },
      slots: { default: '<button class="radio-trigger">排序</button>' },
    });
    await openMenu(mounted, '.radio-trigger');

    (document.querySelector('[role="menuitem"]') as HTMLElement).click();
    await new Promise(
      /** 等待点击回调真实执行。 */ (resolve) => {
        setTimeout(resolve, 0);
      },
    );

    expect(updates).toEqual(['created']);
  });

  it('带图标的菜单项不渲染圆点占位', /** 图标与圆点同时渲染会让菜单项缩进错乱。 */ async () => {
    mounted = mount(DropdownRadioMenu, {
      props: {
        menus: [
          {
            /** 菜单项图标。 */
            icon: () => h('i', { class: 'menu-icon' }),
            label: 'DUMMY-带图标',
            value: 'icon',
          },
        ],
        modelValue: 'icon',
      },
      slots: { default: '<button class="radio-trigger">排序</button>' },
    });

    await openMenu(mounted, '.radio-trigger');

    expect(document.querySelector('.menu-icon')).not.toBeNull();
    expect(document.querySelector('[role="menuitem"] span')).toBeNull();
  });
});
