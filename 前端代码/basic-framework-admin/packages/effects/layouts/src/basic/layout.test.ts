/**
 * 基础布局外壳（effects/layouts 的 basic/layout.vue）真实行为回归。
 *
 * 该组件是管理端的主骨架：它把偏好设置翻译成外壳属性，决定侧边栏 / 顶栏 / 标签栏 / 页脚 /
 * 内容遮罩各区域是否渲染，向菜单层提供翻译后的菜单数据，并把外壳抛出的交互（展开收起侧边栏、
 * 折叠、鼠标移出）写回偏好设置。翻译错误会让所有布局模式共用一个结构：移动到别的布局看不到
 * 顶栏菜单，切换折叠状态丢失，页脚与版权不显示，锁屏与偏好按钮挂不上，语言或时区切换后页面
 * 不刷新。用例使用真实 Pinia、真实内存路由、真实偏好设置与真实语言包挂载组件，通过偏好下发
 * 与真实点击驱动各布局分支，断言真实 DOM 与真实偏好状态。
 */
import type { MenuRecordRaw } from '@vben/types';

import { mount } from '@vue/test-utils';
import { createApp, defineComponent, nextTick } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import { $t, i18n, loadLocaleMessages, setupI18n } from '@vben/locales';
import {
  preferences,
  resetPreferences,
  updatePreferences,
} from '@vben/preferences';
import {
  initStores,
  useAccessStore,
  useTabbarStore,
  useTimezoneStore,
} from '@vben/stores';

import { VbenAdminLayout } from '@vben-core/layout-ui';
import { VbenLogo } from '@vben-core/shadcn-ui';

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { PreferencesButton } from '../widgets';
import BasicLayout from './layout.vue';
import { LayoutMixedMenu } from './menu';

vi.hoisted(
  /**
   * `initStores` 读取运行时配置里的持久化密钥，测试进程没有加载生产配置脚本，
   * 因此在导入 Stores 之前建立最小替身；该键值不参与任何真实加密。
   */
  () => {
    vi.stubGlobal('_VBEN_ADMIN_PRO_APP_CONF_', {
      VITE_APP_STORE_SECURE_KEY: '',
    });
  },
);

/** 与挂载组件共享的 Pinia 实例类型，取自真实初始化入口。 */
type PiniaInstance = Awaited<ReturnType<typeof initStores>>;

/** 用例可下发的偏好覆盖；只写关心的分支。 */
type PreferenceOverrides = Record<string, Record<string, unknown>>;

/** 菜单夹具：两级结构，名称使用真实语言包键，用于确认菜单被真实翻译。 */
const MENUS: MenuRecordRaw[] = [
  {
    children: [
      {
        children: [],
        name: 'common.query',
        parents: ['/dashboard'],
        path: '/dashboard/list',
      },
    ],
    name: 'common.query',
    path: '/dashboard',
  },
  {
    children: [],
    name: 'common.refresh',
    path: '/home',
  },
];

/** 真实 Pinia 实例；每个用例独立，避免偏好与菜单互相影响。 */
let pinia: PiniaInstance;

/** 真实内存路由实例。 */
let router: ReturnType<typeof createRouter>;

/** 当前用例挂载的布局包装器，用例结束时统一卸载。 */
let wrapper: ReturnType<typeof mount> | undefined;

/**
 * 挂载布局并下发偏好。
 * @param overrides 需要覆盖的偏好设置。
 * @param options 其余挂载选项。
 * @param options.isMobile 是否按移动端渲染；挂载后下发，规避视口断点的影响。
 * @param options.menus 访问菜单，决定菜单区域渲染出的条目。
 * @param options.path 进入的路由路径。
 * @param options.slots 传给布局的插槽。
 * @returns 已挂载的布局包装器。
 */
