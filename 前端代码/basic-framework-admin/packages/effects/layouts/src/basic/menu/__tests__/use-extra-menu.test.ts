/**
 * 混合菜单的附加菜单（layouts 的 basic/menu/use-extra-menu）真实行为回归。
 *
 * 该 composable 决定顶栏混合布局下右侧附加菜单展示哪些子菜单、哪个子菜单高亮，以及
 * 点击顶级菜单后跳到默认子菜单还是停留在原处：层级取错会让高亮落在错误的父菜单上，
 * 路由变化后未重算会让附加菜单停留在上一次的路由，展开方式（悬停展开/点击展开）判断
 * 写反会让菜单在悬停时消失或无法展开。用例在真实 vue-router 内存路由上调用真实
 * composable，只替换访问菜单来源与偏好配置边界，用真实的响应式状态与路由状态断言行为。
 */
import type { ComputedRef } from 'vue';

import type { MenuRecordRaw } from '@vben/types';

import { mount } from '@vue/test-utils';
import { computed, defineComponent, h, nextTick } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useExtraMenu } from '../use-extra-menu';

/** 访问菜单来源；模块替身与用例读取同一实例。 */
const storeProbe = vi.hoisted(
  /** 建立用例可替换的访问菜单容器。 */ () => ({
    accessMenus: [] as MenuRecordRaw[],
  }),
);

/** 偏好配置；模块替身与用例读取同一实例。 */
const preferencesProbe = vi.hoisted(
  /** 建立用例可改写的偏好配置容器。 */ () => ({
    preferences: {
      app: { layout: 'sidebar-nav' },
      sidebar: { autoActivateChild: false, expandOnHover: false },
    },
  }),
);

vi.mock(
  '@vben/stores',
  /** 只替换访问菜单来源，composable 自身的菜单计算逻辑保持真实实现。 */ () => ({
    /** 返回用例可替换的访问菜单容器，替代真实 pinia store。 */
    useAccessStore: () => storeProbe,
  }),
);

vi.mock(
  '@vben/preferences',
  /** 只替换偏好配置来源，composable 自身对布局与展开方式的判断保持真实实现。 */ () => ({
    preferences: preferencesProbe.preferences,
  }),
);

/** 菜单夹具：两级结构，父菜单 /system 下有两个子菜单。 */
const MENUS: MenuRecordRaw[] = [
  { children: [], name: 'Dashboard', path: '/dashboard' },
  {
    children: [
      {
        children: [],
        name: 'User',
        parents: ['/system'],
        path: '/system/user',
      },
      {
        children: [],
        name: 'Role',
        parents: ['/system'],
        path: '/system/role',
      },
    ],
    name: 'System',
    path: '/system',
  },
];

/** 另一份菜单夹具：用于验证传入的根菜单优先于访问菜单。 */
const CUSTOM_MENUS: MenuRecordRaw[] = [
  {
    children: [
      { children: [], name: 'Audit', parents: ['/audit'], path: '/audit/log' },
    ],
    name: 'Audit',
    path: '/audit',
  },
];

/** 内存路由表：覆盖站内页面、激活路径别名与外链三种情况。 */
const ROUTES = [
  { component: { name: 'HomeView' }, name: 'Home', path: '/' },
  {
    component: { name: 'DashboardView' },
    name: 'Dashboard',
    path: '/dashboard',
  },
  { component: { name: 'UserView' }, name: 'User', path: '/system/user' },
  { component: { name: 'RoleView' }, name: 'Role', path: '/system/role' },
  { component: { name: 'SystemView' }, name: 'System', path: '/system' },
  { component: { name: 'AuditView' }, name: 'Audit', path: '/audit/log' },
  { component: { name: 'AuditRootView' }, name: 'AuditRoot', path: '/audit' },
  {
    component: { name: 'AliasView' },
    meta: { activePath: '/system/user', title: '别名页' },
    name: 'Alias',
    path: '/alias',
  },
  {
    component: { name: 'ExternalView' },
    meta: { link: 'https://docs.example.test/guide', title: '外链页' },
    name: 'External',
    path: '/external',
  },
];

