/**
 * 基础标签页（tabs-ui 的 components/tabs）切换、关闭、固定与右键菜单真实回归。
 *
 * 该组件是标签栏的普通风格实现：点击标签决定当前激活项，中键与关闭图标决定标签能否被关掉，
 * 固定标签的解除入口与右键菜单决定用户能否把固定标签恢复成普通标签或对标签执行菜单操作。
 * 切换事件载荷写错会让路由停在旧页面；中键守卫（固定标签、不可关闭标签、仅剩一个标签、
 * 未开启中键关闭）失效会让固定标签被误关或标签无法关闭；标题优先级写错会让标签显示成路由名。
 * 用例用真实标签数据挂载组件，用真实鼠标事件驱动交互，断言真实 v-model 载荷、真实 DOM
 * 状态与真实右键菜单回调。
 */
import type { VueWrapper } from '@vue/test-utils';

import type { TabDefinition } from '@vben-core/typings';

import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import Tabs from './tabs.vue';

/** 本文件已挂载的宿主包装器，用例结束后统一卸载以清理传送节点。 */
const mountedWrappers: VueWrapper[] = [];

/**
 * 构造用例用的真实标签数据：固定标签、普通标签、不可关闭且带新标题的标签、只声明路由名的标签。
 * @returns 标签页数据数组，顺序即渲染顺序。
 */
function createTabs() {
  return [
    {
      fullPath: '/home',
      key: 'home',
      meta: { affixTab: true, title: 'DUMMY-首页' },
      name: 'home',
      path: '/home',
    },
    {
      fullPath: '/user',
      key: 'user',
      meta: { title: 'DUMMY-用户管理' },
      name: 'user',
      path: '/user',
    },
    {
      fullPath: '/order',
      key: 'order',
      meta: {
        newTabTitle: 'DUMMY-订单(新标题)',
        tabClosable: false,
        title: 'DUMMY-订单',
      },
      name: 'order',
      path: '/order',
    },
    {
      fullPath: '/report',
      key: 'report',
      meta: {},
      name: 'DUMMY-报表',
      path: '/report',
    },
  ] as unknown as TabDefinition[];
}

/**
 * 挂载真实标签组件并记录宿主。
 * @param props 透传给组件的属性；缺省激活首页并开启中键关闭。
 * @returns 已挂载的组件包装器。
 */
function mountTabs(props: Record<string, unknown> = {}) {
  const wrapper = mount(Tabs, {
    props: {
      active: 'home',
      middleClickToClose: true,
      tabs: createTabs(),
      ...props,
    },
  });
  mountedWrappers.push(wrapper);
  return wrapper;
}

/**
 * 读取当前渲染的全部标签项节点。
 * @param wrapper 已挂载的标签组件包装器。
 * @returns 按渲染顺序排列的标签项元素数组。
 * @throws Error 一个标签项都没渲染时抛出，避免后续断言落到空集合上静默通过。
 */
function tabItems(wrapper: VueWrapper) {
  // 包装器的 element 在通用类型下是 any，先收窄成真实根节点再带类型查询。
  const root = wrapper.element as HTMLElement;
  const items = [
    ...root.querySelectorAll<HTMLElement>('[data-tab-item="true"]'),
  ];
  if (items.length === 0) {
    throw new Error('标签项未渲染');
  }
  return items;
}

/**
 * 取出指定渲染下标的标签项节点。
 * @param wrapper 已挂载的标签组件包装器。
 * @param index 标签项的渲染下标。
 * @returns 命中下标的标签项元素。
 * @throws Error 该下标没有渲染出标签项时抛出，避免断言落到 undefined 上静默通过。
 */
function tabItem(wrapper: VueWrapper, index: number) {
  const item = tabItems(wrapper)[index];
  if (!item) {
    throw new Error(`标签项未渲染：${index}`);
  }
  return item;
}

/**
 * 读取标签项内指定图标节点。
 * @param item 标签项元素。
 * @param selector 图标节点的 CSS 选择器。
 * @returns 命中的图标元素。
 * @throws Error 图标节点未渲染时抛出，避免把缺失误判成隐藏。
 */
function readIcon(item: HTMLElement, selector: string) {
  const icon = item.querySelector<HTMLElement>(selector);
  if (!icon) {
    throw new Error(`图标未渲染：${selector}`);
  }
  return icon;
}

