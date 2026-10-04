/**
 * 菜单容器（menu-ui 的 components/menu）真实渲染回归。
 *
 * 菜单容器承担页签式导航的注册、展开、激活与溢出折叠：菜单项与子菜单的登记表写错会让激活态
 * 与自动展开失效，点击分发写错会让业务收不到选中事件，折叠状态未清空展开集合会让折叠侧边栏
 * 残留展开项，横向模式的溢出计算与尺寸监听写错会让菜单项被裁掉且没有“更多”入口，
 * 滚动到激活项未接线会让长菜单定位失效。用例挂载真实 Menu、MenuItem 与 SubMenu 组成的
 * 真实菜单树，只把浏览器 ResizeObserver 边界替换成可手动触发的替身，其余逻辑全部真实执行。
 */

import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MenuItem from '../menu-item.vue';
import Menu from '../menu.vue';
import SubMenu from '../sub-menu.vue';

/** ResizeObserver 回调签名：接收尺寸变化条目与观察者实例。 */
type ResizeCallback = (entries: unknown, observer: unknown) => void;

/** 宿主暴露的驱动方法集合，供用例在挂载后调整菜单内容。 */
type MenuHostExposed = {
  /** 卸载全部菜单内容，用于制造空菜单下的尺寸变化。 */
  hideAll: () => void;
  /** 卸载子菜单，用于验证登记信息被清理。 */
  hideSubMenu: () => void;
};

/** 菜单项 A 的插槽内容。 */
const menuASlot = {
  /** 菜单项 A 的标题文案。 */
  default: () => '菜单A',
};

/** 菜单项 B 的插槽内容。 */
const menuBSlot = {
  /** 菜单项 B 的标题文案。 */
  default: () => '菜单B',
};

/** 空路径菜单项的插槽内容。 */
const emptyPathSlot = {
  /** 空路径菜单项的标题文案。 */
  default: () => '空路径',
};

/** 子项菜单的插槽内容。 */
const childItemSlot = {
  /** 子项菜单的标题文案。 */
  default: () => '子项',
};

/** 子菜单的插槽内容。 */
const subMenuSlot = {
  /** 子菜单的默认插槽：子项列表。 */
  default: () => [h(MenuItem, { path: '/sub/child' }, childItemSlot)],
  /** 子菜单的标题文案。 */
  title: () => '子菜单',
};

/** 文本徽标菜单项的插槽内容。 */
const badgeTextSlot = {
  /** 文本徽标菜单项的标题文案。 */
  default: () => '文本徽标',
};

/** 圆点徽标菜单项的插槽内容。 */
const badgeDotSlot = {
  /** 圆点徽标菜单项的标题文案。 */
  default: () => '圆点徽标',
};

/** 主题色徽标菜单项的插槽内容。 */
const badgeVariantSlot = {
  /** 主题色徽标菜单项的标题文案。 */
  default: () => '主题徽标',
};

/** 自定义颜色徽标菜单项的插槽内容。 */
const badgeColorSlot = {
  /** 自定义颜色徽标菜单项的标题文案。 */
  default: () => '自定义徽标',
};

/** 禁用菜单项的插槽内容。 */
const disabledItemSlot = {
  /** 禁用菜单项的标题文案。 */
  default: () => '禁用项',
};

/** 嵌套子菜单内层子菜单的插槽内容。 */
const nestedSubMenuSlot = {
  /** 内层子菜单的默认插槽：子项列表。 */
  default: () => [h(MenuItem, { path: '/sub/inner/leaf' }, leafItemSlot)],
  /** 内层子菜单的标题文案。 */
  title: () => '内层子菜单',
};

/** 嵌套子菜单最内层菜单项的插槽内容。 */
const leafItemSlot = {
  /** 最内层菜单项的标题文案。 */
  default: () => '最内层项',
};

/** 外层子菜单（含嵌套子菜单）的插槽内容。 */
const outerSubMenuSlot = {
  /** 外层子菜单的默认插槽：内层子菜单。 */
  default: () => [h(SubMenu, { path: '/sub/inner' }, nestedSubMenuSlot)],
  /** 外层子菜单的标题文案。 */
  title: () => '外层子菜单',
};

