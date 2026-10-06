/**
 * 偏好设置的只读视图：把管理器状态派生为组件常用的 computed 字段。
 * 覆盖暗黑判断、布局模式、语言、是否移动端、标签页缓存与偏好按钮位置等；
 * 只读不写，修改偏好仍需调用 preferencesManager 暴露的更新方法。
 */
import { computed } from 'vue';

import { diff } from '@vben-core/shared/utils';

import { preferencesManager } from './preferences';
import { isDarkTheme } from './update-css-variables';

/**
 * 生成偏好设置的只读派生视图：一次性抓取管理器的当前与初始快照，再暴露一组 computed。
 * 返回对象不提供写入方法，修改偏好仍需调用 preferencesManager 的更新方法。
 * @returns 组件可直接解构使用的 computed 集合，闭包持有的是抓取时刻的偏好对象引用。
 */
function usePreferences() {
  const preferences = preferencesManager.getPreferences();
  const initialPreferences = preferencesManager.getInitialPreferences();
  /**
   * 当前偏好相对初始偏好的差异对象，用于判断哪些偏好被用户改过。
   * @zh_CN 计算偏好设置的变化
   */
  const diffPreference = computed(() => {
    return diff(initialPreferences, preferences);
  });

  /** 应用级偏好：布局、语言、是否移动端、登录页布局与偏好按钮位置等。 */
  const appPreferences = computed(() => preferences.app);

  /** 快捷键偏好：总开关与各全局功能的独立开关。 */
  const shortcutKeysPreferences = computed(() => preferences.shortcutKeys);

  /**
   * 当前主题是否应使用暗色：判断依据是闭包中 preferences.theme.mode 的取值。
   * @zh_CN 判断是否为暗黑模式
   * @param  preferences - 当前偏好设置对象，它的主题值将被用来判断是否为暗黑模式。
   * @returns 如果主题为暗黑模式，返回 true，否则返回 false。
   */
  const isDark = computed(() => {
    return isDarkTheme(preferences.theme.mode);
  });

  /** 当前界面语言标识。 */
  const locale = computed(() => {
    return preferences.app.locale;
  });

  /** 当前是否按移动端渲染，取自 app 偏好中的 isMobile。 */
  const isMobile = computed(() => {
    return appPreferences.value.isMobile;
  });

  /** 当前主题名：暗色为 'dark'，否则为 'light'；'auto' 已由 isDark 解析。 */
  const theme = computed(() => {
    return isDark.value ? 'dark' : 'light';
  });

  /**
   * 实际生效的布局：移动端固定为 'sidebar-nav'，桌面端取 app 偏好里的 layout。
   * @zh_CN 布局方式
   */
  const layout = computed(() =>
    isMobile.value ? 'sidebar-nav' : appPreferences.value.layout,
  );

  /**
   * 是否显示顶栏，取自 header.enable。
   * @zh_CN 是否显示顶栏
   */
  const isShowHeaderNav = computed(() => {
    return preferences.header.enable;
  });

  /**
   * 是否为全屏内容布局：layout 为 'full-content' 时不渲染侧边、顶部、底部与标签栏。
   * @zh_CN 是否全屏显示content，不需要侧边、底部、顶部、tab区域
   */
  const isFullContent = computed(
    () => appPreferences.value.layout === 'full-content',
  );

  /**
   * 是否为侧边导航布局（layout === 'sidebar-nav'）。
   * @zh_CN 是否侧边导航模式
   */
  const isSideNav = computed(
    () => appPreferences.value.layout === 'sidebar-nav',
  );

  /**
   * 是否为侧边混合导航布局（layout === 'sidebar-mixed-nav'）。
   * @zh_CN 是否侧边混合模式
   */
  const isSideMixedNav = computed(
    () => appPreferences.value.layout === 'sidebar-mixed-nav',
  );

  /**
   * 是否为顶部导航布局（layout === 'header-nav'）。
   * @zh_CN 是否为头部导航模式
   */
  const isHeaderNav = computed(
    () => appPreferences.value.layout === 'header-nav',
  );

  /**
   * 是否为顶部混合导航布局（layout === 'header-mixed-nav'）。
   * @zh_CN 是否为头部混合导航模式
   */
  const isHeaderMixedNav = computed(
    () => appPreferences.value.layout === 'header-mixed-nav',
  );

  /**
   * 是否为顶部通栏加侧边导航布局（layout === 'header-sidebar-nav'）。
   * @zh_CN 是否为顶部通栏+侧边导航模式
   */
  const isHeaderSidebarNav = computed(
    () => appPreferences.value.layout === 'header-sidebar-nav',
  );

  /**
   * 是否为混合导航布局（layout === 'mixed-nav'）。
   * @zh_CN 是否为混合导航模式
   */
  const isMixedNav = computed(
    () => appPreferences.value.layout === 'mixed-nav',
  );

  /**
   * 是否包含侧边导航区域：混合、侧边混合、纯侧边、顶部混合、顶部通栏加侧边五种布局之一。
   * @zh_CN 是否包含侧边导航模式
   */
  const isSideMode = computed(() => {
    return (
      isMixedNav.value ||
      isSideMixedNav.value ||
      isSideNav.value ||
      isHeaderMixedNav.value ||
      isHeaderSidebarNav.value
    );
  });

  /** 侧边栏是否处于收起状态。 */
  const sidebarCollapsed = computed(() => {
    return preferences.sidebar.collapsed;
  });

  /**
   * @zh_CN 是否开启keep-alive
   * 在tabs可见以及开启keep-alive的情况下才开启
   */
  const keepAlive = computed(
    () => preferences.tabbar.enable && preferences.tabbar.keepAlive,
  );

  /**
   * 登录/注册页是否采用左侧面板布局（authPageLayout === 'panel-left'）。
   * @zh_CN 登录注册页面布局是否为左侧
   */
  const authPanelLeft = computed(() => {
    return appPreferences.value.authPageLayout === 'panel-left';
  });

  /**
   * 登录/注册页是否采用右侧面板布局（authPageLayout === 'panel-right'）。
   * @zh_CN 登录注册页面布局是否为右侧
   */
  const authPanelRight = computed(() => {
    return appPreferences.value.authPageLayout === 'panel-right';
  });

  /**
   * 登录/注册页是否采用居中布局（authPageLayout === 'panel-center'）。
   * @zh_CN 登录注册页面布局是否为中间
   */
  const authPanelCenter = computed(() => {
    return appPreferences.value.authPageLayout === 'panel-center';
  });

  /**
   * @zh_CN 内容是否已经最大化
   * 排除 full-content模式
   */
  const contentIsMaximize = computed(() => {
    const headerIsHidden = preferences.header.hidden;
    const sidebarIsHidden = preferences.sidebar.hidden;
    return headerIsHidden && sidebarIsHidden && !isFullContent.value;
  });

  /**
   * 全局搜索快捷键是否可用：需要快捷键总开关与 globalSearch 同时开启。
   * @zh_CN 是否启用全局搜索快捷键
   */
  const globalSearchShortcutKey = computed(() => {
    const { enable, globalSearch } = shortcutKeysPreferences.value;
    return enable && globalSearch;
  });

  /**
   * 全局注销快捷键是否可用：需要总开关与 globalLogout 同时开启。
   * @zh_CN 是否启用全局注销快捷键
   */
  const globalLogoutShortcutKey = computed(() => {
    const { enable, globalLogout } = shortcutKeysPreferences.value;
    return enable && globalLogout;
  });

  /** 全局锁屏快捷键是否可用：需要总开关与 globalLockScreen 同时开启。 */
  const globalLockScreenShortcutKey = computed(() => {
    const { enable, globalLockScreen } = shortcutKeysPreferences.value;
    return enable && globalLockScreen;
  });

  /**
   * 偏好设置按钮的落位：未启用按钮时两项都为 false；指定 header/fixed 时按指定值返回；
   * 为 auto 时在内容最大化、全屏布局、移动端或没有顶栏的情况下改为浮层显示。
   * @zh_CN 偏好设置按钮位置
   * @returns fixed 表示渲染成浮动按钮，header 表示放进顶栏，两者可能同时为 false。
   */
  const preferencesButtonPosition = computed(() => {
    const { enablePreferences, preferencesButtonPosition } = preferences.app;

    // 如果没有启用偏好设置按钮
    if (!enablePreferences) {
      return {
        fixed: false,
        header: false,
      };
    }

    const { header, sidebar } = preferences;
    const headerHidden = header.hidden;
    const sidebarHidden = sidebar.hidden;

    const contentIsMaximize = headerHidden && sidebarHidden;

    const isHeaderPosition = preferencesButtonPosition === 'header';

    // 如果设置了固定位置
    if (preferencesButtonPosition !== 'auto') {
      return {
        fixed: preferencesButtonPosition === 'fixed',
        header: isHeaderPosition,
      };
    }

    // 如果是全屏模式或者没有固定在顶部，
    const fixed =
      contentIsMaximize ||
      isFullContent.value ||
      isMobile.value ||
      !isShowHeaderNav.value;

    return {
      fixed,
      header: !fixed,
    };
  });

  return {
    authPanelCenter,
    authPanelLeft,
    authPanelRight,
    contentIsMaximize,
    diffPreference,
    globalLockScreenShortcutKey,
    globalLogoutShortcutKey,
    globalSearchShortcutKey,
    isDark,
    isFullContent,
    isHeaderMixedNav,
    isHeaderNav,
    isHeaderSidebarNav,
    isMixedNav,
    isMobile,
    isSideMixedNav,
    isSideMode,
    isSideNav,
    keepAlive,
    layout,
    locale,
    preferencesButtonPosition,
    sidebarCollapsed,
    theme,
  };
}

export { usePreferences };