/**
 * 挂载宿主组件并在真实路由上下文中调用被测 composable。
 * @param options 挂载选项。
 * @param options.path 初始路由路径，决定首次计算使用的路径。
 * @param options.rootMenus 传给 composable 的根菜单；省略时回退到访问菜单。
 * @returns 已挂载的包装器、真实内存路由与 composable 的返回值。
 * @throws Error 宿主组件未取得菜单能力时抛出，避免用例静默地什么都不验证。
 */
async function mountExtraMenu(
  options: { path?: string; rootMenus?: MenuRecordRaw[] } = {},
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ROUTES,
  });
  await router.push(options.path ?? '/');
  await router.isReady();

  const rootMenus = options.rootMenus;
  const captured: { extra?: ReturnType<typeof useExtraMenu> } = {};
  const Host = defineComponent({
    name: 'ExtraMenuHost',
    /**
     * 取得被测 composable 的返回值并渲染占位节点。
     * @returns 渲染占位节点的渲染函数。
     */
    setup() {
      const menus: ComputedRef<MenuRecordRaw[]> | undefined = rootMenus
        ? computed(
            /** 把用例声明的根菜单包成 composable 期望的计算属性。 */ () =>
              rootMenus,
          )
        : undefined;
      captured.extra = useExtraMenu(menus);
      return /** 渲染可定位节点，证明 setup 已在真实渲染中执行。 */ () =>
        h('div', { class: 'extra-menu-host' });
    },
  });

  const wrapper = mount(Host, { global: { plugins: [router] } });
  await nextTick();
  if (!captured.extra) {
    throw new Error('宿主组件未取得附加菜单能力');
  }
  return { extra: captured.extra, router, wrapper };
}

/**
 * 切换路由并等待响应式重算完成。
 * @param router 真实内存路由实例。
 * @param path 目标路由路径。
 */
async function navigateTo(
  router: ReturnType<typeof createRouter>,
  path: string,
) {
  await router.push(path);
  await nextTick();
}

beforeEach(
  /** 还原访问菜单与偏好配置，避免上一例状态影响断言。 */ () => {
    vi.clearAllMocks();
    storeProbe.accessMenus = MENUS;
    preferencesProbe.preferences.app.layout = 'sidebar-nav';
    preferencesProbe.preferences.sidebar.autoActivateChild = false;
    preferencesProbe.preferences.sidebar.expandOnHover = false;
  },
);

describe('附加菜单的菜单来源', /** 菜单来源决定附加菜单展示哪一套子菜单。 */ () => {
  it('未传入根菜单时使用访问菜单', /** 回退来源写错会让附加菜单拿不到任何子菜单。 */ async () => {
    const { extra } = await mountExtraMenu({ path: '/system/user' });

    extra.handleSideMouseLeave();

    expect(
      extra.extraMenus.value.map(
        /** 取出子菜单路径，核对来自访问菜单的 /system 子级。 */ (menu) =>
          menu.path,
      ),
    ).toEqual(['/system/user', '/system/role']);
  });

  it('传入根菜单时优先使用传入值', /** 优先顺序写反会让页面无法定制自己的附加菜单。 */ async () => {
    const { extra } = await mountExtraMenu({
      path: '/audit/log',
      rootMenus: CUSTOM_MENUS,
    });

    extra.handleSideMouseLeave();

    expect(
      extra.extraMenus.value.map(
        /** 取出子菜单路径，核对来自传入根菜单的 /audit 子级。 */ (menu) =>
          menu.path,
      ),
    ).toEqual(['/audit/log']);
  });
});