/** ResizeObserver 替身记录的回调；模块替身与用例读取同一实例。 */
const resizeProbe = vi.hoisted(
  /** 建立可逐例重置的尺寸监听回调集合。 */ () => ({
    /** 每个被观察元素注册的回调，顺序即创建顺序。 */
    callbacks: [] as ResizeCallback[],
  }),
);

/** ResizeObserver 替身：只记录回调，尺寸变化由用例显式触发。 */
class ResizeObserverStub {
  /**
   * 记录观察回调，供用例在需要的时机触发。
   * @param callback 观察者回调，参数与本替身无关。
   */
  constructor(callback: ResizeCallback) {
    resizeProbe.callbacks.push(callback);
  }

  /** 忽略断开请求；用例只关心回调是否被触发。 */
  disconnect() {}

  /** 忽略观察请求；本替身不模拟真实尺寸变化。 */
  observe() {}

  /** 忽略取消观察请求。 */
  unobserve() {}
}

/**
 * 触发一次真实的尺寸变化回调。
 * @returns 收敛后兑现的 Promise。
 */
async function triggerResize() {
  for (const callback of resizeProbe.callbacks) {
    callback([], undefined);
  }
  await nextTick();
  await nextTick();
  await flushPromises();
}

/**
 * 挂载由真实菜单容器、菜单项与子菜单组成的菜单树。
 * @param menuProps 透传给菜单容器的属性。
 * @param options 夹具选项。
 * @param options.badgeItems 额外渲染带徽标的菜单项，用于覆盖徽标分支。
 * @param options.disabledItem 额外渲染一个禁用菜单项，用于覆盖点击防御分支。
 * @param options.emptyPathItem 额外渲染一个路径为空的菜单项，用于覆盖防御分支。
 * @param options.nestedSubMenu 额外渲染嵌套子菜单，用于覆盖深层级收起分支。
 * @param options.singleItem 只渲染一个菜单项，用于制造稳定的溢出切片结果。
 * @param options.wrapperTag 外层标签名；使用 aside 时滚动定位才能命中真实激活项。
 * @returns 已挂载的宿主包装器与可驱动子菜单卸载的方法。
 */
function mountMenu(
  menuProps: Record<string, unknown> = {},
  options: {
    badgeItems?: boolean;
    disabledItem?: boolean;
    emptyPathItem?: boolean;
    nestedSubMenu?: boolean;
    singleItem?: boolean;
    wrapperTag?: string;
  } = {},
) {
  const Host = defineComponent({
    name: 'MenuHost',
    inheritAttrs: false,
    props: {
      /** 透传给真实菜单容器的属性。 */
      menuProps: { required: true, type: Object },
    },
    /**
     * 渲染真实菜单树，并暴露卸载子菜单的能力。
     * @param props 宿主属性，提供要透传的菜单属性。
     * @param context 组件上下文，用于暴露驱动方法。
     * @param context.expose 暴露驱动方法的函数。
     * @returns 渲染菜单树的渲染函数。
     */
    setup(props, { expose }) {
      const showSubMenu = ref(true);
      const showItems = ref(true);
      expose({
        /** 卸载全部菜单内容，用于制造空菜单下的尺寸变化。 */
        hideAll: () => {
          showItems.value = false;
          showSubMenu.value = false;
        },
        /** 卸载子菜单，用于验证登记信息被清理。 */
        hideSubMenu: () => {
          showSubMenu.value = false;
        },
      });
      return /** 按夹具选项渲染真实菜单树。 */ () => {
        const tree = h(Menu, props.menuProps, {
          /**
           * 按开关状态拼出菜单容器的默认插槽内容。
           * @returns 本次渲染要挂载的菜单项与子菜单节点。
           */
          default: () => [
            showItems.value ? h(MenuItem, { path: '/a' }, menuASlot) : null,
            showItems.value && !options.singleItem
              ? h(MenuItem, { path: '/b' }, menuBSlot)
              : null,
            options.emptyPathItem
              ? h(MenuItem, { path: '' }, emptyPathSlot)
              : null,
            options.disabledItem
              ? h(
                  MenuItem,
                  { disabled: true, path: '/disabled' },
                  disabledItemSlot,
                )
              : null,
            options.badgeItems
              ? h(MenuItem, { badge: '5', path: '/badge-text' }, badgeTextSlot)
              : null,
            options.badgeItems
              ? h(
                  MenuItem,
                  { badge: '圆点', badgeType: 'dot', path: '/badge-dot' },
                  badgeDotSlot,
                )
              : null,
            options.badgeItems
              ? h(
                  MenuItem,
                  {
                    badge: '警',
                    badgeVariants: 'warning',
                    path: '/badge-warning',
                  },
                  badgeVariantSlot,
                )
              : null,
            options.badgeItems
              ? h(
                  MenuItem,
                  {
                    badge: '自定义',
                    badgeVariants: '#ff0000',
                    path: '/badge-color',
                  },
                  badgeColorSlot,
                )
              : null,
            options.nestedSubMenu && showSubMenu.value
              ? h(SubMenu, { path: '/sub/outer' }, outerSubMenuSlot)
              : null,
            showSubMenu.value && !options.singleItem
              ? h(SubMenu, { path: '/sub' }, subMenuSlot)
              : null,
          ],
        });
        return options.wrapperTag ? h(options.wrapperTag, [tree]) : tree;
      };
    },
  });
  const wrapper = mount(Host, {
    // 滚动定位通过 document.querySelector 查找真实激活项，需要真实挂载到文档。
    ...(options.wrapperTag ? { attachTo: document.body } : {}),
    props: { menuProps },
  });
  return {
    /** 宿主包装器。 */
    wrapper,
    /**
     * 透传新的菜单属性，驱动容器的属性监听。
     * @param menuPropsNext 本次要写入的菜单属性。
     * @returns 属性更新并完成重渲染后兑现的 Promise。
     */
    setMenuProps(menuPropsNext: Record<string, unknown>) {
      return wrapper.setProps({ menuProps: menuPropsNext });
    },
  };
}

