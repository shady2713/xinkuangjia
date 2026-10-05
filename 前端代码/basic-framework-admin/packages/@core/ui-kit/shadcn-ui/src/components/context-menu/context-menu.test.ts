/**
 * 右键菜单封装（shadcn-ui 的 components/context-menu）菜单构建与点击回归。
 *
 * 该封装按宿主实体动态构建菜单：menus 接收 handlerData 产出菜单项，隐藏项不渲染，禁用项不执行
 * handler，图标与快捷键按配置渲染。菜单构建或点击载荷写错会让右键菜单显示的项与实际实体不匹配，
 * 或执行到错误的动作。用例真实挂载 reka-ui 的菜单根节点，用真实右键事件打开并读取真实 DOM 与回调。
 *
 * 说明：reka-ui 的右键菜单在同一测试文件里连续打开时，第二次右键会被前一次会话的内部状态吞掉
 * （实测为交替成功），因此依赖「菜单已打开」的断言集中在同一个用例里，不用固定休眠掩盖。
 */
import { mount } from '@vue/test-utils';
import { h } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import ContextMenu from './context-menu.vue';

/** 每个用例挂载的宿主，用例结束后统一卸载。 */
let mounted: ReturnType<typeof mount> | undefined;

afterEach(
  /** 卸载宿主并移除传送节点，避免残留影响后续用例。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    // 只摘掉浮层节点而不整体清空 body：清空会破坏后续用例的传送目标。
    document
      .querySelectorAll(
        '[data-reka-popper-content-wrapper], [data-reka-focus-guard]',
      )
      .forEach(
        /** 移除该浮层节点。 */ (node) => {
          node.remove();
        },
      );
  },
);

/** 宿主实体夹具：菜单构建与点击回调都只做透传。 */
const HANDLER_DATA = { id: 42, name: 'DUMMY-标签页' };

/**
 * 按文本取出已渲染的菜单项。
 * @param text 菜单项文案。
 * @returns 命中的菜单项元素。
 * @throws Error 菜单项未渲染时抛出，避免用例静默地什么都不验证。
 */
function menuItem(text: string) {
  const item = [...document.querySelectorAll('[role="menuitem"]')].find(
    /** 只挑出文案匹配的菜单项。 */ (node) => node.textContent?.includes(text),
  );
  if (!item) {
    throw new Error(`右键菜单未渲染菜单项：${text}`);
  }
  return item as HTMLElement;
}

describe('右键菜单构建与渲染', /** 菜单项是否与宿主实体匹配决定右键操作是否正确。 */ () => {
  it('按宿主数据渲染菜单项并只对可用项执行 handler', /** 渲染或点击逻辑写错会让用户看到不该出现的操作，或执行到错误的动作。 */ async () => {
    const enabledHandler = vi.fn();
    const disabledHandler = vi.fn();
    const menus = vi.fn(
      /** 记录收到的宿主数据并产出菜单项。 */ (data: object) => {
        // 属性经 Vue 响应式代理后不是同一引用，按内容核对。
        expect(data).toEqual(HANDLER_DATA);
        return [
          {
            /** 菜单项图标。 */
            icon: () => h('i', { class: 'menu-icon' }),
            key: 'refresh',
            shortcut: 'Ctrl+R',
            text: 'DUMMY-刷新',
          },
          { hidden: true, key: 'hidden', text: 'DUMMY-隐藏项' },
          // 纯分割线：条目本身隐藏，只留下一条分隔线。
          { hidden: true, key: 'divider', separator: true, text: '分割线' },
          {
            disabled: true,
            handler: disabledHandler,
            key: 'del',
            text: 'DUMMY-删除',
          },
          { handler: enabledHandler, key: 'edit', text: 'DUMMY-编辑' },
        ];
      },
    );
    mounted = mount(ContextMenu, {
      props: {
        contentClass: 'custom-content',
        handlerData: HANDLER_DATA,
        itemClass: 'custom-item',
        menus,
      },
      slots: { default: '<span class="ctx-trigger">右键区域</span>' },
    });
    const trigger = mounted.find('.ctx-trigger');
    await trigger.trigger('contextmenu', {
      button: 2,
      clientX: 10,
      clientY: 20,
    });
    // 菜单在下一帧才真正打开，轮询等待打开状态而不是固定休眠。
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise(
        /** 让出一轮事件循环等待菜单打开。 */ (resolve) => {
          setTimeout(resolve, 0);
        },
      );
      if (trigger.attributes('data-state') === 'open') {
        break;
      }
    }

    expect(trigger.attributes('data-state')).toBe('open');
    expect(menus).toHaveBeenCalledTimes(1);
    expect(menus).toHaveBeenCalledWith(HANDLER_DATA);
    expect(document.body.textContent).toContain('DUMMY-刷新');
    expect(document.body.textContent).not.toContain('DUMMY-隐藏项');
    expect(document.querySelector('.menu-icon')).not.toBeNull();
    expect(document.querySelector('[role="menuitem"]')?.textContent).toContain(
      'Ctrl+R',
    );
    expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(3);
    expect(document.querySelectorAll('[role="separator"]')).toHaveLength(1);
    expect(document.querySelector('.custom-content')?.className).toContain(
      'side-content',
    );
    expect(document.querySelector('.custom-item')).not.toBeNull();

    const disabled = menuItem('DUMMY-删除');
    expect(disabled.dataset.disabled).toBe('');
    disabled.click();
    menuItem('DUMMY-编辑').click();
    await new Promise(
      /** 等待点击回调真实执行。 */ (resolve) => {
        setTimeout(resolve, 0);
      },
    );

    expect(disabledHandler).not.toHaveBeenCalled();
    expect(enabledHandler).toHaveBeenCalledWith(HANDLER_DATA);
  });
});
