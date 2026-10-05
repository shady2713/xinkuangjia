/**
 * 全局搜索面板（effects/layouts 的 widgets/global-search/search-panel.vue）真实搜索与导航回归。
 *
 * 该面板承担站内搜索的全部行为：关键词匹配与正则转义、结果渲染、上下键循环导航、回车跳转
 * （站内路由与站外链接两条分支）、Esc 关闭、鼠标移入切换激活项、以及结果与历史记录的删除。
 * 匹配写错会让用户搜不到已有菜单；键盘导航或回车分支写错会让用户按回车跳到错误页面，甚至把
 * 外链当站内路由推走；历史删除写错会误删当前搜索结果。用例在真实内存路由上把真实面板挂到
 * 文档里（组件内部用 document.querySelector 定位待滚动条目），真实派发键盘事件、真实点击条目
 * 与删除按钮，断言真实 DOM 高亮、真实路由落点、真实 localStorage 历史与真实事件。
 */
import type { DOMWrapper, VueWrapper } from '@vue/test-utils';
import type { Router, RouteRecordRaw } from 'vue-router';

import type { MenuRecordRaw } from '@vben/types';

import { mount } from '@vue/test-utils';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import { $t, setupI18n } from '@vben/locales';

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import SearchPanel from './search-panel.vue';

/** 搜索历史在 localStorage 中的真实键名，与组件使用的键保持一致。 */
const HISTORY_KEY = `__search-history-${location.hostname}__`;

/** 路由目标组件：跳转只需真实完成，不渲染业务内容。 */
const RouteView = defineComponent({
  name: 'SearchRouteView',
  /** 渲染最小宿主节点，证明路由跳转真实落地。 */
  render: () => h('div', { 'data-test': 'search-route-view' }),
});

/** 站内跳转目标路由表，覆盖一级菜单与子菜单路径。 */
const routes: RouteRecordRaw[] = [
  { component: RouteView, name: 'home', path: '/' },
  { component: RouteView, name: 'dashboard', path: '/dashboard' },
  { component: RouteView, name: 'system-user', path: '/system/user' },
];

/** 每个用例挂载的搜索面板；用例结束统一卸载，避免按键监听残留。 */
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
  /** 装载真实中文语言包：菜单名要经过真实 $t 映射，否则搜索匹配形同虚设。 */ async () => {
    await setupI18n(createAppHost(), { defaultLocale: 'zh-CN' });
  },
);

beforeEach(
  /** 为每个用例建立干净的就绪内存路由与空搜索历史，避免用例互相串味。 */ async () => {
    window.localStorage.clear();
    router = createRouter({ history: createMemoryHistory(), routes });
    await router.push('/');
    await router.isReady();
  },
);