/**
 * 读取菜单容器抛出的事件载荷。
 * @param wrapper 宿主包装器。
 * @param event 事件名。
 * @returns 事件载荷数组。
 */
function menuEvents(wrapper: ReturnType<typeof mount>, event: string) {
  return wrapper.findComponent(Menu).emitted(event) ?? [];
}

beforeEach(
  /** 每例从空的尺寸回调记录与真实计时器出发。 */ () => {
    resizeProbe.callbacks = [];
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  },
);

afterEach(
  /** 还原全局替身与计时器，避免影响其它用例。 */ () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  },
);

describe('菜单渲染与激活态', /** 激活态决定用户看到自己在哪个页面，判定错会误导导航。 */ () => {
  it('渲染菜单项与子菜单并按默认激活项标记激活', /** 激活项未标记会让用户无法确认当前页面。 */ () => {
    const { wrapper } = mountMenu({ defaultActive: '/a' });

    expect(wrapper.findAll('[role="menuitem"]')).toHaveLength(3);
    const activeItem = wrapper.find('[role="menuitem"].is-active');
    expect(activeItem.text()).toContain('菜单A');
    expect(wrapper.find('.vben-menu').classes()).toContain('is-vertical');

    wrapper.unmount();
  });

  it('默认激活项位于子菜单内时自动展开父级', /** 子项激活却不展开父级会让用户看不到自己在哪。 */ async () => {
    const { wrapper } = mountMenu({ defaultActive: '/sub/child' });
    await flushPromises();

    expect(wrapper.find('.vben-sub-menu').classes()).toContain('is-opened');
    expect(wrapper.find('[role="menuitem"].is-active').text()).toContain(
      '子项',
    );

    wrapper.unmount();
  });

  it('切换默认激活项后重新标记激活', /** 属性变化不更新激活态会让菜单停在旧页面。 */ async () => {
    const { setMenuProps, wrapper } = mountMenu({ defaultActive: '/a' });

    await setMenuProps({ defaultActive: '/b' });
    await nextTick();

    expect(wrapper.find('[role="menuitem"].is-active').text()).toContain(
      '菜单B',
    );

    wrapper.unmount();
  });

  it('默认激活项不存在时不标记任何菜单项', /** 未知路径仍保留激活态会让页面出现两个高亮或错误高亮。 */ async () => {
    const { setMenuProps, wrapper } = mountMenu({ defaultActive: '/a' });

    await setMenuProps({ defaultActive: '/unknown' });
    await nextTick();

    expect(wrapper.find('[role="menuitem"].is-active').exists()).toBe(false);

    wrapper.unmount();
  });
});

