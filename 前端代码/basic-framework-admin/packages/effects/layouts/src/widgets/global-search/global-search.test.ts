/**
 * 全局搜索入口（effects/layouts 的 widgets/global-search/global-search.vue）真实交互回归。
 *
 * 该入口是站内搜索的唯一门面：点击或 Ctrl/⌘+K 必须真实打开弹窗并把焦点交给搜索框，弹窗里的关键词
 * 由真实搜索面板驱动、回车走真实跳转，Esc 或取消按钮必须真实关闭并清空关键词，快捷键开关切换时
 * 必须真的挂上/摘掉窗口按键监听（否则用户会莫名其妙被浏览器查找框抢走按键）。用例挂载真实入口与
 * 真实弹窗、真实键盘、真实输入与真实内存路由，断言真实 DOM、真实焦点、真实路由落点与真实事件。
 */
import type { VueWrapper } from '@vue/test-utils';
import type { Router, RouteRecordRaw } from 'vue-router';

import type { MenuRecordRaw } from '@vben/types';

import { DOMWrapper, mount } from '@vue/test-utils';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import { $t, setupI18n } from '@vben/locales';
import { isWindowsOs } from '@vben/utils';

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import GlobalSearch from './global-search.vue';

vi.mock(
  '@vben/icons',
  /**
   * 图标来自远程 Iconify，属于外部渲染边界；替换为带名称标识的最小元素，
   * 既避免测试联网取图标，又让断言可以定位到具体图标。
   */ () => {
    /**
     * 生成带名称标识的图标替身组件。
     * @param name 图标名，同时作为 DOM 上的 data-icon 标识。
     * @returns 渲染为 i 元素的图标替身组件。
     */
    function createIconStub(name: string) {
      return { name, template: `<i data-icon="${name}"></i>` };
    }
    return {
      ArrowDown: createIconStub('ArrowDown'),
      ArrowUp: createIconStub('ArrowUp'),
      CornerDownLeft: createIconStub('CornerDownLeft'),
      MdiKeyboardEsc: createIconStub('MdiKeyboardEsc'),
      Search: createIconStub('Search'),
      SearchX: createIconStub('SearchX'),
      X: createIconStub('X'),
    };
  },
);

/** 路由目标组件：跳转只需真实完成，不渲染业务内容。 */
const RouteView = defineComponent({
  name: 'GlobalSearchRouteView',
  /** 渲染最小宿主节点，证明路由跳转真实落地。 */
  render: () => h('div', { 'data-test': 'global-search-route-view' }),
});

/** 站内跳转目标路由表。 */
const routes: RouteRecordRaw[] = [
  { component: RouteView, name: 'home', path: '/' },
  { component: RouteView, name: 'system-user', path: '/system/user' },
];

/** 每个用例挂载的全局搜索入口；用例结束统一卸载并清理弹窗传送节点。 */
let mounted: undefined | VueWrapper;

/** 每个用例的真实内存路由；用例内断言跳转落点。 */
let router: Router;

/**
 * 建立仅用于安装 i18n 插件的空应用宿主。
 * @returns 未挂载的空 Vue 应用实例。
 */
function createAppHost() {
  return createApp({
    /** 渲染空节点：宿主只用于安装 i18n 插件，不参与界面断言。 */
    render: () => h('div'),
  });
}

beforeAll(
  /** 装载真实中文语言包：否则 $t 返回空串，所有文案断言都会形同虚设。 */ async () => {
    await setupI18n(createAppHost(), { defaultLocale: 'zh-CN' });
  },
);

beforeEach(
  /** 为每个用例建立干净的就绪内存路由，避免上一个用例的落点残留。 */ async () => {
    window.localStorage.clear();
    router = createRouter({ history: createMemoryHistory(), routes });
    await router.push('/');
    await router.isReady();
  },
);

afterEach(
  /** 卸载入口、清理弹窗传送节点与外部边界替身，保证用例之间没有残留。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    document.body.innerHTML = '';
    window.localStorage.clear();
    vi.restoreAllMocks();
  },
);

/**
 * 构造搜索用菜单树，包含可被关键词命中的菜单项。
 * @returns 可直接传给入口的菜单数组。
 */
function createMenus(): MenuRecordRaw[] {
  return [
    { name: 'DUMMY-仪表盘', path: '/dashboard' },
    { name: 'DUMMY-用户管理', path: '/system/user' },
  ];
}

/**
 * 挂载全局搜索入口并注入真实内存路由。
 * @param enableShortcutKey 是否启用快捷键，缺省启用。
 * @param menus 搜索用菜单树，缺省使用标准菜单树。
 * @returns 已挂载的入口宿主。
 */
function mountGlobalSearch(
  enableShortcutKey = true,
  menus: MenuRecordRaw[] = createMenus(),
) {
  mounted = mount(GlobalSearch, {
    global: { plugins: [router] },
    props: { enableShortcutKey, menus },
  });
  return mounted;
}

/**
 * 取弹窗里真实渲染的搜索输入框。
 * @returns 输入框元素，弹窗未打开时为 null。
 */
function findSearchInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('input');
}