afterEach(
  /** 卸载面板、清理文档与搜索历史、还原外部边界替身，保证用例之间没有残留。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    document.body.innerHTML = '';
    window.localStorage.clear();
    vi.restoreAllMocks();
  },
);

/**
 * 构造搜索用菜单树，包含一级菜单与子菜单，用于验证真实树遍历。
 * @returns 可直接传给搜索面板的菜单数组。
 */
function createMenus(): MenuRecordRaw[] {
  return [
    { name: 'DUMMY-仪表盘', path: '/dashboard' },
    {
      children: [{ name: 'DUMMY-用户管理', path: '/system/user' }],
      name: 'DUMMY-系统管理',
      path: '/system',
    },
  ];
}

/**
 * 把搜索历史写进真实 localStorage，模拟用户上次留下的记录。
 * @param paths 需要预置的菜单路径，名称按路径派生。
 */
function seedHistory(paths: string[]) {
  window.localStorage.setItem(
    HISTORY_KEY,
    JSON.stringify(
      paths.map(
        /** 按路径派生一条可搜索的历史记录。 */ (path) => ({
          name: `DUMMY-历史-${path}`,
          path,
        }),
      ),
    ),
  );
}

/**
 * 挂载搜索面板：真实挂到文档里并注入真实内存路由。
 * @param keyword 初始关键词。
 * @param menus 搜索用菜单树，缺省使用标准菜单树。
 * @returns 已挂载的搜索面板。
 */
function mountPanel(keyword = '', menus: MenuRecordRaw[] = createMenus()) {
  mounted = mount(SearchPanel, {
    attachTo: document.body,
    global: { plugins: [router] },
    props: { keyword, menus },
  });
  return mounted;
}

/**
 * 取出真实渲染的搜索结果条目（最近记录标题等普通 li 不含 data-search-item）。
 * @param wrapper 已挂载的搜索面板。
 * @returns 搜索结果条目包装器数组。
 */
function findResultRows(wrapper: VueWrapper): Array<DOMWrapper<Element>> {
  return wrapper.findAll('li[data-search-item]');
}

/**
 * 读取当前处于激活态（高亮）的结果条目索引。
 * @param wrapper 已挂载的搜索面板。
 * @returns 激活项的下标，没有激活项时返回 -1。
 */
function readActiveIndex(wrapper: VueWrapper): number {
  return findResultRows(wrapper).findIndex(
    /** 激活项由组件写入 active 样式类，是用户看到的高亮来源。 */ (row) =>
      row.classes().includes('active'),
  );
}

/**
 * 更新面板关键词并等待一次渲染。
 * @param wrapper 已挂载的搜索面板。
 * @param keyword 新关键词。
 */
async function typeKeyword(wrapper: VueWrapper, keyword: string) {
  await wrapper.setProps({ keyword });
  await nextTick();
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
 * 点击结果条目右侧的删除按钮。
 * @param wrapper 已挂载的搜索面板。
 * @param index 目标结果条目的下标。
 */
async function clickRemove(wrapper: VueWrapper, index: number) {
  const row = findResultRows(wrapper)[index];
  expect(row).toBeDefined();
  // 删除入口是条目内唯一带 rounded-full 的圆形包裹层，图标点击会冒泡到它。
  const removeButton = row?.find('div.rounded-full');
  expect(removeButton?.exists()).toBe(true);
  await removeButton?.trigger('click');
}

/**
 * 把 window.open 换成只记录调用的替身，避免测试真的打开新窗口。
 * @returns 记录调用参数的 window.open 替身。
 */
function stubWindowOpen() {
  return vi
    .spyOn(window, 'open')
    .mockImplementation(
      /** 记录外链地址并返回 null，模拟弹窗被浏览器拦截。 */ () =>
        null as unknown as Window,
    );
}

describe('搜索面板结果渲染', /** 结果渲染决定用户能否搜到并看懂匹配到的菜单。 */ () => {
  it('无关键词且无历史时提示没有最近记录', /** 空态缺失会让面板看起来是坏的。 */ () => {
    const wrapper = mountPanel();

    // 真实语言包装载后该键必须翻译成非键名文案，避免断言落在空串上而形同虚设。
    expect($t('ui.widgets.search.noRecent')).not.toBe(
      'ui.widgets.search.noRecent',
    );
    expect(wrapper.text()).toContain($t('ui.widgets.search.noRecent'));
    expect(findResultRows(wrapper)).toHaveLength(0);
  });

  it('关键词只有空白时按空关键词处理并清空结果', /** 空白关键词不裁剪会让上一次的结果一直留着。 */ async () => {
    const wrapper = mountPanel();

    await typeKeyword(wrapper, '   ');
    await new Promise(
      /** 等待搜索节流窗口走完，确认空关键词不会带来任何结果。 */ (resolve) => {
        setTimeout(resolve, 300);
      },
    );

    expect(findResultRows(wrapper)).toHaveLength(0);
  });

  it('关键词无匹配时回显关键词并提示无结果', /** 不回显关键词会让用户不知道搜的是什么。 */ async () => {
    const wrapper = mountPanel();

    await typeKeyword(wrapper, 'dummy-不存在的菜单');

    await vi.waitFor(
      /** 等待搜索节流后空结果态真实渲染。 */ () => {
        expect(wrapper.text()).toContain($t('ui.widgets.search.noResults'));
      },
    );
    expect(wrapper.text()).toContain('dummy-不存在的菜单');
    expect(findResultRows(wrapper)).toHaveLength(0);
  });

  it('关键词匹配时按菜单树渲染结果并把首项设为激活项', /** 子菜单漏搜会让用户搜不到深层功能。 */ async () => {
    const wrapper = mountPanel();

    await typeKeyword(wrapper, '用户');

    await vi.waitFor(
      /** 等待匹配结果真实渲染。 */ () => {
        expect(findResultRows(wrapper)).toHaveLength(1);
      },
    );
    expect(wrapper.text()).toContain('DUMMY-用户管理');
    expect(readActiveIndex(wrapper)).toBe(0);
    expect(findResultRows(wrapper)[0]?.attributes('data-search-item')).toBe(
      '0',
    );
  });

  it('关键词里的小数点按字面量匹配，不会误命中任意字符', /** 不转义会让 a.b 命中 axb，用户搜到风马牛不相及的菜单。 */ async () => {
    const wrapper = mountPanel('', [{ name: 'DUMMY-axb菜单', path: '/axb' }]);

    await typeKeyword(wrapper, 'a.b');
    await new Promise(
      /** 等待搜索节流窗口走完，确认小数点没有当成通配符。 */ (resolve) => {
        setTimeout(resolve, 300);
      },
    );
    expect(findResultRows(wrapper)).toHaveLength(0);

    await typeKeyword(wrapper, 'axb');
    await vi.waitFor(
      /** 等待字面关键词真实命中该菜单。 */ () => {
        expect(findResultRows(wrapper)).toHaveLength(1);
      },
    );
    expect(wrapper.text()).toContain('DUMMY-axb菜单');
  });

  it('关键词含未配对方括号时不会让搜索崩溃', /** 未转义会让 new RegExp 抛异常，整个面板停止响应。 */ async () => {
    const wrapper = mountPanel();

    await typeKeyword(wrapper, '[');
    await new Promise(
      /** 等待搜索节流窗口走完，确认非法正则没有把面板打崩。 */ (resolve) => {
        setTimeout(resolve, 300);
      },
    );
    expect(findResultRows(wrapper)).toHaveLength(0);

    await typeKeyword(wrapper, '用户');
    await vi.waitFor(
      /** 等待面板在后续关键词下恢复正常搜索。 */ () => {
        expect(findResultRows(wrapper)).toHaveLength(1);
      },
    );
  });
});

describe('搜索面板键盘导航', /** 键盘导航决定纯键盘用户能否选中并打开目标菜单。 */ () => {
  it('上下键在结果间循环移动并同步高亮', /** 越界不回头会让用户按到底后无法继续选择。 */ async () => {
    const wrapper = mountPanel();

    await typeKeyword(wrapper, 'dummy');
    await vi.waitFor(
      /** 等待三条匹配结果真实渲染（两个一级菜单加一个子菜单）。 */ () => {
        expect(findResultRows(wrapper)).toHaveLength(3);
      },
    );

    await pressKey('ArrowDown');
    expect(readActiveIndex(wrapper)).toBe(1);

    await pressKey('ArrowDown');
    expect(readActiveIndex(wrapper)).toBe(2);

    await pressKey('ArrowDown');
    expect(readActiveIndex(wrapper)).toBe(0);

    await pressKey('ArrowUp');
    expect(readActiveIndex(wrapper)).toBe(2);
  });

  it('无结果时按上下键与回车都不产生副作用', /** 空结果仍响应会让用户以为选中了不存在的项。 */ async () => {
    const wrapper = mountPanel();
    await typeKeyword(wrapper, 'dummy-不存在的菜单');
    await vi.waitFor(
      /** 等待空结果态真实渲染。 */ () => {
        expect(wrapper.text()).toContain($t('ui.widgets.search.noResults'));
      },
    );

    await pressKey('ArrowDown');
    await pressKey('ArrowUp');
    await pressKey('Enter');

    expect(readActiveIndex(wrapper)).toBe(-1);
    expect(router.currentRoute.value.path).toBe('/');
    expect(wrapper.emitted('close')).toBeUndefined();
  });

  it('历史记录尚未被选中时按回车不跳转', /** 把「没选中」当成选中会直接把用户带到错误页面。 */ async () => {
    seedHistory(['/dashboard', '/system/user']);
    const wrapper = mountPanel('', []);

    await vi.waitFor(
      /** 等待挂载时读取到的历史记录真实渲染。 */ () => {
        expect(findResultRows(wrapper)).toHaveLength(2);
      },
    );
    expect(readActiveIndex(wrapper)).toBe(-1);

    await pressKey('Enter');

    expect(router.currentRoute.value.path).toBe('/');
    expect(wrapper.emitted('close')).toBeUndefined();
  });

  it('回车跳转子菜单路由并写入真实搜索历史', /** 历史不落库会让用户下次打开面板看不到刚才的入口。 */ async () => {
    const wrapper = mountPanel();

    await typeKeyword(wrapper, '用户');
    await vi.waitFor(
      /** 等待匹配结果真实渲染。 */ () => {
        expect(findResultRows(wrapper)).toHaveLength(1);
      },
    );

    await pressKey('Enter');

    await vi.waitFor(
      /** 等待站内路由真实跳转完成。 */ () => {
        expect(router.currentRoute.value.path).toBe('/system/user');
      },
    );
    expect(wrapper.emitted('close')).toHaveLength(1);
    expect(
      JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? '[]'),
    ).toEqual([expect.objectContaining({ path: '/system/user' })]);
  });

  it('回车打开 http 外链而不改变站内路由', /** 把外链当站内路由推走会让用户停在站内空白页。 */ async () => {
    const open = stubWindowOpen();
    const wrapper = mountPanel('', [
      { name: 'DUMMY-外部文档', path: 'http://DUMMY-example.com/docs' },
    ]);
    await typeKeyword(wrapper, '外部文档');
    await vi.waitFor(
      /** 等待外链菜单项真实渲染。 */ () => {
        expect(findResultRows(wrapper)).toHaveLength(1);
      },
    );

    await pressKey('Enter');

    await vi.waitFor(
      /** 等待外链真实交给浏览器打开。 */ () => {
        expect(open).toHaveBeenCalledWith(
          'http://DUMMY-example.com/docs',
          '_blank',
        );
      },
    );
    expect(router.currentRoute.value.path).toBe('/');
  });

  it('esc 关闭面板并清空当前结果', /** 关不掉面板会让浮层一直挡住内容区。 */ async () => {
    const wrapper = mountPanel();

    await typeKeyword(wrapper, '用户');
    await vi.waitFor(
      /** 等待匹配结果真实渲染。 */ () => {
        expect(findResultRows(wrapper)).toHaveLength(1);
      },
    );

    await pressKey('Escape');

    expect(wrapper.emitted('close')).toHaveLength(1);
    expect(findResultRows(wrapper)).toHaveLength(0);
  });

  it('关键词被清空后重新展示历史记录', /** 清空关键词后不恢复历史会让用户每次都要重新搜一遍。 */ async () => {
    seedHistory(['/dashboard']);
    const wrapper = mountPanel();

    await typeKeyword(wrapper, '用户');
    await vi.waitFor(
      /** 等待关键词结果真实渲染。 */ () => {
        expect(findResultRows(wrapper)).toHaveLength(1);
      },
    );

    await typeKeyword(wrapper, '');

    await vi.waitFor(
      /** 等待历史记录重新渲染。 */ () => {
        expect(findResultRows(wrapper)).toHaveLength(1);
      },
    );
    expect(wrapper.text()).toContain($t('ui.widgets.search.recent'));
    expect(wrapper.text()).toContain('DUMMY-历史-/dashboard');
  });
});

describe('搜索面板鼠标交互', /** 鼠标操作是大多数用户选择与清理搜索结果的入口。 */ () => {
  it('点击结果条目直接跳转', /** 点击不跳会让鼠标用户无法使用搜索结果。 */ async () => {
    const wrapper = mountPanel();

    await typeKeyword(wrapper, '仪表盘');
    await vi.waitFor(
      /** 等待匹配结果真实渲染。 */ () => {
        expect(findResultRows(wrapper)).toHaveLength(1);
      },
    );

    await findResultRows(wrapper)[0]?.trigger('click');

    await vi.waitFor(
      /** 等待站内路由真实跳转完成。 */ () => {
        expect(router.currentRoute.value.path).toBe('/dashboard');
      },
    );
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('鼠标移入结果条目切换激活项', /** 移入不高亮会让用户点到自己没打算选的那条。 */ async () => {
    const wrapper = mountPanel();

    await typeKeyword(wrapper, 'dummy');
    await vi.waitFor(
      /** 等待三条匹配结果真实渲染。 */ () => {
        expect(findResultRows(wrapper)).toHaveLength(3);
      },
    );
    expect(readActiveIndex(wrapper)).toBe(0);

    await findResultRows(wrapper)[2]?.trigger('mouseenter');

    expect(readActiveIndex(wrapper)).toBe(2);
  });

  it('关键词模式下删除按钮只移除当前结果', /** 删错集合会让用户丢掉历史记录或搜索结果。 */ async () => {
    const wrapper = mountPanel();

    await typeKeyword(wrapper, 'dummy');
    await vi.waitFor(
      /** 等待三条匹配结果真实渲染。 */ () => {
        expect(findResultRows(wrapper)).toHaveLength(3);
      },
    );

    await clickRemove(wrapper, 0);

    expect(findResultRows(wrapper)).toHaveLength(2);
    expect(wrapper.text()).not.toContain('DUMMY-仪表盘');
    // 关键词模式下的删除只影响当前结果，不能写进历史（历史仍为空数组）。
    expect(
      JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? '[]'),
    ).toEqual([]);
  });

  it('历史模式下删除按钮只移除该条历史', /** 删错集合会让用户下次打开面板又看到已删掉的记录。 */ async () => {
    seedHistory(['/dashboard', '/system/user']);
    const wrapper = mountPanel('', []);

    await vi.waitFor(
      /** 等待挂载时读取到的历史记录真实渲染。 */ () => {
        expect(findResultRows(wrapper)).toHaveLength(2);
      },
    );
    expect(wrapper.text()).toContain($t('ui.widgets.search.recent'));

    await clickRemove(wrapper, 0);

    expect(findResultRows(wrapper)).toHaveLength(1);
    expect(
      JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? '[]'),
    ).toEqual([expect.objectContaining({ path: '/system/user' })]);
  });
});