/**
 * 在标签项内的图标入口上派发真实点击事件。
 * @param item 标签项元素。
 * @param selector 图标节点的 CSS 选择器。
 * @returns 派发后的点击事件对象，用于核对冒泡是否被阻断。
 */
function clickIcon(item: HTMLElement, selector: string) {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  readIcon(item, selector).dispatchEvent(event);
  return event;
}

/**
 * 在目标标签项上派发真实鼠标按下事件。
 * @param item 目标标签项元素。
 * @param button 鼠标键位：0 为左键，1 为中键。
 * @returns 派发后的事件对象，用于核对默认行为是否被阻止。
 */
function mouseDown(item: HTMLElement, button: number) {
  const event = new MouseEvent('mousedown', {
    bubbles: true,
    button,
    cancelable: true,
  });
  item.dispatchEvent(event);
  return event;
}

/**
 * 宿主组件：用真实 v-model 把标签切换事件写回自身状态，并渲染激活值探针。
 */
const TabsHost = defineComponent({
  name: 'TabsHost',
  /**
   * 建立激活状态并把真实标签数据交给被测组件。
   * @returns 渲染标签组件与激活值探针的渲染函数。
   */
  setup() {
    const active = ref('home');
    return /** 渲染标签组件与当前激活值。 */ () =>
      h('div', [
        h(Tabs, {
          active: active.value,
          middleClickToClose: true,
          tabs: createTabs(),
          /** 接收真实切换载荷并写回状态。 */
          'onUpdate:active': (value: string | undefined) => {
            active.value = value ?? '';
          },
        }),
        h('span', { 'data-test': 'active-probe' }, active.value),
      ]);
  },
});