/**
 * 读取入口里用于点击开合的触发区域。
 * @param wrapper 已挂载的入口宿主。
 * @returns 触发区域的 DOM 包装器。
 */
function findTrigger(wrapper: VueWrapper): Omit<DOMWrapper<Element>, 'exists'> {
  return wrapper.get('div.group.cursor-pointer');
}

/**
 * 点击入口真实打开弹窗并等待内容渲染。
 * @param wrapper 已挂载的入口宿主。
 */
async function openModal(wrapper: VueWrapper) {
  await findTrigger(wrapper).trigger('click');
  await vi.waitFor(
    /** 等待弹窗内容真实挂载出搜索框。 */ () => {
      expect(findSearchInput()).not.toBeNull();
    },
  );
}

/**
 * 按真实文案在传送后的弹窗 DOM 中查找按钮。
 * @param text 目标按钮的文案。
 * @returns 命中的按钮元素，未找到时为 undefined。
 */
function findButtonByText(text: string) {
  return [...document.querySelectorAll('button')].find(
    /** 只保留文案与目标一致的按钮，避免点到相邻的操作。 */ (button) =>
      button.textContent?.trim() === text,
  );
}

/**
 * 取出弹窗里真实渲染的搜索结果条目。
 * @returns 结果条目元素数组。
 */
function findResultRows(): Element[] {
  return [...document.querySelectorAll('li[data-search-item]')];
}

/**
 * 真实按下并抬起浏览器级搜索组合键（Windows 用 Ctrl+K，其余平台用 ⌘+K）。
 * @returns 承载「K」按键的事件对象，用于断言默认行为是否被阻止。
 */
async function pressSearchShortcut() {
  const isWindows = isWindowsOs();
  const modifierKey = isWindows ? 'Control' : 'Meta';
  window.dispatchEvent(new KeyboardEvent('keydown', { key: modifierKey }));
  const keyEvent = new KeyboardEvent('keydown', {
    cancelable: true,
    ctrlKey: isWindows,
    key: 'k',
    metaKey: !isWindows,
  });
  window.dispatchEvent(keyEvent);
  await nextTick();
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'k' }));
  window.dispatchEvent(new KeyboardEvent('keyup', { key: modifierKey }));
  await nextTick();
  return keyEvent;
}

/**
 * 在窗口上真实派发一次按键。
 * @param key 按键名，与浏览器 event.key 一致。
 */
async function pressKey(key: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key }));
  await nextTick();
}

/**
 * 在弹窗搜索框里真实输入关键词。
 * @param keyword 要输入的关键词。
 */
async function typeKeyword(keyword: string) {
  const input = findSearchInput();
  expect(input).not.toBeNull();
  await new DOMWrapper(input as Element).setValue(keyword);
}

describe('全局搜索入口渲染', /** 入口与快捷键提示决定用户能否找到并打开搜索。 */ () => {
  it('渲染入口文案、按键提示且初始不打开弹窗', /** 初始自动弹出会遮挡用户正在浏览的页面。 */ () => {
    const wrapper = mountGlobalSearch();

    expect($t('ui.widgets.search.title')).not.toBe('ui.widgets.search.title');
    expect(wrapper.text()).toContain($t('ui.widgets.search.title'));
    expect(wrapper.get('kbd').text()).toBe('K');
    expect(wrapper.text()).toContain(isWindowsOs() ? 'Ctrl' : '⌘');
    expect(findSearchInput()).toBeNull();
  });

  it('关闭快捷键开关后不再渲染按键提示', /** 提示与真实能力不一致会误导用户去按无效组合键。 */ () => {
    const wrapper = mountGlobalSearch(false);

    expect(wrapper.find('kbd').exists()).toBe(false);
    expect(wrapper.text()).not.toContain(isWindowsOs() ? 'Ctrl' : '⌘');
  });
});