describe('附加菜单的层级口径', /** 层级决定高亮取父级链上的第几个路径。 */ () => {
  it('普通布局取父级链的第一项', /** 层级取错会让高亮落在错误的父菜单上。 */ async () => {
    preferencesProbe.preferences.app.layout = 'sidebar-nav';
    const { extra } = await mountExtraMenu({ path: '/system/user' });

    extra.handleMenuMouseEnter({
      children: [],
      name: 'Deep',
      parents: ['/a', '/b'],
      path: '/deep',
    });

    expect(extra.extraActiveMenu.value).toBe('/a');
  });

  it('顶栏混合布局取父级链的第二项', /** 混合布局下少取一层会让高亮停在顶栏分组而不是当前分组。 */ async () => {
    preferencesProbe.preferences.app.layout = 'header-mixed-nav';
    const { extra } = await mountExtraMenu({ path: '/system/user' });

    extra.handleMenuMouseEnter({
      children: [],
      name: 'Deep',
      parents: ['/a', '/b'],
      path: '/deep',
    });

    expect(extra.extraActiveMenu.value).toBe('/b');
  });

  it('父级链缺失时回退到菜单自身路径', /** 缺少兜底会让高亮变成空串，菜单没有任何选中态。 */ async () => {
    const { extra } = await mountExtraMenu({ path: '/system/user' });

    extra.handleMenuMouseEnter({ children: [], name: 'Bare', path: '/bare' });

    expect(extra.extraActiveMenu.value).toBe('/bare');
  });
});

describe('路由变化后的重算', /** 路由变化必须重算附加菜单，否则会停留在上一次的路由。 */ () => {
  it('初始化时按当前路由计算附加菜单', /** 未在首次渲染时计算会让附加菜单一开始就是空的。 */ async () => {
    const { extra } = await mountExtraMenu({ path: '/system/user' });

    expect(extra.extraActiveMenu.value).toBe('/system');
    expect(
      extra.extraMenus.value.map(
        /** 取出子菜单路径，核对首次计算的结果。 */ (menu) => menu.path,
      ),
    ).toEqual(['/system/user', '/system/role']);
  });

  it('路由切换到子菜单后重算高亮', /** 未监听路由会让切换页面后附加菜单仍高亮上一个分组。 */ async () => {
    const { extra, router } = await mountExtraMenu({ path: '/dashboard' });
    // /dashboard 自身就是菜单项但没有父级链，高亮回退到它自己的路径。
    expect(extra.extraActiveMenu.value).toBe('/dashboard');

    await navigateTo(router, '/system/role');

    expect(extra.extraActiveMenu.value).toBe('/system');
    expect(
      extra.extraMenus.value.map(
        /** 取出子菜单路径，核对切换后的计算结果。 */ (menu) => menu.path,
      ),
    ).toEqual(['/system/user', '/system/role']);
  });

  it('路由元信息声明激活路径时按激活路径计算', /** 忽略 activePath 会让详情页一类路由在附加菜单里失去高亮。 */ async () => {
    const { extra, router } = await mountExtraMenu({ path: '/dashboard' });

    await navigateTo(router, '/alias');

    expect(extra.extraActiveMenu.value).toBe('/system');
    expect(
      extra.extraMenus.value.map(
        /** 取出子菜单路径，核对按激活路径计算的结果。 */ (menu) => menu.path,
      ),
    ).toEqual(['/system/user', '/system/role']);
  });

  it('悬停展开模式下重算同时打开附加菜单', /** 悬停展开模式漏设可见标记会让附加菜单无法显示。 */ async () => {
    preferencesProbe.preferences.sidebar.expandOnHover = true;
    const { extra, router } = await mountExtraMenu({ path: '/dashboard' });
    expect(extra.sidebarExtraVisible.value).toBe(false);

    await navigateTo(router, '/system/user');

    expect(extra.sidebarExtraVisible.value).toBe(true);
  });

  it('路由不在任何菜单下时清空附加菜单', /** 未清空会让用户离开业务页面后仍看到上一个分组的子菜单。 */ async () => {
    const { extra, router } = await mountExtraMenu({ path: '/system/user' });

    await navigateTo(router, '/external');

    expect(extra.extraActiveMenu.value).toBe('');
    expect(extra.extraMenus.value).toEqual([]);
  });
});

