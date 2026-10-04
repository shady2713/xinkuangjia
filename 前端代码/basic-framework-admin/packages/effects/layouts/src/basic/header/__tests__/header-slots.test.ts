/** 校验布局头部右侧/左侧插槽装配、通知开关与“清除偏好并退出”事件转发。 */
import { mount } from '@vue/test-utils';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import LayoutHeader from '../header.vue';

const prefs = vi.hoisted(
  /** 可变的偏好替身：用例通过改写字段验证头部对不同偏好组合的真实响应。 */ () => ({
    preferencesButtonInHeader: true,
    widget: {
      fullscreen: false,
      globalSearch: false,
      notification: true,
      refresh: false,
      themeToggle: false,
    },
  }),
);

vi.mock(
  '@vben/hooks',
  /** 刷新动作不属于本组契约，用空实现隔离。 */ () => ({
    /** 返回无副作用的刷新入口。 */
    useRefresh: () => ({
      /** 本组不触发刷新，用空实现隔离。 */
      refresh: () => undefined,
    }),
  }),
);

vi.mock(
  '@vben/preferences',
  /** 只保留头部读取的偏好字段，避免引入真实持久化与远端配置。 */ () => ({
    preferences: {
      header: { menuAlign: 'end' },
      widget: prefs.widget,
    },
    /** 返回本组覆盖的偏好读取入口。 */
    usePreferences: () => ({
      globalSearchShortcutKey: { value: false },
      preferencesButtonPosition: {
        value: { header: prefs.preferencesButtonInHeader },
      },
    }),
  }),
);

vi.mock(
  '@vben/stores',
  /** 全局搜索关闭时不会读取菜单，用空菜单隔离访问 Store。 */ () => ({
    /** 返回只含菜单列表的访问 Store 替身。 */
    useAccessStore: () => ({ accessMenus: [] }),
  }),
);

vi.mock(
  '../../../widgets',
  /** 组件包依赖真实图标与主题逻辑，这里替换为可观察替身。 */ () => ({
    /** 全局搜索替身，本组不渲染该入口。 */
    GlobalSearch: { template: '<div data-test="global-search" />' },
    /** 语言切换替身，本组不渲染该入口。 */
    LanguageToggle: { template: '<div data-test="language-toggle" />' },
    /** 偏好按钮替身，点击后抛出与真实组件同名的事件。 */
    PreferencesButton: {
      emits: ['clearPreferencesAndLogout'],
      template:
        '<button data-test="preferences" @click="$emit(\'clearPreferencesAndLogout\')" />',
    },
    /** 主题切换替身，本组不渲染该入口。 */
    ThemeToggle: { template: '<div data-test="theme-toggle" />' },
    /** 时区按钮替身，本组不渲染该入口。 */
    TimezoneButton: { template: '<div data-test="timezone" />' },
  }),
);

/** 挂载头部并注入本组需要的命名插槽。 */
function mountHeader() {
  return mount(LayoutHeader, {
    slots: {
      'header-left-70': '<div data-test="left-70" />',
      'header-right-70': '<div data-test="right-70" />',
      notification: '<div data-test="notification" />',
      'user-dropdown': '<div data-test="user-dropdown" />',
    },
  });
}

describe('布局头部插槽与退出转发', /** 头部按偏好与插槽名决定渲染顺序，装配错误会让入口消失或顺序错乱。 */ () => {
  beforeEach(
    /** 恢复默认偏好组合，避免用例之间互相影响。 */ () => {
      prefs.preferencesButtonInHeader = true;
      prefs.widget.notification = true;
    },
  );

  it('通知开关打开时渲染通知插槽', /** 通知入口只在偏好开启时出现，关闭后必须完全移除。 */ () => {
    const wrapper = mountHeader();
    expect(wrapper.find('[data-test="notification"]').exists()).toBe(true);
  });

  it('通知开关关闭时不渲染通知插槽', /** 负对照：证明上一条断言来自偏好分支而不是插槽始终存在。 */ () => {
    prefs.widget.notification = false;
    const wrapper = mountHeader();
    expect(wrapper.find('[data-test="notification"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="user-dropdown"]').exists()).toBe(true);
  });

  it('header-right 插槽按名称中的序号参与排序', /** 序号 70 小于通知入口的 110，必须排在通知之前，扩展插槽才有确定位置。 */ () => {
    const wrapper = mountHeader();
    const right = wrapper.find('[data-test="right-70"]');
    const notification = wrapper.find('[data-test="notification"]');
    expect(right.exists()).toBe(true);
    expect(
      right.element.compareDocumentPosition(notification.element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('header-left 插槽在序号大于参考值时渲染到菜单之后', /** 大于 50 的左插槽属于菜单右侧扩展区，必须真实渲染出来。 */ () => {
    const wrapper = mountHeader();
    expect(wrapper.find('[data-test="left-70"]').exists()).toBe(true);
  });

  it('偏好按钮抛出事件时头部转发一次退出事件', /** 退出动作由外层布局处理，头部只负责原样转发且不能重复触发。 */ async () => {
    const wrapper = mountHeader();
    await wrapper.find('[data-test="preferences"]').trigger('click');

    expect(wrapper.emitted('clearPreferencesAndLogout')).toHaveLength(1);
  });
});