describe('全局搜索弹窗开合', /** 开合链路决定入口点了有没有反应。 */ () => {
  it('点击入口真实打开弹窗并把焦点交给搜索框', /** 打开后不聚焦会让用户还得再点一次输入框才能打字。 */ async () => {
    const wrapper = mountGlobalSearch();

    await openModal(wrapper);

    const input = findSearchInput();
    expect(input?.getAttribute('placeholder')).toBe(
      $t('ui.widgets.search.searchNavigate'),
    );
    await vi.waitFor(
      /** 等待弹窗打开后的下一拍把焦点真实交给搜索框。 */ () => {
        expect(document.activeElement).toBe(input);
      },
    );
  });

  it('再次点击入口收起弹窗并在重开后清空关键词', /** 关键词不随关闭重置会让用户重开时看到上一次的残留结果。 */ async () => {
    const wrapper = mountGlobalSearch();
    await openModal(wrapper);
    await typeKeyword('用户');
    await vi.waitFor(
      /** 等待匹配结果真实渲染。 */ () => {
        expect(findResultRows()).toHaveLength(1);
      },
    );

    await findTrigger(wrapper).trigger('click');
    await vi.waitFor(
      /** 等待弹窗内容真实卸载。 */ () => {
        expect(findSearchInput()).toBeNull();
      },
    );

    await openModal(wrapper);

    expect(findSearchInput()?.value).toBe('');
    expect(findResultRows()).toHaveLength(0);
  });

  it('快捷键真实打开弹窗并阻止浏览器默认查找行为', /** 不阻止默认行为会让浏览器查找框和站内搜索同时弹出。 */ async () => {
    mountGlobalSearch();

    const keyEvent = await pressSearchShortcut();

    await vi.waitFor(
      /** 等待组合键真实打开弹窗。 */ () => {
        expect(findSearchInput()).not.toBeNull();
      },
    );
    expect(keyEvent.defaultPrevented).toBe(true);
    expect(document.body.textContent).toContain($t('ui.widgets.search.select'));
  });

  it('关闭快捷键开关后组合键既不打开弹窗也不拦截默认行为', /** 关掉开关仍拦截按键会让浏览器查找功能彻底失效。 */ async () => {
    mountGlobalSearch(false);

    const keyEvent = await pressSearchShortcut();

    expect(findSearchInput()).toBeNull();
    expect(keyEvent.defaultPrevented).toBe(false);
  });

  it('运行时切换快捷键开关会真实挂载与摘除窗口按键监听', /** 监听没摘干净会让用户关掉开关后按键仍被吞掉。 */ async () => {
    const wrapper = mountGlobalSearch();

    const enabledEvent = new KeyboardEvent('keydown', {
      cancelable: true,
      ctrlKey: true,
      key: 'k',
    });
    window.dispatchEvent(enabledEvent);
    expect(enabledEvent.defaultPrevented).toBe(true);

    await wrapper.setProps({ enableShortcutKey: false });
    await nextTick();
    const disabledEvent = new KeyboardEvent('keydown', {
      cancelable: true,
      ctrlKey: true,
      key: 'k',
    });
    window.dispatchEvent(disabledEvent);
    expect(disabledEvent.defaultPrevented).toBe(false);

    await wrapper.setProps({ enableShortcutKey: true });
    await nextTick();
    const reEnabledEvent = new KeyboardEvent('keydown', {
      cancelable: true,
      ctrlKey: true,
      key: 'k',
    });
    window.dispatchEvent(reEnabledEvent);
    expect(reEnabledEvent.defaultPrevented).toBe(true);
  });

  it('弹窗页脚用快捷键提示替代了默认的取消与确认按钮', /** 快捷提示被默认按钮挤掉会让用户看不到可用按键。 */ async () => {
    const wrapper = mountGlobalSearch();

    await openModal(wrapper);

    // 入口整块覆写了弹窗的 footer 插槽，因此默认的取消/确认按钮不会渲染，
    // 组件里 useVbenModal 注册的 onCancel 也就没有触发入口（详见交付说明）。
    const footerText = document.body.textContent ?? '';
    expect(footerText).toContain($t('ui.widgets.search.select'));
    expect(footerText).toContain($t('ui.widgets.search.navigate'));
    expect(footerText).toContain($t('ui.widgets.search.close'));
    expect(findButtonByText($t('cancel'))).toBeUndefined();
    expect(findButtonByText($t('confirm'))).toBeUndefined();
  });
});

describe('全局搜索真实搜索链路', /** 输入、跳转与清空决定用户能否真正用搜索打开目标页面。 */ () => {
  it('真实输入关键词后回车跳转到命中的菜单', /** 入口与搜索面板断链会让用户搜到结果却跳不过去。 */ async () => {
    const wrapper = mountGlobalSearch();
    await openModal(wrapper);

    await typeKeyword('用户');
    await vi.waitFor(
      /** 等待真实搜索面板渲染出匹配结果。 */ () => {
        expect(findResultRows()).toHaveLength(1);
      },
    );
    expect(document.body.textContent).toContain('DUMMY-用户管理');

    await pressKey('Enter');

    await vi.waitFor(
      /** 等待站内路由真实跳转完成并且弹窗收起。 */ () => {
        expect(router.currentRoute.value.path).toBe('/system/user');
        expect(findSearchInput()).toBeNull();
      },
    );
  });

  it('esc 关闭弹窗并在再次打开时给出空关键词', /** 关键词不重置会让用户下次打开就看到上一次的残留结果。 */ async () => {
    const wrapper = mountGlobalSearch();
    await openModal(wrapper);
    await typeKeyword('用户');
    await vi.waitFor(
      /** 等待匹配结果真实渲染。 */ () => {
        expect(findResultRows()).toHaveLength(1);
      },
    );

    await pressKey('Escape');
    await vi.waitFor(
      /** 等待 Esc 真实关闭弹窗。 */ () => {
        expect(findSearchInput()).toBeNull();
      },
    );

    await openModal(wrapper);

    expect(findSearchInput()?.value).toBe('');
    expect(findResultRows()).toHaveLength(0);
  });
});
