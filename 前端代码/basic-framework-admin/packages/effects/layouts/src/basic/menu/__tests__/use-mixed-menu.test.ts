/**
 * 混合菜单拆分（layouts 的 basic/menu/use-mixed-menu）真实行为回归。
 *
 * 该 composable 决定顶栏与侧边栏各展示哪一层菜单、激活项落在哪个菜单，以及点击菜单后
 * 是直接跳转还是只切换侧边菜单：拆分模式漏清空头部菜单的子级会让顶栏出现下拉层级；
 * 侧边菜单为空时不隐藏侧边栏会留下一条空白栏；点击顶级菜单误跳转会让用户丢失当前页面；
 * 混合模式下不优先使用侧边菜单会让顶栏与侧边栏展示同一层；记忆子菜单写错会让用户
 * 每次都要重新点开同一分支；外链菜单参与计算会把侧边菜单清空。用例在真实 vue-router
 * 内存路由上调用真实 composable，只替换访问菜单来源与偏好配置边界。
 */
import type { MenuRecordRaw } from '@vben/types';

import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMixedMenu } from '../use-mixed-menu';

/** 访问菜单来源；模块替身与用例读取同一实例。 */
const storeProbe = vi.hoisted(
  /** 建立用例可替换的访问菜单容器。 */ () => ({
    accessMenus: [] as MenuRecordRaw[],
  }),
);