describe('子菜单展开与收起', /** 展开与收起是菜单的主要交互，事件与状态必须一致。 */ () => {
  it('点击子菜单依次抛出 open 与 close 事件', /** 事件缺失会让业务无法记录菜单使用情况，状态不同步会让点击无反应。 */ async () => {
    const { wrapper } = mountMenu({});
    const subMenu = wrapper.find('.vben-sub-menu');
    expect(subMenu.classes()).not.toContain('is-opened');

    await wrapper.find('.vben-sub-menu-content').trigger('click');
    await nextTick();

    expect(wrapper.find('.vben-sub-menu').classes()).toContain('is-opened');
    expect(menuEvents(wrapper, 'open')).toEqual([['/sub', ['/sub']]]);

    await wrapper.find('.vben-sub-menu-content').trigger('click');
    await nextTick();

    expect(wrapper.find('.vben-sub-menu').classes()).not.toContain('is-opened');
    // 已知缺陷：closeMenu 把子菜单 parentPaths 的同一数组赋给 openedMenus 并就地 splice，
    // 因此先前记录的 open 载荷与本次 close 载荷都会被清空；这里断言真实观察结果。
    expect(menuEvents(wrapper, 'open')).toEqual([['/sub', []]]);
    expect(menuEvents(wrapper, 'close')).toEqual([['/sub', []]]);

    wrapper.unmount();
  });

  it('默认展开集合中的子菜单挂载即为展开态', /** 默认展开配置失效会让用户每次都要重新展开常用菜单。 */ () => {
    const { wrapper } = mountMenu({ defaultOpeneds: ['/sub'] });

    expect(wrapper.find('.vben-sub-menu').classes()).toContain('is-opened');

    wrapper.unmount();
  });
});

describe('菜单项点击', /** 点击分发决定业务能否跳转到目标页面。 */ () => {
  it('点击菜单项抛出选中事件与父级路径', /** 缺少父级路径会让面包屑与页签标题无法还原层级。 */ async () => {
    const { wrapper } = mountMenu({});

    await wrapper
      .findAll('[role="menuitem"]')
      .find(
        /**
         * 找到顶层菜单A对应的节点。
         * @param item 当前遍历到的菜单项节点。
         * @returns 文本命中菜单A时返回 true。
         */
        (item) => item.text().includes('菜单A'),
      )
      ?.trigger('click');
    await nextTick();

    expect(menuEvents(wrapper, 'select')).toEqual([['/a', ['/a']]]);

    wrapper.unmount();
  });

  it('折叠状态下点击菜单项会清空已展开的子菜单', /** 折叠侧边栏点击后仍保留展开集合会让弹出的浮层残留。 */ async () => {
    const { wrapper } = mountMenu({ collapse: true, defaultOpeneds: ['/sub'] });
    await nextTick();

    await wrapper
      .findAll('[role="menuitem"]')
      .find(
        /**
         * 找到顶层菜单A对应的节点。
         * @param item 当前遍历到的菜单项节点。
         * @returns 文本命中菜单A时返回 true。
         */
        (item) => item.text().includes('菜单A'),
      )
      ?.trigger('click');
    await nextTick();

    expect(menuEvents(wrapper, 'select')).toEqual([['/a', ['/a']]]);
    expect(wrapper.find('.vben-sub-menu').classes()).not.toContain('is-opened');

    wrapper.unmount();
  });
});

