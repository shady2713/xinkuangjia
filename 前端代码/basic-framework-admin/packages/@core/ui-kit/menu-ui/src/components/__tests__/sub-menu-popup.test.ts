/**
 * 子菜单浮层（menu-ui 的 components/sub-menu）横向模式的真实交互回归。
 *
 * 横向菜单与折叠菜单不再内联展开子菜单，而是把下级放在浮层里：浮层容器未渲染会让横向菜单
 * 点不开下级入口，悬停延时写错会让浮层闪开闪关，移出后不收会让浮层一直挂在界面上挡住页面。
 * 用例挂载真实 Menu 与 SubMenu，驱动真实鼠标与焦点事件，只把计时器换成可推进的假计时器以
 * 精确观察延时展开与延时收起，浮层内容通过真实传送节点读取。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MenuItem from '../menu-item.vue';
import Menu from '../menu.vue';
import SubMenu from '../sub-menu.vue';

/** 本文件已挂载的宿主包装器，用例结束后统一卸载以清理传送节点。 */
const mountedWrappers: ReturnType<typeof mount>[] = [];

/**
 * 挂载一棵横向模式菜单树，内含一个带下级菜单项的子菜单。
 * @returns 已挂载的宿主包装器。
 */
function mountHorizontalSubMenu() {
  const Host = defineComponent({
    name: 'SubMenuPopupHost',
    /** 渲染真实菜单容器与子菜单，子菜单标题通过命名插槽提供。
     * @returns 渲染菜单树的渲染函数。
     */
    setup() {
      return /** 渲染真实横向菜单树。 */ () =>
        h(
          Menu,
          { mode: 'horizontal' },
          {
            /** 菜单容器的默认插槽：一个子菜单。 */
            default: () =>
              h(
                SubMenu,
                { path: '/system' },
                {
                  /** 子菜单的下级菜单项。 */
                  default: () =>
                    h(
                      MenuItem,
                      { path: '/system/user' },
                      {
                        /** 下级菜单项文案。 */
                        default: () => 'DUMMY-用户管理',
                      },
                    ),
                  /** 子菜单标题文案。 */
                  title: () => 'DUMMY-系统管理',
                },
              ),
          },
        );
    },
  });

  const wrapper = mount(Host);
  mountedWrappers.push(wrapper);
  return wrapper;
}

/**
 * 读取传送到 body 的子菜单浮层容器。
 * @returns 浮层容器元素。
 * @throws Error 浮层未渲染时抛出，避免断言落到 undefined。
 */
function readPopup() {
  const popup = document.querySelector('.vben-menu__popup');
  if (!popup) {
    throw new Error('子菜单浮层未渲染');
  }
  return popup;
}

/**
 * 判断当前子菜单是否处于展开态。
 * @param wrapper 宿主包装器。
 * @returns 子菜单根节点带 is-opened 类名时为 true。
 */
function isOpened(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('.vben-sub-menu').classes().includes('is-opened');
}

beforeEach(
  /**
   * 只接管计时器以精确控制悬停延时，保留真实时钟。
   *
   * Vue 用事件对象上的时间戳抑制同一次派发里的重复回调；若连 Date 一起冻结，
   * 捕获阶段的监听与目标监听会拿到同一时间戳，目标处理函数会被静默丢弃。
   */
  () => {
    vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
  },
);

afterEach(
  /** 卸载菜单、清理传送节点并还原计时器，避免残留影响后续用例。 */ () => {
    for (const wrapper of mountedWrappers.splice(0)) {
      wrapper.unmount();
    }
    document.body.innerHTML = '';
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  },
);

describe('子菜单浮层渲染', /** 浮层容器是横向菜单唯一的下级入口，未渲染会让下级菜单彻底点不开。 */ () => {
  it('横向模式下渲染浮层容器并带上模式类名', /** 浮层缺失会让横向菜单丢失整棵下级菜单。 */ async () => {
    const wrapper = mountHorizontalSubMenu();
    await nextTick();

    const popup = readPopup();
    expect(popup.className).toContain('is-horizontal');
    // 下级菜单项真实存在于浮层内，而不是被丢弃。
    expect(popup.textContent).toContain('DUMMY-用户管理');
    expect(isOpened(wrapper)).toBe(false);
  });

  it('未展开时浮层内容带隐藏类名', /** 未展开仍可见会让多个浮层同时挂在页面上。 */ async () => {
    const wrapper = mountHorizontalSubMenu();
    await nextTick();

    const container = document.querySelector('.vben-menu__popup-container');
    expect(container).not.toBeNull();
    expect(container?.classList.contains('hidden')).toBe(true);

    readPopup().dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    vi.advanceTimersByTime(120);
    await nextTick();

    expect(isOpened(wrapper)).toBe(true);
    expect(
      document
        .querySelector('.vben-menu__popup-container')
        ?.classList.contains('hidden'),
    ).toBe(false);
  });
});

describe('子菜单浮层悬停展开', /** 悬停延时决定浮层出现的节奏，写错会让用户以为菜单点不动。 */ () => {
  it('悬停后在延时结束时展开子菜单', /** 延时未生效会让浮层在鼠标掠过时闪出来。 */ async () => {
    const wrapper = mountHorizontalSubMenu();
    await nextTick();
    expect(isOpened(wrapper)).toBe(false);

    readPopup().dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    vi.advanceTimersByTime(120);
    await nextTick();

    expect(isOpened(wrapper)).toBe(true);
  });

  it('聚焦事件不触发延时展开', /** 焦点事件的重复展开会让键盘操作时浮层反复出现。 */ async () => {
    const wrapper = mountHorizontalSubMenu();
    await nextTick();

    readPopup().dispatchEvent(new FocusEvent('focus'));
    vi.advanceTimersByTime(400);
    await nextTick();

    expect(isOpened(wrapper)).toBe(false);
  });

  it('移出浮层后在延时结束时收起子菜单', /** 移出不收会让浮层一直挡住页面内容。 */ async () => {
    const wrapper = mountHorizontalSubMenu();
    await nextTick();
    readPopup().dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    vi.advanceTimersByTime(120);
    await nextTick();
    expect(isOpened(wrapper)).toBe(true);

    readPopup().dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
    vi.advanceTimersByTime(400);
    await nextTick();

    expect(isOpened(wrapper)).toBe(false);
  });
});