describe('点击顶级菜单', /** 点击顶级菜单决定是否跳转以及跳转到哪个子菜单。 */ () => {
  it('有子菜单时展开附加菜单并高亮父级', /** 未展开会让用户点了顶级菜单却看不到任何子菜单。 */ async () => {
    const { extra } = await mountExtraMenu({ path: '/dashboard' });
    const systemMenu = MENUS[1];

    await extra.handleMixedMenuSelect(systemMenu as MenuRecordRaw);

    expect(extra.sidebarExtraVisible.value).toBe(true);
    expect(extra.extraActiveMenu.value).toBe('/system');
    expect(
      extra.extraMenus.value.map(
        /** 取出子菜单路径，核对展开的正是该顶级菜单的子级。 */ (menu) =>
          menu.path,
      ),
    ).toEqual(['/system/user', '/system/role']);
  });

  it('没有子菜单时直接跳转到该菜单路径', /** 未跳转会让叶子菜单点击后没有任何反应。 */ async () => {
    const { extra, router } = await mountExtraMenu({ path: '/' });

    await extra.handleMixedMenuSelect(MENUS[0] as MenuRecordRaw);

    expect(router.currentRoute.value.path).toBe('/dashboard');
    expect(extra.sidebarExtraVisible.value).toBe(false);
  });

  it('开启自动激活子菜单时跳转到最近激活的子菜单', /** 未使用最近激活的子菜单会让用户每次都被带回分组首页。 */ async () => {
    preferencesProbe.preferences.sidebar.autoActivateChild = true;
    const { extra, router } = await mountExtraMenu({ path: '/system/user' });
    await navigateTo(router, '/dashboard');

    await extra.handleMixedMenuSelect(MENUS[1] as MenuRecordRaw);

    expect(router.currentRoute.value.path).toBe('/system/user');
  });

  it('没有最近激活记录时跳转到分组自身路径', /** 映射缺失时误取空值会让跳转目标为空，菜单点击没有任何反应。 */ async () => {
    preferencesProbe.preferences.sidebar.autoActivateChild = true;
    const { extra, router } = await mountExtraMenu({ path: '/dashboard' });

    await extra.handleMixedMenuSelect(MENUS[1] as MenuRecordRaw);

    expect(router.currentRoute.value.path).toBe('/system');
  });

  it('未开启自动激活子菜单时停留在当前路由', /** 误跳转会让用户只点了一下分组就被带离当前页面。 */ async () => {
    preferencesProbe.preferences.sidebar.autoActivateChild = false;
    const { extra, router } = await mountExtraMenu({ path: '/dashboard' });

    await extra.handleMixedMenuSelect(MENUS[1] as MenuRecordRaw);

    expect(router.currentRoute.value.path).toBe('/dashboard');
  });

  it('目标由外链或新窗口承载时不展开附加菜单', /** 误展开会让外链点击后当前页面残留无关的子菜单。 */ async () => {
    const { extra } = await mountExtraMenu({ path: '/dashboard' });
    const externalMenu: MenuRecordRaw = {
      children: [
        { children: [], name: 'Doc', parents: ['/external'], path: '/doc' },
      ],
      name: 'External',
      path: '/external',
    };

    await extra.handleMixedMenuSelect(externalMenu);

    expect(extra.sidebarExtraVisible.value).toBe(false);
    expect(extra.extraMenus.value).toEqual([]);
  });
});