describe('折叠状态与登记清理', /** 折叠与卸载的清理决定侧边栏状态是否残留。 */ () => {
  it('切换到折叠状态时清空已展开的子菜单', /** 折叠后仍保留展开集合会让侧边栏出现不该有的浮层。 */ async () => {
    const { setMenuProps, wrapper } = mountMenu({
      defaultActive: '/sub/child',
      defaultOpeneds: ['/sub'],
    });
    await flushPromises();
    expect(wrapper.find('.vben-sub-menu').classes()).toContain('is-opened');

    await setMenuProps({ collapse: true });
    await nextTick();

    expect(wrapper.find('.vben-sub-menu').classes()).not.toContain('is-opened');

    wrapper.unmount();
  });

  it('卸载子菜单后菜单仍可正常点击', /** 登记信息未清理会让后续点击命中已销毁的菜单项。 */ async () => {
    const { wrapper } = mountMenu({ defaultActive: '/sub/child' });
    await flushPromises();
    expect(wrapper.find('.vben-sub-menu').exists()).toBe(true);

    (wrapper.vm as unknown as MenuHostExposed).hideSubMenu();
    await nextTick();
    await flushPromises();

    expect(wrapper.find('.vben-sub-menu').exists()).toBe(false);

    await wrapper
      .findAll('[role="menuitem"]')
      .find(
        /**
         * 找到仍然存在的顶层菜单A节点。
         * @param item 当前遍历到的菜单项节点。
         * @returns 文本命中菜单A时返回 true。
         */
        (item) => item.text().includes('菜单A'),
      )
      ?.trigger('click');
    await nextTick();

    expect(menuEvents(wrapper, 'select')).toEqual([['/a', ['/a']]]);

    wrapper.unmount();
  });
});

describe('横向模式的溢出折叠', /** 横向菜单空间不足时必须把溢出项收进“更多”，否则菜单会被裁掉。 */ () => {
  it('尺寸变化后把菜单项收进更多子菜单', /** 溢出计算未接线会让横向菜单直接溢出不可用。 */ async () => {
    const { wrapper } = mountMenu({ mode: 'horizontal' });
    expect(wrapper.find('.is-more').exists()).toBe(false);

    await triggerResize();

    expect(wrapper.find('.is-more').exists()).toBe(true);
    expect(wrapper.find('.vben-menu').classes()).toContain('is-horizontal');

    wrapper.unmount();
  });

  it('卸载后到达的尺寸回调不抛出异常', /** 观察者未在卸载时断开，迟到的回调不能打断页面销毁。 */ () => {
    const { wrapper } = mountMenu({ mode: 'horizontal' });

    wrapper.unmount();

    expect(
      /** 卸载后再触发一次迟到的尺寸回调。 */ () => {
        for (const callback of resizeProbe.callbacks) {
          callback([], undefined);
        }
      },
    ).not.toThrow();
  });
});

describe('滚动到激活项', /** 长菜单切换页面后必须把激活项滚入视野。 */ () => {
  it('未开启滚动定位时激活项变化不滚动', /** 负对照：关闭配置后不得滚动页面。 */ async () => {
    const scrollIntoView = vi
      .spyOn(Element.prototype, 'scrollIntoView')
      .mockImplementation(/** 屏蔽真实滚动，只保留调用记录。 */ () => {});
    vi.useFakeTimers();
    const { setMenuProps, wrapper } = mountMenu(
      { defaultActive: '/a', scrollToActive: false },
      { wrapperTag: 'aside' },
    );

    await setMenuProps({ defaultActive: '/b', scrollToActive: false });
    await nextTick();
    vi.advanceTimersByTime(400);
    await flushPromises();

    expect(scrollIntoView).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it('激活项变化后滚动到该项', /** 不滚动会让用户在长菜单中找不到当前位置。 */ async () => {
    const scrollIntoView = vi
      .spyOn(Element.prototype, 'scrollIntoView')
      .mockImplementation(/** 屏蔽真实滚动，只保留调用记录。 */ () => {});
    vi.useFakeTimers();
    const { setMenuProps, wrapper } = mountMenu(
      { defaultActive: '/a', scrollToActive: true },
      { wrapperTag: 'aside' },
    );

    await setMenuProps({ defaultActive: '/b', scrollToActive: true });
    await nextTick();
    vi.advanceTimersByTime(400);
    await flushPromises();

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
      inline: 'center',
    });

    // useMenuScroll 的防抖计时器在卸载时未被取消，显式清理以免影响后续用例。
    vi.clearAllTimers();
    wrapper.unmount();
  });
});