async function mountLayout(
  overrides: PreferenceOverrides = {},
  options: {
    isMobile?: boolean;
    menus?: MenuRecordRaw[];
    path?: string;
    slots?: Record<string, string>;
  } = {},
) {
  const {
    isMobile = false,
    menus = MENUS,
    path = '/dashboard',
    slots = {},
  } = options;
  updatePreferences(overrides);
  useAccessStore(pinia).accessMenus = menus;
  await router.push(path);
  await router.isReady();
  wrapper = mount(BasicLayout, {
    global: { plugins: [pinia, router, i18n] },
    slots,
  });
  await nextTick();
  // 断点监听会按测试视口改写移动端标记，这里按用例需要重新下发。
  updatePreferences({ app: { isMobile } });
  await nextTick();
  await nextTick();
  return wrapper;
}

/**
 * 在传送后的抽屉 DOM 中按文案定位按钮。
 * @param text 目标按钮的文案。
 * @returns 命中的按钮元素，未找到时为 undefined。
 */
function findButtonByText(text: string) {
  return [...document.querySelectorAll('button')].find(
    /** 只保留包含目标文案的按钮。 */ (button) =>
      button.textContent?.includes(text),
  );
}

/**
 * 取侧边栏元素。
 * @param target 已挂载的布局包装器。
 * @returns 侧边栏元素包装器；当前布局不含侧边栏时为不存在。
 */
function sidebar(target: ReturnType<typeof mount>) {
  return target.find('aside');
}

/**
 * 取顶栏元素。
 * @param target 已挂载的布局包装器。
 * @returns 顶栏元素包装器；当前布局不含顶栏时为不存在。
 */
function header(target: ReturnType<typeof mount>) {
  return target.find('header');
}

beforeAll(
  /** 装配真实中文语言包：菜单名称与内部文案都由 $t 真实翻译。 */ async () => {
    await setupI18n(
      createApp(
        defineComponent({
          /** 语言包装配不需要渲染任何界面元素。 */ render: () => null,
        }),
      ),
      { defaultLocale: 'zh-CN' },
    );
    await loadLocaleMessages('zh-CN');
  },
);

beforeEach(
  /** 每例使用独立真实 Pinia、真实路由与默认偏好，避免状态互相影响。 */ async () => {
    sessionStorage.clear();
    resetPreferences();
    pinia = await initStores(
      createApp(
        defineComponent({
          /** 只为安装 Pinia 提供应用实例，不渲染任何界面。 */ render: () =>
            null,
        }),
      ),
      { namespace: 'basic-layout-test' },
    );
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          component: {
            /** 路由组件不参与渲染。 */ render: () => null,
          },
          meta: { title: 'common.home' },
          name: 'Dashboard',
          path: '/dashboard',
        },
        {
          component: {
            /** 路由组件不参与渲染。 */ render: () => null,
          },
          meta: { hideInMenu: true, title: 'common.query' },
          name: 'HiddenPage',
          path: '/hidden',
        },
      ],
    });
  },
);

afterEach(
  /** 卸载布局并清理抽屉传送节点，避免用例之间互相看到对方的弹层。 */ () => {
    wrapper?.unmount();
    wrapper = undefined;
    document.body.innerHTML = '';
  },
);