/** 偏好配置；模块替身与用例在挂载前设置这些取值。 */
const preferencesProbe = vi.hoisted(
  /** 建立可改写的偏好配置与布局标记容器。 */ () => ({
    /** 是否顶栏混合布局。 */
    isHeaderMixedNav: { value: false },
    /** 是否混合导航布局。 */
    isMixedNav: { value: false },
    /** 偏好配置内容，仅包含被测逻辑读取的字段。 */
    preferences: {
      navigation: { split: false },
      sidebar: { autoActivateChild: false, enable: true },
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
  /** 只替换布局标记与偏好配置来源，composable 自身的判断保持真实实现。 */ () => ({
    preferences: preferencesProbe.preferences,
    /** 返回用例设置的布局标记，替代真实偏好计算属性。 */
    usePreferences: () => ({
      isHeaderMixedNav: preferencesProbe.isHeaderMixedNav,
      isMixedNav: preferencesProbe.isMixedNav,
    }),
  }),
);

/**
 * 菜单夹具：三级结构，覆盖顶级菜单、二级菜单与更深一层的子菜单。
 * 每级 parents 声明本节点到顶级菜单的路径链，findRootMenuByPath 依赖它定位根菜单。
 */
const MENUS: MenuRecordRaw[] = [
  { children: [], name: 'Dashboard', path: '/dashboard' },
  {
    children: [
      {
        children: [
          {
            children: [],
            name: 'UserList',
            parents: ['/system', '/system/user'],
            path: '/system/user/list',
          },
        ],
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

/** 内存路由表：覆盖站内页面、激活路径别名与外链三种情况。 */
const ROUTES = [
  { component: { name: 'HomeView' }, name: 'Home', path: '/' },
  {
    component: { name: 'DashboardView' },
    name: 'Dashboard',
    path: '/dashboard',
  },
  { component: { name: 'SystemView' }, name: 'System', path: '/system' },
  { component: { name: 'UserView' }, name: 'User', path: '/system/user' },
  {
    component: { name: 'UserListView' },
    name: 'UserList',
    path: '/system/user/list',
  },
  { component: { name: 'RoleView' }, name: 'Role', path: '/system/role' },
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
 * @param path 初始路由路径，决定首次计算使用的路径。
 * @returns 已挂载的包装器、真实内存路由与 composable 返回值。
 * @throws Error 宿主组件未取得菜单能力时抛出，避免用例静默地什么都不验证。
 */
async function mountMixedMenu(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ROUTES,
  });
  await router.push(path);
  await router.isReady();

  const captured: { mixed?: ReturnType<typeof useMixedMenu> } = {};
  const Host = defineComponent({
    name: 'MixedMenuHost',
    /**
     * 取得被测 composable 的返回值并渲染占位节点。
     * @returns 渲染占位节点的渲染函数。
     */
    setup() {
      captured.mixed = useMixedMenu();
      return /** 渲染可定位节点，证明 setup 已在真实渲染中执行。 */ () =>
        h('div', { class: 'mixed-menu-host' });
    },
  });

  const wrapper = mount(Host, { global: { plugins: [router] } });
  await nextTick();
  const mixed = captured.mixed;
  if (!mixed) {
    throw new Error('宿主组件未取得菜单能力');
  }
  return { mixed, router, wrapper };
}

/**
 * 等待菜单点击或展开触发的真实路由跳转与响应式重算完成。
 */
async function flushNavigation() {
  await flushPromises();
  await nextTick();
}

/**
 * 取出菜单列表的路径序列，便于按层级核对。
 * @param menus 菜单列表。
 * @returns 各菜单的路径数组。
 */
function paths(menus: MenuRecordRaw[]) {
  return menus.map(/** 只取路径用于核对层级与顺序。 */ (menu) => menu.path);
}

beforeEach(
  /** 恢复默认偏好与菜单来源，避免上一例的拆分开关影响断言。 */ () => {
    vi.clearAllMocks();
    preferencesProbe.isHeaderMixedNav.value = false;
    preferencesProbe.isMixedNav.value = false;
    preferencesProbe.preferences.navigation.split = false;
    preferencesProbe.preferences.sidebar.autoActivateChild = false;
    preferencesProbe.preferences.sidebar.enable = true;
    storeProbe.accessMenus = MENUS;
  },
);

describe('菜单拆分与可见性', /** 拆分判定与可见性决定顶栏、侧边栏各展示哪一层。 */ () => {
  it('未开启拆分时头部与侧边共用完整菜单', /** 误拆分会让顶栏只剩顶级菜单，用户找不到子页面。 */ async () => {
    const { mixed } = await mountMixedMenu('/system/user/list');

    expect(mixed.headerMenus.value).toBe(MENUS);
    expect(mixed.sidebarMenus.value).toBe(MENUS);
    expect(mixed.mixHeaderMenus.value).toBe(MENUS);
    expect(mixed.sidebarVisible.value).toBe(true);
  });

  it('拆分模式只把顶级菜单交给头部菜单', /** 头部菜单保留子级会让顶栏出现下拉层级，与侧边栏重复。 */ async () => {
    preferencesProbe.preferences.navigation.split = true;
    preferencesProbe.isMixedNav.value = true;
    const { mixed } = await mountMixedMenu('/system/user/list');

    expect(mixed.headerMenus.value).toHaveLength(MENUS.length);
    expect(
      mixed.headerMenus.value.every(
        /** 拆分后的头部菜单必须是没有子级的顶级入口。 */ (menu) =>
          Array.isArray(menu.children) && menu.children.length === 0,
      ),
    ).toBe(true);
    // 头部菜单是副本，不能改写访问菜单本身的层级。
    expect(MENUS[1]?.children).toHaveLength(2);
    expect(paths(mixed.sidebarMenus.value)).toEqual([
      '/system/user',
      '/system/role',
    ]);
  });

  it('顶栏混合模式优先使用侧边菜单作为头部菜单', /** 顶栏混合模式下用顶级菜单会让当前分支的子菜单无处可点。 */ async () => {
    preferencesProbe.isHeaderMixedNav.value = true;
    const { mixed } = await mountMixedMenu('/system/user/list');

    expect(mixed.mixHeaderMenus.value).toBe(mixed.sidebarMenus.value);
  });

  it('拆分后侧边菜单为空时隐藏侧边栏', /** 空侧边栏仍占位会挤压内容区并让用户误以为菜单丢失。 */ async () => {
    preferencesProbe.preferences.navigation.split = true;
    preferencesProbe.isMixedNav.value = true;
    const { mixed } = await mountMixedMenu('/dashboard');

    expect(mixed.sidebarMenus.value).toEqual([]);
    expect(mixed.sidebarVisible.value).toBe(false);
  });

  it('关闭侧边栏开关时不显示侧边栏', /** 忽略开关会让偏好设置中的隐藏侧边栏失效。 */ async () => {
    preferencesProbe.preferences.sidebar.enable = false;
    const { mixed } = await mountMixedMenu('/dashboard');

    expect(mixed.sidebarVisible.value).toBe(false);
  });

  it('按三级菜单计算混合根菜单与附加菜单', /** 附加菜单取错层级会让深一层的子菜单无法展示。 */ async () => {
    preferencesProbe.preferences.navigation.split = true;
    preferencesProbe.isMixedNav.value = true;
    const { mixed } = await mountMixedMenu('/system/user/list');

    expect(paths(mixed.mixExtraMenus.value)).toEqual(['/system/user/list']);
    expect(mixed.headerActive.value).toBe('/system');
  });
});

describe('激活路径', /** 激活项算错会让菜单高亮落在错误的入口上。 */ () => {
  it('侧边菜单激活路径优先使用路由声明的别名', /** 忽略激活别名会让带详情页的路由高亮丢失。 */ async () => {
    const { mixed } = await mountMixedMenu('/alias');

    expect(mixed.sidebarActive.value).toBe('/system/user');
  });

  it('侧边菜单激活路径在没有别名时使用路由自身路径', /** 缺少兜底会让激活路径变成 undefined，菜单全不高亮。 */ async () => {
    const { mixed } = await mountMixedMenu('/system/role');

    expect(mixed.sidebarActive.value).toBe('/system/role');
  });

  it('未拆分时头部激活路径使用路由路径，拆分时使用根菜单路径', /** 拆分后仍用路由路径会让顶栏高亮落在二级菜单上。 */ async () => {
    const plain = await mountMixedMenu('/system/user');
    expect(plain.mixed.headerActive.value).toBe('/system/user');

    preferencesProbe.preferences.navigation.split = true;
    preferencesProbe.isMixedNav.value = true;
    const split = await mountMixedMenu('/system/user');
    expect(split.mixed.headerActive.value).toBe('/system');
  });

  it('挂载前按激活别名初始化侧边菜单', /** 初始化漏掉别名会让首屏侧边菜单停留在错误分支。 */ async () => {
    preferencesProbe.preferences.navigation.split = true;
    preferencesProbe.isMixedNav.value = true;
    const { mixed } = await mountMixedMenu('/alias');

    expect(paths(mixed.sidebarMenus.value)).toEqual([
      '/system/user',
      '/system/role',
    ]);
  });
});

describe('菜单点击', /** 点击行为决定用户是否会丢失当前页面或被送到错误分支。 */ () => {
  it('未拆分时点击菜单直接跳转', /** 不跳转会让菜单点击看起来失效。 */ async () => {
    const { mixed, router } = await mountMixedMenu('/dashboard');

    mixed.handleMenuSelect('/system/user');
    await flushNavigation();

    expect(router.currentRoute.value.path).toBe('/system/user');
    expect(mixed.sidebarActive.value).toBe('/system/user');
  });

  it('拆分布局下垂直模式仍然直接跳转', /** 垂直模式误判会让侧边菜单点击只切换而不跳转。 */ async () => {
    preferencesProbe.preferences.navigation.split = true;
    preferencesProbe.isMixedNav.value = true;
    const { mixed, router } = await mountMixedMenu('/dashboard');

    mixed.handleMenuSelect('/system/role', 'vertical');
    await flushNavigation();

    expect(router.currentRoute.value.path).toBe('/system/role');
  });

  it('拆分时点击有子菜单的顶级菜单只切换侧边菜单', /** 误跳转会让用户离开当前页面却看不到想看的分支。 */ async () => {
    preferencesProbe.preferences.navigation.split = true;
    preferencesProbe.isMixedNav.value = true;
    const { mixed, router } = await mountMixedMenu('/dashboard');

    mixed.handleMenuSelect('/system');
    await flushNavigation();

    expect(router.currentRoute.value.path).toBe('/dashboard');
    expect(paths(mixed.sidebarMenus.value)).toEqual([
      '/system/user',
      '/system/role',
    ]);
    expect(mixed.headerActive.value).toBe('/system');
  });

  it('拆分时点击没有子菜单的菜单直接跳转', /** 叶子菜单不跳转会让用户无法进入该页面。 */ async () => {
    preferencesProbe.preferences.navigation.split = true;
    preferencesProbe.isMixedNav.value = true;
    const { mixed, router } = await mountMixedMenu('/system/user/list');

    mixed.handleMenuSelect('/system/role');
    await flushNavigation();

    expect(router.currentRoute.value.path).toBe('/system/role');
  });

  it('开启自动激活后跳到记忆中的子菜单', /** 不记忆会让用户每次点击顶级菜单都被送到默认入口。 */ async () => {
    preferencesProbe.preferences.navigation.split = true;
    preferencesProbe.preferences.sidebar.autoActivateChild = true;
    preferencesProbe.isMixedNav.value = true;
    const { mixed, router } = await mountMixedMenu('/system/user/list');

    await router.push('/dashboard');
    await flushNavigation();
    mixed.handleMenuSelect('/system');
    await flushNavigation();

    expect(router.currentRoute.value.path).toBe('/system/user/list');
  });

  it('没有记忆子菜单时跳到顶级菜单自身', /** 空记忆表仍取子菜单会跳到空路径。 */ async () => {
    preferencesProbe.preferences.navigation.split = true;
    preferencesProbe.preferences.sidebar.autoActivateChild = true;
    preferencesProbe.isMixedNav.value = true;
    const { mixed, router } = await mountMixedMenu('/dashboard');

    mixed.handleMenuSelect('/system');
    await flushNavigation();

    expect(router.currentRoute.value.path).toBe('/system');
  });

  it('外链菜单不参与侧边菜单计算', /** 把外链当成站内路由会把侧边菜单清空并让顶栏失去高亮。 */ async () => {
    preferencesProbe.preferences.navigation.split = true;
    preferencesProbe.isMixedNav.value = true;
    const { mixed, router } = await mountMixedMenu('/system/user/list');

    await router.push('/external');
    await flushNavigation();

    expect(paths(mixed.sidebarMenus.value)).toEqual([
      '/system/user',
      '/system/role',
    ]);
    expect(mixed.headerActive.value).toBe('/system');
  });
});

describe('侧边菜单展开', /** 展开事件的自动激活决定用户展开分支后的落点。 */ () => {
  it('顶层展开时跳到记忆中的子菜单', /** 展开不跳转会让自动激活子菜单的偏好形同虚设。 */ async () => {
    preferencesProbe.preferences.navigation.split = true;
    preferencesProbe.preferences.sidebar.autoActivateChild = true;
    preferencesProbe.isMixedNav.value = true;
    const { mixed, router } = await mountMixedMenu('/system/user/list');

    await router.push('/dashboard');
    await flushNavigation();
    mixed.handleMenuOpen('/system', ['/system']);
    await flushNavigation();

    expect(router.currentRoute.value.path).toBe('/system/user/list');
  });

  it('未开启自动激活时展开不跳转', /** 忽略开关会在用户只想展开分支时强制跳页。 */ async () => {
    preferencesProbe.preferences.navigation.split = true;
    preferencesProbe.isMixedNav.value = true;
    const { mixed, router } = await mountMixedMenu('/dashboard');

    mixed.handleMenuOpen('/system', ['/system']);
    await flushNavigation();

    expect(router.currentRoute.value.path).toBe('/dashboard');
  });

  it('深层展开不触发自动激活', /** 深层展开误判会让用户在展开二级菜单时被强制跳转。 */ async () => {
    preferencesProbe.preferences.navigation.split = true;
    preferencesProbe.preferences.sidebar.autoActivateChild = true;
    preferencesProbe.isMixedNav.value = true;
    const { mixed, router } = await mountMixedMenu('/dashboard');

    mixed.handleMenuOpen('/system/user', ['/system', '/system/user']);
    await flushNavigation();

    expect(router.currentRoute.value.path).toBe('/dashboard');
  });
});
