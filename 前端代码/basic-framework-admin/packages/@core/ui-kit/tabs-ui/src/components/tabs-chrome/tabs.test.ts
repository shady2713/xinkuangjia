/**
 * Chrome 风格标签页（tabs-ui 的 components/tabs-chrome）切换、关闭与固定入口真实回归。
 *
 * 该组件是标签栏的 chrome 风格实现：间距变量决定标签的圆角与分隔尺寸，点击标签决定当前激活项，
 * 中键与关闭图标决定标签能否被关掉，固定标签的解除入口决定用户能否把固定标签恢复成普通标签。
 * 间距变量写错会让整条标签栏尺寸错位；切换载荷写错会让路由停在旧页面；中键守卫（固定标签、
 * 不可关闭标签、仅剩一个标签、未开启中键关闭）失效会让固定标签被误关或标签无法关闭。
 * 用例用真实标签数据挂载组件，用真实鼠标事件驱动交互，断言真实 v-model 载荷与真实 DOM 状态。
 */
import type { VueWrapper } from '@vue/test-utils';

import type { TabDefinition } from '@vben-core/typings';

import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import TabsChrome from './tabs.vue';

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
 * 挂载真实 chrome 标签组件并记录宿主。
 * @param props 透传给组件的属性；缺省激活首页并开启中键关闭。
 * @returns 已挂载的组件包装器。
 */
function mountTabs(props: Record<string, unknown> = {}) {
  const wrapper = mount(TabsChrome, {
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
const TabsChromeHost = defineComponent({
  name: 'TabsChromeHost',
  /**
   * 建立激活状态并把真实标签数据交给被测组件。
   * @returns 渲染标签组件与激活值探针的渲染函数。
   */
  setup() {
    const active = ref('home');
    return /** 渲染标签组件与当前激活值。 */ () =>
      h('div', [
        h(TabsChrome, {
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

describe('chrome 标签渲染', /** 间距变量与激活标记决定标签栏尺寸和当前页高亮。 */ () => {
  it('渲染间距变量、激活标记与真实标题', /** 间距默认值或标题优先级写错会让标签栏尺寸错位或标题为空。 */ () => {
    const wrapper = mountTabs({ active: 'order' });

    const root = wrapper.find('.tabs-chrome');
    expect(root.exists()).toBe(true);
    // 未传 gap 时使用默认间距 7px，供圆角与分隔线复用。
    expect(root.attributes('style')).toContain('--gap: 7px');

    const items = tabItems(wrapper);
    expect(items).toHaveLength(4);
    expect(
      items.map(/** 读取每个标签的渲染下标。 */ (item) => item.dataset.index),
    ).toEqual(['0', '1', '2', '3']);
    // 激活值同时写在每个标签项上，供样式以外的消费方读取。
    expect(
      items.map(
        /** 读取每个标签项上的激活标记。 */ (item) => item.dataset.activeTab,
      ),
    ).toEqual(['order', 'order', 'order', 'order']);

    const text = wrapper.text();
    expect(text).toContain('DUMMY-首页');
    expect(text).toContain('DUMMY-用户管理');
    expect(text).toContain('DUMMY-订单(新标题)');
    expect(text).toContain('DUMMY-报表');
    expect(items[2]?.classList.contains('is-active')).toBe(true);
    expect(items[0]?.classList.contains('affix-tab')).toBe(true);
    expect(items[1]?.classList.contains('draggable')).toBe(true);
  });

  it('按 gap 属性渲染自定义间距', /** 间距未透传会让标签圆角与分隔线与配置不一致。 */ () => {
    const wrapper = mountTabs({ gap: 12 });

    expect(wrapper.find('.tabs-chrome').attributes('style')).toContain(
      '--gap: 12px',
    );
  });

  it('仅在非首个且非激活的标签上渲染分隔线', /** 分隔线判错会让标签之间出现断裂或丢失边界。 */ () => {
    const first = mountTabs({ active: 'home' });
    const firstItems = tabItems(first);
    expect(
      firstItems[0]?.querySelectorAll('.tabs-chrome__divider'),
    ).toHaveLength(0);
    expect(
      firstItems[1]?.querySelectorAll('.tabs-chrome__divider'),
    ).toHaveLength(1);
    // 每个标签都带左右两块背景圆角补丁。
    expect(
      firstItems[1]?.querySelectorAll('.tabs-chrome__background-before'),
    ).toHaveLength(1);
    expect(
      firstItems[1]?.querySelectorAll('.tabs-chrome__background-after'),
    ).toHaveLength(1);

    const second = mountTabs({ active: 'user' });
    const secondItems = tabItems(second);
    // 激活标签自身不画分隔线，避免高亮块被切开。
    expect(
      secondItems[1]?.querySelectorAll('.tabs-chrome__divider'),
    ).toHaveLength(0);
    expect(
      secondItems[2]?.querySelectorAll('.tabs-chrome__divider'),
    ).toHaveLength(1);
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
    expect(tabItem(shown, 1).querySelector('.dummy-tab-icon')).toBeNull();

    const hidden = mountTabs({ tabs: iconTabs });
    expect(tabItem(hidden, 0).querySelector('.dummy-tab-icon')).toBeNull();
  });
});

describe('chrome 标签点击切换', /** 切换载荷决定路由与高亮是否跟着用户点击走。 */ () => {
  it('点击标签发出真实 v-model 载荷', /** 载荷写错会让父级把激活项写到别的标签上。 */ async () => {
    const wrapper = mountTabs({ active: 'home' });

    tabItem(wrapper, 1).click();
    await nextTick();

    expect(wrapper.emitted('update:active')).toEqual([['user']]);
  });

  it('真实 v-model 回写后激活高亮与激活标记一起移动', /** 事件发出但状态不回写会让高亮与业务状态脱节。 */ async () => {
    const wrapper = mount(TabsChromeHost);
    mountedWrappers.push(wrapper);

    expect(wrapper.get('[data-test="active-probe"]').text()).toBe('home');
    expect(tabItem(wrapper, 0).dataset.activeTab).toBe('home');

    tabItem(wrapper, 2).click();
    await nextTick();

    expect(wrapper.get('[data-test="active-probe"]').text()).toBe('order');
    expect(tabItem(wrapper, 2).classList.contains('is-active')).toBe(true);
    expect(tabItem(wrapper, 2).dataset.activeTab).toBe('order');
    expect(tabItem(wrapper, 0).classList.contains('is-active')).toBe(false);
  });
});

describe('chrome 标签中键关闭', /** 中键守卫决定固定标签与不可关闭标签会不会被误关。 */ () => {
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

describe('chrome 标签关闭与解除固定入口', /** 图标显隐与载荷决定用户能否关掉标签或恢复固定标签。 */ () => {
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

describe('chrome 标签右键菜单透传', /** 菜单数据与触发标签不一致会让用户对错误的标签执行操作。 */ () => {
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