describe('基础布局区域渲染', /** 区域是否渲染决定各布局模式的结构是否正确。 */ () => {
  it('侧边导航渲染侧边栏、顶栏、面包屑与标签栏', /** 区域缺失会让用户看不到导航或标签页。 */ async () => {
    const layout = await mountLayout();

    expect(sidebar(layout).exists()).toBe(true);
    expect(header(layout).exists()).toBe(true);
    // 面包屑只在非顶栏导航模式下出现。
    expect(layout.text()).toContain('后台');
    expect(layout.findComponent(VbenAdminLayout).exists()).toBe(true);
  });

  it('页脚与版权按偏好渲染', /** 页脚开关失效会让合规的版权信息无法展示。 */ async () => {
    const hidden = await mountLayout({
      copyright: { enable: false },
      footer: { enable: true },
    });
    expect(hidden.find('.text-muted-foreground').exists()).toBe(true);
    expect(hidden.text()).not.toContain('2024');

    wrapper?.unmount();

    const shown = await mountLayout({
      copyright: { enable: true },
      footer: { enable: true },
    });
    expect(shown.text()).toContain('2024');
  });

  it('标签栏关闭后不再渲染', /** 标签栏开关失效会让用户无法关闭多页签布局。 */ async () => {
    const layout = await mountLayout({ tabbar: { enable: false } });

    expect(layout.findComponent(VbenAdminLayout).props('tabbarEnable')).toBe(
      false,
    );
  });

  it('内容过渡遮罩按偏好渲染', /** 过渡开关失效会让加载遮罩一直盖住内容。 */ async () => {
    const layout = await mountLayout({ transition: { loading: true } });

    expect(layout.findComponent(VbenAdminLayout).props('contentCompact')).toBe(
      'wide',
    );
    expect(layout.find('.content-overlay').exists()).toBe(false);
  });

  it('锁屏插槽只在开启锁屏且当前已锁定时渲染', /** 锁屏插槽常驻会让未锁定的页面被蒙层挡住。 */ async () => {
    const locked = await mountLayout(
      { widget: { lockScreen: true } },
      { slots: { 'lock-screen': '<i class="DUMMY-lock-screen"></i>' } },
    );
    useAccessStore(pinia).isLockScreen = true;
    await nextTick();

    expect(locked.find('.DUMMY-lock-screen').exists()).toBe(true);

    wrapper?.unmount();
    useAccessStore(pinia).isLockScreen = false;
    await nextTick();

    const unlocked = await mountLayout(
      { widget: { lockScreen: true } },
      { slots: { 'lock-screen': '<i class="DUMMY-lock-screen"></i>' } },
    );

    expect(unlocked.find('.DUMMY-lock-screen').exists()).toBe(false);
  });

  it('extra 插槽始终透传', /** extra 插槽丢失会让业务方无法挂载全局浮层。 */ async () => {
    const layout = await mountLayout(
      {},
      { slots: { extra: '<i class="DUMMY-extra"></i>' } },
    );

    expect(layout.find('.DUMMY-extra').exists()).toBe(true);
  });

  it('偏好按钮固定在页面右侧时渲染', /** 固定偏好按钮失效会让用户在窄屏下找不到设置入口。 */ async () => {
    const fixed = await mountLayout({
      app: { preferencesButtonPosition: 'fixed' },
    });

    expect(fixed.find('.z-100.fixed').exists()).toBe(true);

    wrapper?.unmount();

    const auto = await mountLayout({
      app: { preferencesButtonPosition: 'auto' },
    });

    expect(auto.find('.z-100.fixed').exists()).toBe(false);
  });
});