afterEach(
  /** 卸载全部宿主并移除传送节点，避免残留菜单影响后续用例。 */ () => {
    for (const wrapper of mountedWrappers.splice(0)) {
      wrapper.unmount();
    }
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

describe('标签渲染与激活态', /** 渲染分支决定标题、激活高亮与固定标记是否正确。 */ () => {
  it('按标题优先级渲染标签并标记激活与固定状态', /** 标题回退或类名判错会让用户看到错误标题或认不出当前页。 */ () => {
    const wrapper = mountTabs({ active: 'order', contentClass: 'custom-tabs' });

    const items = tabItems(wrapper);
    expect(items).toHaveLength(4);
    const text = wrapper.text();
    expect(text).toContain('DUMMY-首页');
    expect(text).toContain('DUMMY-用户管理');
    // newTabTitle 优先于 title，订单标签展示的是新标题。
    expect(text).toContain('DUMMY-订单(新标题)');
    // 未声明任何标题时回退到路由名。
    expect(text).toContain('DUMMY-报表');

    expect(wrapper.find('.custom-tabs').exists()).toBe(true);
    expect(
      items.map(/** 读取每个标签的渲染下标。 */ (item) => item.dataset.index),
    ).toEqual(['0', '1', '2', '3']);
    expect(items[2]?.classList.contains('is-active')).toBe(true);
    expect(items[0]?.classList.contains('is-active')).toBe(false);
    // 固定标签不可拖拽并带固定标记，普通标签相反。
    expect(items[0]?.classList.contains('affix-tab')).toBe(true);
    expect(items[0]?.classList.contains('draggable')).toBe(false);
    expect(items[1]?.classList.contains('draggable')).toBe(true);
    expect(items[1]?.classList.contains('affix-tab')).toBe(false);
  });

  it('按风格类型应用内容类名并对未知风格回退', /** 风格类名走错分支会让标签栏外观与配置不一致。 */ () => {
    const brisk = mountTabs({ styleType: 'brisk' });
    expect(tabItem(brisk, 0).classList.contains('after:scale-x-0')).toBe(true);

    const card = mountTabs({ styleType: 'card' });
    expect(tabItem(card, 0).classList.contains('rounded-md')).toBe(true);

    // 未声明的风格不走任何一套外观类，只保留标签项的基础布局类，避免套用错误外观。
    const unknown = mountTabs({ styleType: 'unknown-style' });
    const fallback = tabItem(unknown, 0);
    expect(fallback.classList.contains('rounded-md')).toBe(false);
    expect(fallback.classList.contains('after:scale-x-0')).toBe(false);
    expect(fallback.className).toContain('tab-item');
  });

  it('开启图标开关时渲染标签图标', /** 图标开关失效会让标签栏缺少站点图标或渲染多余节点。 */ () => {
    const iconTabs = [
      {
        fullPath: '/home',
        key: 'home',
        meta: {
          // 本地图标组件：不触发远程 Iconify 图标请求（外部边界）。
          icon: /** 标签图标组件。 */ () => h('i', { class: 'dummy-tab-icon' }),
          title: 'DUMMY-首页',
        },
        name: 'home',
        path: '/home',
      },
      {
        fullPath: '/user',
        key: 'user',
        meta: { title: 'DUMMY-用户管理' },
        name: 'user',
        path: '/user',
      },
    ] as unknown as TabDefinition[];

    const shown = mountTabs({ showIcon: true, tabs: iconTabs });
    expect(tabItem(shown, 0).querySelector('.dummy-tab-icon')).not.toBeNull();
    // 未声明图标的标签即使开关打开也不渲染图标节点。
    expect(tabItem(shown, 1).querySelector('.dummy-tab-icon')).toBeNull();

    const hidden = mountTabs({ tabs: iconTabs });
    expect(tabItem(hidden, 0).querySelector('.dummy-tab-icon')).toBeNull();
  });
});

describe('点击切换激活标签', /** 切换载荷决定路由与高亮是否跟着用户点击走。 */ () => {
  it('点击标签发出真实 v-model 载荷', /** 载荷写错会让父级把激活项写到别的标签上。 */ async () => {
    const wrapper = mountTabs({ active: 'home' });

    tabItem(wrapper, 2).click();
    await nextTick();

    expect(wrapper.emitted('update:active')).toEqual([['order']]);
  });

  it('真实 v-model 回写后激活高亮移动并与探针一致', /** 事件发出但状态不回写会让高亮与业务状态脱节。 */ async () => {
    const wrapper = mount(TabsHost);
    mountedWrappers.push(wrapper);

    expect(wrapper.get('[data-test="active-probe"]').text()).toBe('home');
    expect(tabItem(wrapper, 0).classList.contains('is-active')).toBe(true);

    tabItem(wrapper, 1).click();
    await nextTick();

    expect(wrapper.get('[data-test="active-probe"]').text()).toBe('user');
    expect(tabItem(wrapper, 1).classList.contains('is-active')).toBe(true);
    expect(tabItem(wrapper, 0).classList.contains('is-active')).toBe(false);
  });
});

describe('中键关闭', /** 中键守卫决定固定标签与不可关闭标签会不会被误关。 */ () => {
  it('在可关闭标签上阻止默认行为、阻断冒泡并发出关闭载荷', /** 未阻止默认行为会触发页面滚动，载荷写错会关掉别的标签。 */ () => {
    const wrapper = mountTabs({ middleClickToClose: true });
    const parentListener = vi.fn();
    wrapper.element.addEventListener('mousedown', parentListener);

    const event = mouseDown(tabItem(wrapper, 1), 1);

    expect(wrapper.emitted('close')).toEqual([['user']]);
    expect(event.defaultPrevented).toBe(true);
    expect(parentListener).not.toHaveBeenCalled();
  });

  it('左键、固定标签与不可关闭标签都不触发关闭', /** 守卫失效会让固定标签被误关，或普通点击意外关掉标签。 */ () => {
    const wrapper = mountTabs({ middleClickToClose: true });

    const left = mouseDown(tabItem(wrapper, 1), 0);
    const affix = mouseDown(tabItem(wrapper, 0), 1);
    const notClosable = mouseDown(tabItem(wrapper, 2), 1);

    expect(wrapper.emitted('close')).toBeUndefined();
    expect(left.defaultPrevented).toBe(false);
    expect(affix.defaultPrevented).toBe(false);
    expect(notClosable.defaultPrevented).toBe(false);
  });

  it('未开启中键关闭或仅剩一个标签时中键不关闭', /** 负向守卫失效会无视用户配置，或把单标签页面关成空白。 */ () => {
    const disabled = mountTabs({
      middleClickToClose: false,
      tabs: createTabs().slice(1, 2),
    });
    mouseDown(tabItem(disabled, 0), 1);
    expect(disabled.emitted('close')).toBeUndefined();

    const onlyOne = mountTabs({ tabs: createTabs().slice(1, 2) });
    mouseDown(tabItem(onlyOne, 0), 1);
    expect(onlyOne.emitted('close')).toBeUndefined();
  });
});

describe('关闭图标与解除固定入口', /** 图标显隐与载荷决定用户能否关掉标签或恢复固定标签。 */ () => {
  it('可关闭标签显示关闭图标并发出关闭载荷', /** 关闭图标缺失会让标签无法关闭，载荷写错会关掉别的标签。 */ async () => {
    const wrapper = mountTabs();

    expect(readIcon(tabItem(wrapper, 1), '.lucide-x').style.display).not.toBe(
      'none',
    );
    // 固定标签与显式声明不可关闭的标签不显示关闭图标。
    expect(readIcon(tabItem(wrapper, 0), '.lucide-x').style.display).toBe(
      'none',
    );
    expect(readIcon(tabItem(wrapper, 2), '.lucide-x').style.display).toBe(
      'none',
    );

    clickIcon(tabItem(wrapper, 3), '.lucide-x');
    await nextTick();

    expect(wrapper.emitted('close')).toEqual([['report']]);
    // 关闭图标的点击必须被阻断，不能顺带把该标签切换成激活项。
    expect(wrapper.emitted('update:active')).toBeUndefined();
  });

  it('固定标签显示固定图标并发出解除固定载荷', /** 固定标签缺少解除入口会让用户无法恢复成普通标签。 */ async () => {
    const wrapper = mountTabs();

    expect(readIcon(tabItem(wrapper, 0), '.lucide-pin').style.display).not.toBe(
      'none',
    );
    expect(readIcon(tabItem(wrapper, 1), '.lucide-pin').style.display).toBe(
      'none',
    );

    clickIcon(tabItem(wrapper, 0), '.lucide-pin');
    await nextTick();

    const unpinPayloads = wrapper.emitted('unpin');
    expect(unpinPayloads).toHaveLength(1);
    // 载荷是当前标签映射后的配置，业务据此定位要解除固定的标签。
    expect(unpinPayloads?.[0]?.[0]).toMatchObject({
      affixTab: true,
      closable: true,
      key: 'home',
      title: 'DUMMY-首页',
    });
  });
});

describe('右键菜单透传', /** 菜单数据与触发标签不一致会让用户对错误的标签执行操作。 */ () => {
  it('按当前标签构建菜单并把真实标签数据交给菜单回调', /** 数据包写错会让菜单操作作用到别的标签上。 */ async () => {
    const handler = vi.fn();
    const menus = vi.fn(
      /** 记录收到的标签数据并产出菜单项。 */ (data: object) => {
        expect(data).toMatchObject({
          affixTab: false,
          closable: true,
          key: 'user',
          title: 'DUMMY-用户管理',
        });
        return [{ handler, key: 'close-others', text: 'DUMMY-关闭其他' }];
      },
    );
    const wrapper = mountTabs({ contextMenus: menus });

    // 真实右键点在标签标题上，事件冒泡到 reka-ui 的触发节点后打开菜单。
    const title = tabItem(wrapper, 1).querySelector<HTMLElement>('span');
    if (!title) {
      throw new Error('标签标题未渲染');
    }
    title.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        button: 2,
        clientX: 8,
        clientY: 16,
      }),
    );
    await vi.waitFor(
      /** 等待 reka-ui 传送节点真实渲染出菜单项。 */ () => {
        expect(document.querySelector('[role="menuitem"]')).not.toBeNull();
      },
      { timeout: 2000 },
    );

    expect(menus).toHaveBeenCalled();
    const menuItem = document.querySelector<HTMLElement>('[role="menuitem"]');
    expect(menuItem?.textContent).toContain('DUMMY-关闭其他');

    menuItem?.click();
    await vi.waitFor(
      /** 等待菜单点击回调真实执行。 */ () => {
        expect(handler).toHaveBeenCalledTimes(1);
      },
      { timeout: 2000 },
    );
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ key: 'user' });
  });
});
