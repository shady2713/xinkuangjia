/**
 * 偏好派生状态（usePreferences）的真实行为回归。
 *
 * 该模块导出的全部字段都是惰性 computed，只有被真实读取的字段才会执行计算。
 * 用例逐个读取并断言其取值，覆盖布局判定、侧边模式判定、快捷键开关与偏好按钮位置的全部取值组合，
 * 断言对象是当前偏好状态推导出的真实结果，不使用内部字段或镜像实现。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { preferencesManager } from '../src/preferences';
import { usePreferences } from '../src/use-preferences';

/** 用例开始前把偏好恢复到一组显式、互相独立的取值，避免上一个用例的写入影响判定。 */
function resetPreferences(): void {
  preferencesManager.resetPreferences();
}

describe('usePreferences 派生状态读取', /** 逐个读取派生字段并核对真实取值。 */ () => {
  beforeEach(
    /** 每个用例从默认偏好重新出发。 */ () => {
      resetPreferences();
    },
  );

  it('读取全部派生字段时返回当前偏好推导的真实值', /** 未读取的惰性字段不会计算，本用例一次性覆盖全部对外字段。 */ () => {
    preferencesManager.updatePreferences({
      app: {
        authPageLayout: 'panel-left',
        enablePreferences: true,
        isMobile: false,
        layout: 'sidebar-nav',
        locale: 'en-US',
        preferencesButtonPosition: 'auto',
      },
      header: { enable: true, hidden: false },
      shortcutKeys: {
        enable: true,
        globalLockScreen: true,
        globalLogout: false,
        globalSearch: true,
      },
      sidebar: { collapsed: true, hidden: false },
      tabbar: { enable: true, keepAlive: true },
      theme: { mode: 'dark' },
    });

    const preferences = usePreferences();

    expect(preferences.isDark.value).toBe(true);
    expect(preferences.theme.value).toBe('dark');
    expect(preferences.locale.value).toBe('en-US');
    expect(preferences.isMobile.value).toBe(false);
    expect(preferences.layout.value).toBe('sidebar-nav');
    expect(preferences.sidebarCollapsed.value).toBe(true);
    expect(preferences.keepAlive.value).toBe(true);
    expect(preferences.isSideNav.value).toBe(true);
    expect(preferences.isSideMode.value).toBe(true);
    expect(preferences.isFullContent.value).toBe(false);
    expect(preferences.isMixedNav.value).toBe(false);
    expect(preferences.isSideMixedNav.value).toBe(false);
    expect(preferences.isHeaderNav.value).toBe(false);
    expect(preferences.isHeaderMixedNav.value).toBe(false);
    expect(preferences.isHeaderSidebarNav.value).toBe(false);
    expect(preferences.authPanelLeft.value).toBe(true);
    expect(preferences.authPanelRight.value).toBe(false);
    expect(preferences.authPanelCenter.value).toBe(false);
    expect(preferences.contentIsMaximize.value).toBe(false);
    expect(preferences.globalSearchShortcutKey.value).toBe(true);
    expect(preferences.globalLogoutShortcutKey.value).toBe(false);
    expect(preferences.globalLockScreenShortcutKey.value).toBe(true);
    // auto 位置且顶栏可见：不固定，跟随顶栏。
    expect(preferences.preferencesButtonPosition.value).toEqual({
      fixed: false,
      header: true,
    });
    // 差异只保留与初始偏好不同的字段：与默认值相同的写入不得出现在差异里。
    expect(preferences.diffPreference.value).toEqual({
      app: { authPageLayout: 'panel-left', locale: 'en-US' },
      shortcutKeys: { globalLogout: false },
      sidebar: { collapsed: true },
    });
  });

  it('移动端强制使用侧边导航布局', /** 移动端不受持久化布局影响，必须收敛到 sidebar-nav。 */ () => {
    preferencesManager.updatePreferences({
      app: { isMobile: true, layout: 'header-nav' },
    });

    expect(usePreferences().layout.value).toBe('sidebar-nav');
  });

  it('登录注册面板位置按当前布局互斥判定', /** panel-right 与 panel-center 不能与 panel-left 同时为真。 */ () => {
    preferencesManager.updatePreferences({
      app: { authPageLayout: 'panel-right' },
    });
    expect(usePreferences().authPanelRight.value).toBe(true);

    preferencesManager.updatePreferences({
      app: { authPageLayout: 'panel-center' },
    });
    const preferences = usePreferences();
    expect(preferences.authPanelCenter.value).toBe(true);
    expect(preferences.authPanelLeft.value).toBe(false);
    expect(preferences.authPanelRight.value).toBe(false);
  });

  it('全部布局类型都参与侧边模式判定', /** 侧边模式由五种布局共同决定，逐个布局核对判定结果。 */ () => {
    const preferences = usePreferences();
    const cases: [string, boolean][] = [
      ['mixed-nav', true],
      ['sidebar-mixed-nav', true],
      ['sidebar-nav', true],
      ['header-mixed-nav', true],
      ['header-sidebar-nav', true],
      ['header-nav', false],
      ['full-content', false],
    ];

    for (const [layout, expected] of cases) {
      preferencesManager.updatePreferences({
        app: { layout: layout as never },
      });
      expect(preferences.isSideMode.value, layout).toBe(expected);
    }
  });

  it('顶栏与侧边同时隐藏且非全屏时内容最大化', /** 内容最大化排除 full-content 模式，全屏布局本身不参与该判定。 */ () => {
    preferencesManager.updatePreferences({
      app: { layout: 'sidebar-nav' },
      header: { hidden: true },
      sidebar: { hidden: true },
    });
    expect(usePreferences().contentIsMaximize.value).toBe(true);

    preferencesManager.updatePreferences({
      app: { layout: 'full-content' },
    });
    expect(usePreferences().contentIsMaximize.value).toBe(false);
  });

  it('关闭偏好按钮时两个位置都不显示', /** 未启用偏好设置按钮时任何位置都不固定。 */ () => {
    preferencesManager.updatePreferences({
      app: { enablePreferences: false, preferencesButtonPosition: 'auto' },
      header: { hidden: true },
      sidebar: { hidden: true },
    });

    expect(usePreferences().preferencesButtonPosition.value).toEqual({
      fixed: false,
      header: false,
    });
  });

  it('显式位置设置不再按导航状态回退', /** 固定或顶栏位置由配置直接决定，隐藏顶栏也不能改变用户选择。 */ () => {
    const preferences = usePreferences();

    preferencesManager.updatePreferences({
      app: { enablePreferences: true, preferencesButtonPosition: 'fixed' },
      header: { enable: true, hidden: true },
      sidebar: { hidden: true },
    });
    expect(preferences.preferencesButtonPosition.value).toEqual({
      fixed: true,
      header: false,
    });

    preferencesManager.updatePreferences({
      app: { preferencesButtonPosition: 'header' },
    });
    expect(preferences.preferencesButtonPosition.value).toEqual({
      fixed: false,
      header: true,
    });
  });

  it('auto 位置在全屏布局或不显示顶栏时固定', /** 内容最大化、全屏布局与隐藏顶栏都会让按钮改为固定显示。 */ () => {
    const preferences = usePreferences();

    preferencesManager.updatePreferences({
      app: {
        enablePreferences: true,
        layout: 'full-content',
        preferencesButtonPosition: 'auto',
      },
      header: { enable: true, hidden: false },
      sidebar: { hidden: false },
    });
    expect(preferences.preferencesButtonPosition.value).toEqual({
      fixed: true,
      header: false,
    });

    preferencesManager.updatePreferences({
      app: { layout: 'sidebar-nav' },
      header: { enable: false },
    });
    expect(preferences.preferencesButtonPosition.value).toEqual({
      fixed: true,
      header: false,
    });
  });
});