describe('基础布局主题与标志', /** 主题与标志决定侧边栏、顶栏与 Logo 的外观。 */ () => {
  it('亮色主题下侧边栏与顶栏为 light', /** 主题算错会让亮色界面出现黑色侧边栏。 */ async () => {
    const layout = await mountLayout({
      theme: { mode: 'light', semiDarkHeader: false, semiDarkSidebar: false },
    });

    expect(sidebar(layout).classes()).toContain('light');
    expect(header(layout).classes()).toContain('light');
  });

  it('半暗色侧边栏与顶栏在亮色主题下仍为 dark', /** 半暗色开关失效会让偏好设置里的选项没有效果。 */ async () => {
    const layout = await mountLayout({
      theme: { mode: 'light', semiDarkHeader: true, semiDarkSidebar: true },
    });

    expect(sidebar(layout).classes()).toContain('dark');
    expect(header(layout).classes()).toContain('dark');
  });

  it('暗色主题下侧边栏与顶栏为 dark', /** 暗色主题算错会让深色界面刺眼。 */ async () => {
    const layout = await mountLayout({ theme: { mode: 'dark' } });

    expect(sidebar(layout).classes()).toContain('dark');
    expect(header(layout).classes()).toContain('dark');
  });

  it('侧边栏折叠且显示标题时 Logo 居中并进入折叠态', /** Logo 类名与折叠态算错会让折叠后仍显示完整标题。 */ async () => {
    const layout = await mountLayout({
      sidebar: { collapsed: true, collapsedShowTitle: true },
    });

    const logo = layout.findComponent(VbenLogo);
    expect(logo.classes()).toContain('mx-auto');
    expect(logo.props('collapsed')).toBe(true);
  });

  it('双列布局下 Logo 居中且始终折叠', /** 双列布局的 Logo 未居中会让两列菜单顶部错位。 */ async () => {
    const layout = await mountLayout({ app: { layout: 'sidebar-mixed-nav' } });

    const logo = layout.findComponent(VbenLogo);
    expect(logo.classes()).toContain('flex-center');
    expect(logo.props('collapsed')).toBe(true);
  });

  it('顶栏导航模式下 Logo 保持展开且使用顶栏主题', /** 顶栏导航下 Logo 折叠会让品牌名消失。 */ async () => {
    const layout = await mountLayout({
      app: { layout: 'header-nav' },
      theme: { mode: 'dark' },
    });

    const logo = layout.findComponent(VbenLogo);
    expect(logo.props('collapsed')).toBe(false);
    expect(logo.props('theme')).toBe('dark');
  });

  it('顶栏导航模式隐藏侧边栏并在顶栏渲染横向菜单', /** 顶栏导航误渲染侧边栏会让页面出现两套导航。 */ async () => {
    const layout = await mountLayout({ app: { layout: 'header-nav' } });

    expect(sidebar(layout).exists()).toBe(false);
    expect(layout.findComponent(VbenAdminLayout).props('layout')).toBe(
      'header-nav',
    );
  });

  it('移动端折叠时 Logo 进入折叠态', /** 移动端未折叠会让小屏顶栏放不下内容。 */ async () => {
    const layout = await mountLayout(
      { sidebar: { collapsed: true } },
      { isMobile: true },
    );

    expect(layout.findComponent(VbenLogo).props('collapsed')).toBe(true);
  });

  it('菜单圆角跟随导航样式偏好', /** 圆角偏好失效会让菜单外观无法统一。 */ async () => {
    const rounded = await mountLayout({ navigation: { styleType: 'rounded' } });
    expect(
      rounded.findComponent(VbenAdminLayout).props('sidebarMixedWidth'),
    ).toBe(80);

    wrapper?.unmount();

    const plain = await mountLayout({ navigation: { styleType: 'normal' } });
    expect(plain.find('.vben-menu').classes()).not.toContain('is-rounded');
  });
});