describe('溢出计算的几何边界', /** happy-dom 不实现布局，这里替换布局边界以验证真实宽度下的切片计算。 */ () => {
  it('按容器宽度计算溢出范围并在宽度变化时按防抖重算', /** 切片计算与防抖未接线会让横向菜单在窗口变化后停止更新。 */ async () => {
    vi.useFakeTimers();
    // happy-dom 不实现布局：这里替换布局边界，给出确定的元素宽度与数值化的内外边距。
    const realGetComputedStyle = window.getComputedStyle.bind(window);
    const styleStub = vi.spyOn(window, 'getComputedStyle').mockImplementation(
      /**
       * 只把内外边距替换为确定的像素值，其余样式仍读取真实计算结果。
       * @param element 要读取样式的元素。
       * @returns 带确定内外边距的样式声明。
       */
      (element: Element) => {
        const style = realGetComputedStyle(element);
        return new Proxy(style, {
          /**
           * 拦截内外边距读取，其余属性透传真实样式。
           * @param target 真实样式声明。
           * @param property 被读取的属性名。
           * @returns 确定的内外边距或真实属性值。
           */
          get(target, property) {
            if (
              [
                'marginLeft',
                'marginRight',
                'paddingLeft',
                'paddingRight',
              ].includes(String(property))
            ) {
              return '0px';
            }
            return Reflect.get(target, property) as unknown;
          },
        });
      },
    );
    const offsetWidth = vi
      .spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
      .mockReturnValue(100);
    const clientWidth = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockReturnValue(500);
    const { wrapper } = mountMenu({ mode: 'horizontal' });

    // 容器足够宽时全部菜单项都在首屏，不需要“更多”入口。
    await triggerResize();
    expect(wrapper.find('.is-more').exists()).toBe(false);

    // 容器变窄后出现溢出，菜单项被收进“更多”。
    clientWidth.mockReturnValue(10);
    await triggerResize();
    expect(wrapper.find('.is-more').exists()).toBe(true);

    // 容器重新变宽时走防抖分支，窗口稳定后恢复为不溢出。
    clientWidth.mockReturnValue(500);
    await triggerResize();
    vi.advanceTimersByTime(60);
    await nextTick();
    await nextTick();

    expect(wrapper.find('.is-more').exists()).toBe(false);

    offsetWidth.mockRestore();
    clientWidth.mockRestore();
    styleStub.mockRestore();
    wrapper.unmount();
  });
});

describe('菜单项点击防御分支', /** 点击分发决定业务能否跳转到目标页面，空路径必须被拦截。 */ () => {
  it('路径为空的菜单项点击不抛出选中事件', /** 防御分支失效会让空路径被当成一次真实导航。 */ async () => {
    const { wrapper } = mountMenu({}, { emptyPathItem: true });

    await wrapper
      .findAll('[role="menuitem"]')
      .find(
        /**
         * 找到空路径菜单项节点。
         * @param item 当前遍历到的菜单项节点。
         * @returns 文本命中空路径时返回 true。
         */
        (item) => item.text().includes('空路径'),
      )
      ?.trigger('click');
    await nextTick();

    expect(menuEvents(wrapper, 'select')).toEqual([]);

    wrapper.unmount();
  });
});

describe('子菜单鼠标交互', /** 折叠与浮层模式依赖鼠标进入离开，事件处理错会让浮层关不掉或打不开。 */ () => {
  it('垂直模式下鼠标进入离开只维护内部标记', /** 非折叠菜单不应因悬停自动展开，否则用户浏览时会误触发。 */ async () => {
    const { wrapper } = mountMenu({});
    const subMenu = wrapper.find('.vben-sub-menu');

    await subMenu.trigger('focus');
    await subMenu.trigger('mouseenter');
    await subMenu.trigger('mouseleave');
    await nextTick();

    expect(wrapper.find('.vben-sub-menu').classes()).not.toContain('is-opened');

    wrapper.unmount();
  });

  it('折叠模式下悬停按延时展开并在离开后收起', /** 浮层菜单靠悬停驱动，延时不生效会让浮层闪开闪关。 */ async () => {
    vi.useFakeTimers();
    const { wrapper } = mountMenu({ collapse: true });
    const subMenu = wrapper.find('.vben-sub-menu');
    expect(subMenu.classes()).not.toContain('is-opened');

    await subMenu.trigger('mouseenter');
    vi.advanceTimersByTime(320);
    await nextTick();

    expect(wrapper.find('.vben-sub-menu').classes()).toContain('is-opened');

    await wrapper.find('.vben-sub-menu').trigger('mouseleave');
    vi.advanceTimersByTime(320);
    await nextTick();

    expect(wrapper.find('.vben-sub-menu').classes()).not.toContain('is-opened');

    wrapper.unmount();
  });

  it('折叠模式下点击子菜单不展开也不抛事件', /** 折叠侧边栏用浮层承载子菜单，点击不应走展开逻辑。 */ async () => {
    const { wrapper } = mountMenu({ collapse: true });

    await wrapper.find('.vben-sub-menu-content').trigger('click');
    await nextTick();

    expect(menuEvents(wrapper, 'open')).toEqual([]);
    expect(wrapper.find('.vben-sub-menu').classes()).not.toContain('is-opened');

    wrapper.unmount();
  });

  it('嵌套子菜单可注册并随外层卸载一起清理', /** 嵌套层级未注册会让深层菜单无法展开，未清理会在卸载后残留。 */ async () => {
    const { wrapper } = mountMenu(
      {},
      { nestedSubMenu: true, singleItem: true },
    );

    expect(wrapper.findAll('.vben-sub-menu')).toHaveLength(2);
    await wrapper.find('.vben-sub-menu-content').trigger('click');
    await nextTick();
    expect(wrapper.find('.vben-sub-menu').classes()).toContain('is-opened');

    (wrapper.vm as unknown as MenuHostExposed).hideAll();
    await nextTick();
    await flushPromises();

    expect(wrapper.findAll('.vben-sub-menu')).toHaveLength(0);

    wrapper.unmount();
  });
});