describe('选择默认菜单与鼠标移入移出', /** 这两种交互决定悬停展开模式下的附加菜单内容与显隐。 */ () => {
  it('选择默认菜单时按传入的根菜单展开', /** 未使用传入的根菜单会让悬停展开显示错误的子菜单。 */ async () => {
    preferencesProbe.preferences.sidebar.expandOnHover = true;
    const { extra } = await mountExtraMenu({ path: '/dashboard' });
    const systemMenu = MENUS[1] as MenuRecordRaw;

    extra.handleDefaultSelect(
      systemMenu.children?.[0] as MenuRecordRaw,
      systemMenu,
    );

    expect(extra.sidebarExtraVisible.value).toBe(true);
    expect(extra.extraActiveMenu.value).toBe('/system');
    expect(
      extra.extraMenus.value.map(
        /** 取出子菜单路径，核对按传入根菜单展开的结果。 */ (menu) => menu.path,
      ),
    ).toEqual(['/system/user', '/system/role']);
  });

  it('未传入根菜单时沿用路由重算的根菜单', /** 回退来源写错会让悬停展开丢失全部子菜单。 */ async () => {
    preferencesProbe.preferences.sidebar.expandOnHover = true;
    const { extra } = await mountExtraMenu({ path: '/system/user' });

    extra.handleDefaultSelect({
      children: [],
      name: 'User',
      path: '/system/user',
    });

    expect(
      extra.extraMenus.value.map(
        /** 取出子菜单路径，核对沿用路由重算结果的子级。 */ (menu) => menu.path,
      ),
    ).toEqual(['/system/user', '/system/role']);
  });

  it('非悬停展开模式下选择默认菜单不改变可见性', /** 误设可见会让点击展开模式下的附加菜单被错误打开。 */ async () => {
    preferencesProbe.preferences.sidebar.expandOnHover = false;
    const { extra } = await mountExtraMenu({ path: '/dashboard' });

    extra.handleDefaultSelect(
      MENUS[1]?.children?.[0] as MenuRecordRaw,
      MENUS[1] as MenuRecordRaw,
    );

    expect(extra.sidebarExtraVisible.value).toBe(false);
  });

  it('鼠标移入菜单时按菜单子级更新附加菜单', /** 未更新会让悬停到其它分组后仍显示上一个分组的子菜单。 */ async () => {
    const { extra } = await mountExtraMenu({ path: '/dashboard' });

    extra.handleMenuMouseEnter(MENUS[1] as MenuRecordRaw);

    expect(extra.extraActiveMenu.value).toBe('/system');
    expect(extra.sidebarExtraVisible.value).toBe(true);
    expect(
      extra.extraMenus.value.map(
        /** 取出子菜单路径，核对悬停菜单的子级。 */ (menu) => menu.path,
      ),
    ).toEqual(['/system/user', '/system/role']);
  });

  it('悬停展开模式下鼠标移入不改变附加菜单', /** 悬停展开模式已由选择事件维护内容，重复写入会造成闪烁。 */ async () => {
    preferencesProbe.preferences.sidebar.expandOnHover = true;
    const { extra } = await mountExtraMenu({ path: '/system/user' });
    const before = [...extra.extraMenus.value];

    extra.handleMenuMouseEnter(MENUS[0] as MenuRecordRaw);

    expect(extra.extraMenus.value).toEqual(before);
  });

  it('鼠标移出时按当前路由恢复附加菜单', /** 未恢复会让鼠标移出后附加菜单停留在临时悬停的分组。 */ async () => {
    const { extra } = await mountExtraMenu({ path: '/system/user' });
    extra.handleMenuMouseEnter(MENUS[0] as MenuRecordRaw);

    extra.handleSideMouseLeave();

    expect(extra.extraActiveMenu.value).toBe('/system');
    expect(
      extra.extraMenus.value.map(
        /** 取出子菜单路径，核对按当前路由恢复的结果。 */ (menu) => menu.path,
      ),
    ).toEqual(['/system/user', '/system/role']);
  });

  it('悬停展开模式下鼠标移出不改变附加菜单', /** 误清空会让悬停展开的附加菜单在鼠标移出时立即消失。 */ async () => {
    preferencesProbe.preferences.sidebar.expandOnHover = true;
    const { extra } = await mountExtraMenu({ path: '/system/user' });
    const before = [...extra.extraMenus.value];

    extra.handleSideMouseLeave();

    expect(extra.extraMenus.value).toEqual(before);
  });

  it('当前路由不在菜单下时鼠标移出清空附加菜单', /** 未清空会让用户离开业务页面后仍看到上一个分组的子菜单。 */ async () => {
    const { extra } = await mountExtraMenu({ path: '/external' });
    extra.handleMenuMouseEnter(MENUS[1] as MenuRecordRaw);
    expect(extra.extraMenus.value).toHaveLength(2);

    extra.handleSideMouseLeave();

    expect(extra.extraActiveMenu.value).toBe('');
    expect(extra.extraMenus.value).toEqual([]);
  });
});