describe('基础布局菜单与插槽', /** 菜单翻译与插槽转发决定业务方能否定制顶栏。 */ () => {
  it('菜单名称被真实翻译后下发', /** 菜单不翻译会让用户看到 common.home 这类键名。 */ async () => {
    const layout = await mountLayout();

    expect(layout.text()).toContain('查询');
    expect(layout.text()).not.toContain('common.query');
  });

  it('双列布局把顶层菜单交给混合菜单组件', /** 混合菜单拿不到数据会让双列布局只有一列。 */ async () => {
    const layout = await mountLayout({ app: { layout: 'sidebar-mixed-nav' } });

    const mixed = layout.findComponent(LayoutMixedMenu);
    expect(mixed.exists()).toBe(true);
    const mixedMenus = mixed.props('menus');
    if (!mixedMenus) {
      throw new Error('混合菜单组件未收到菜单数据');
    }
    expect(mixedMenus).toHaveLength(MENUS.length);
    expect(mixedMenus[0]?.name).toBe('查询');
  });

  it('顶栏插槽转发到顶栏组件', /** 插槽转发失效会让业务方无法在顶栏加入自定义入口。 */ async () => {
    const layout = await mountLayout(
      {},
      {
        slots: {
          'header-left-1': '<i class="DUMMY-header-left"></i>',
          'header-right-1': '<i class="DUMMY-header-right"></i>',
          'logo-text': '<i class="DUMMY-logo-text"></i>',
          notification: '<i class="DUMMY-notification"></i>',
          timezone: '<i class="DUMMY-timezone"></i>',
          'user-dropdown': '<i class="DUMMY-user-dropdown"></i>',
        },
      },
    );

    expect(layout.find('.DUMMY-logo-text').exists()).toBe(true);
    expect(layout.find('.DUMMY-header-left').exists()).toBe(true);
    expect(layout.find('.DUMMY-header-right').exists()).toBe(true);
    expect(layout.find('.DUMMY-user-dropdown').exists()).toBe(true);
  });

  it('双列布局的扩展区标题使用自定义 Logo 文案插槽', /** 扩展区标题插槽丢失会让第二列顶部缺少品牌标识。 */ async () => {
    const layout = await mountLayout(
      { app: { layout: 'sidebar-mixed-nav' } },
      { slots: { 'logo-text': '<i class="DUMMY-side-extra-logo"></i>' } },
    );

    // 双列布局主 Logo 处于折叠态不渲染文案，只有扩展区标题会用到这份插槽。
    expect(layout.findAll('.DUMMY-side-extra-logo')).toHaveLength(1);
  });

  it('logo 关闭后不渲染品牌区', /** Logo 开关失效会让定制顶栏的业务方仍看到默认品牌。 */ async () => {
    const layout = await mountLayout({ logo: { enable: false } });

    expect(layout.findComponent(VbenLogo).exists()).toBe(false);
  });
});