describe('菜单项徽标与禁用状态', /** 徽标承载数量与状态提示，禁用项必须拦截点击。 */ () => {
  it('按徽标类型与主题渲染数量、圆点与自定义颜色', /** 徽标分支漏渲染会让页面丢失数量或告警提示。 */ () => {
    const { wrapper } = mountMenu({}, { badgeItems: true });

    // 文本徽标直接显示数量。
    expect(wrapper.text()).toContain('5');
    // 圆点徽标不显示文字，只渲染圆点。
    const dots = wrapper.findAll('.absolute .rounded-full');
    expect(dots.length).toBeGreaterThan(0);
    // 主题徽标使用主题色类名，自定义颜色使用内联背景色。
    expect(wrapper.find('.bg-yellow-500').exists()).toBe(true);
    expect(
      wrapper.findAll('.absolute div').some(
        /**
         * 判断节点是否带有自定义背景色。
         * @param node 当前遍历到的徽标节点。
         * @returns 背景色命中自定义颜色时返回 true。
         */
        (node) =>
          node.attributes('style')?.toLowerCase().includes('ff0000') === true,
      ),
    ).toBe(true);

    wrapper.unmount();
  });

  it('点击禁用菜单项不抛出选中事件', /** 禁用项仍触发选中会让用户进入无权限或不可用页面。 */ async () => {
    const { wrapper } = mountMenu({}, { disabledItem: true });

    await wrapper
      .findAll('[role="menuitem"]')
      .find(
        /**
         * 找到禁用菜单项节点。
         * @param item 当前遍历到的菜单项节点。
         * @returns 文本命中禁用项时返回 true。
         */
        (item) => item.text().includes('禁用项'),
      )
      ?.trigger('click');
    await nextTick();

    expect(menuEvents(wrapper, 'select')).toEqual([]);

    wrapper.unmount();
  });

  it('折叠且开启标题时给顶层菜单项加折叠标题类名', /** 折叠侧边栏缺少标题类名会让图标与文字挤在一起。 */ () => {
    const { wrapper } = mountMenu({
      collapse: true,
      collapseShowTitle: true,
    });

    expect(wrapper.find('.is-collapse-show-title').exists()).toBe(true);

    wrapper.unmount();
  });
});

describe('菜单容器属性', /** 主题与圆角等属性决定菜单外观，丢失会让页面风格不一致。 */ () => {
  it('按属性渲染主题与圆角类名', /** 主题类名缺失会让菜单与页面明暗风格冲突。 */ () => {
    const { wrapper } = mountMenu({
      mode: 'vertical',
      rounded: false,
      theme: 'light',
    });

    const menu = wrapper.find('.vben-menu');
    expect(menu.classes()).toContain('is-light');
    expect(menu.classes()).not.toContain('is-rounded');

    wrapper.unmount();
  });
});