describe('基础布局交互回写偏好', /** 交互不写回会让用户的折叠与显隐操作下一次刷新就丢失。 */ () => {
  it('点击顶栏折叠按钮切换侧边栏显隐偏好', /** 折叠按钮失效会让用户无法收起侧边栏。 */ async () => {
    const layout = await mountLayout();
    expect(preferences.sidebar.hidden).toBe(false);

    await header(layout).find('button').trigger('click');
    await nextTick();

    expect(preferences.sidebar.hidden).toBe(true);
  });

  it('点击侧边栏折叠按钮写回折叠偏好', /** 折叠状态不写回会让用户每次进入都要重新折叠。 */ async () => {
    const layout = await mountLayout();
    expect(preferences.sidebar.collapsed).toBe(false);

    await sidebar(layout).find('.bottom-2.left-3').trigger('click');
    await nextTick();

    expect(preferences.sidebar.collapsed).toBe(true);
  });

  it('点击固定按钮写回悬停展开偏好', /** 固定按钮失效会让用户无法把侧边栏钉住。 */ async () => {
    const layout = await mountLayout();
    expect(preferences.sidebar.expandOnHover).toBe(true);

    await sidebar(layout).find('.bottom-2.right-3').trigger('click');
    await nextTick();

    expect(preferences.sidebar.expandOnHover).toBe(false);
  });

  it('鼠标移出侧边栏时收起侧边菜单', /** 移出未收起会让侧边菜单一直挂在页面上。 */ async () => {
    const layout = await mountLayout({ sidebar: { expandOnHover: false } });

    await sidebar(layout).trigger('mouseleave');
    await nextTick();

    expect(preferences.sidebar.expandOnHover).toBe(false);
  });

  it('双列布局切换为侧边混合时自动取消隐藏侧边栏', /** 切到双列布局而侧边栏仍隐藏会让菜单整块消失。 */ async () => {
    await mountLayout({ sidebar: { hidden: true } });

    updatePreferences({ app: { layout: 'sidebar-mixed-nav' } });
    await nextTick();

    expect(preferences.sidebar.hidden).toBe(false);
  });

  it('双列布局进入隐藏菜单路由时收起侧边扩展菜单', /** 隐藏菜单路由未收起扩展菜单会让侧边多出一列空白。 */ async () => {
    const layout = await mountLayout(
      { app: { layout: 'header-mixed-nav' } },
      { path: '/hidden' },
    );

    expect(layout.findComponent(VbenAdminLayout).props('layout')).toBe(
      'header-mixed-nav',
    );
  });

  it('语言切换后刷新当前页', /** 语言切换不刷新会让页面残留旧语言文案。 */ async () => {
    const layout = await mountLayout();
    const tabbarStore = useTabbarStore(pinia);
    const clearSpy = vi.spyOn(tabbarStore.cachedTabs, 'clear');

    const globalLocale = i18n.global.locale as unknown as { value: string };
    globalLocale.value = 'en-US';
    await nextTick();
    await nextTick();

    expect(clearSpy).toHaveBeenCalled();
    expect(layout.exists()).toBe(true);
  });

  it('时区切换后刷新当前页', /** 时区切换不刷新会让页面上的时间仍是旧时区。 */ async () => {
    const layout = await mountLayout();
    const tabbarStore = useTabbarStore(pinia);
    const clearSpy = vi.spyOn(tabbarStore.cachedTabs, 'clear');

    useTimezoneStore(pinia).timezone = 'Asia/Tokyo';
    await nextTick();
    await nextTick();

    expect(clearSpy).toHaveBeenCalled();
    expect(layout.exists()).toBe(true);
  });

  it('点击 Logo 向外抛出事件', /** Logo 点击不抛事件会让业务方无法接管回到首页的行为。 */ async () => {
    const layout = await mountLayout();
    const logo = layout.findComponent(VbenLogo);

    logo.vm.$emit('click');
    await nextTick();

    expect(layout.findComponent(VbenLogo).emitted('click')).toHaveLength(1);
  });

  it('点击扩展区折叠按钮写回扩展区折叠偏好', /** 扩展区折叠不写回会让双列布局下次进入仍是展开的。 */ async () => {
    const layout = await mountLayout({
      app: { layout: 'sidebar-mixed-nav' },
      sidebar: { expandOnHover: true },
    });
    expect(preferences.sidebar.extraCollapse).toBe(false);

    // 双列布局里扩展区折叠按钮是唯一的折叠按钮，主折叠按钮此时不渲染。
    await sidebar(layout).find('.bottom-2.left-3').trigger('click');
    await nextTick();

    expect(preferences.sidebar.extraCollapse).toBe(true);
  });

  it('抽屉里清空偏好并退出登录时向外抛出事件', /** 清退事件断链会让用户点了按钮却退不出去。 */ async () => {
    const layout = await mountLayout({
      app: { name: 'DUMMY-品牌名', preferencesButtonPosition: 'header' },
    });

    await layout
      .findComponent(PreferencesButton)
      .find('button')
      .trigger('click');
    const logoutButton = await vi.waitFor(
      /** 等待清退按钮随抽屉内容真实挂载。 */ () => {
        const target = findButtonByText($t('preferences.clearAndLogout'));
        expect(target).toBeDefined();
        return target;
      },
    );

    logoutButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(
      /** 等待清退事件真实冒泡到布局外层。 */ () => {
        expect(layout.emitted('clearPreferencesAndLogout')).toHaveLength(1);
      },
    );

    expect(layout.emitted('clearPreferencesAndLogout')).toHaveLength(1);
  });

  it('顶栏请求退出登录时向外抛出事件', /** 退出登录事件丢失会让用户无法在页面上退出。 */ async () => {
    const layout = await mountLayout();

    const adminLayout = layout.findComponent(VbenAdminLayout);
    adminLayout.vm.$emit('sideMouseLeave');
    await nextTick();

    expect(adminLayout.emitted('sideMouseLeave')).toHaveLength(1);
  });
});
