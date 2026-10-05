/**
 * 布局头部时区入口（basic/header/header.vue 的 timezone 右侧插槽）真实接线回归。
 *
 * 头部只有在 preferences.widget.timezone 打开时才把时区入口排进右侧工具区，并交给组件包的
 * TimezoneButton 渲染：右侧插槽白名单漏写该名称会让偏好开关完全失效，模板缺少对应渲染分支
 * 会让该插槽静默渲染成空节点，两者都会让用户在整个应用里找不到设置时区的入口。
 * 用例用真实偏好状态驱动真实头部，只把组件包依赖替换为可定位替身，断言真实渲染结果。
 */
import { mount } from '@vue/test-utils';

import { preferencesManager } from '@vben/preferences';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TimezoneButton } from '../../../widgets';
import LayoutHeader from '../header.vue';

vi.mock(
  '@vben/hooks',
  /** 刷新动作依赖标签栏 Store 与 pinia 上下文，不属于本用例的契约。 */ () => ({
    /** 返回无副作用的刷新入口。 */
    useRefresh: () => ({
      /** 本用例不触发刷新，用空实现隔离。 */
      refresh: () => undefined,
    }),
  }),
);

vi.mock(
  '@vben/stores',
  /** 头部渲染全局搜索时会读取访问菜单，真实 Store 需要 pinia 上下文。 */ () => ({
    /** 返回空菜单列表的访问 Store 替身。 */
    useAccessStore: () => ({ accessMenus: [] }),
  }),
);

vi.mock(
  '../../../widgets',
  /** 组件包依赖真实图标、主题与弹窗逻辑，这里替换为可定位替身以隔离这些外部边界。 */ () => ({
    /** 全局搜索替身，本用例关闭该入口。 */
    GlobalSearch: { template: '<div data-test="global-search" />' },
    /** 偏好按钮替身，本用例不触发退出事件。 */
    PreferencesButton: { template: '<div data-test="preferences" />' },
    /** 主题切换替身，本用例关闭该入口。 */
    ThemeToggle: { template: '<div data-test="theme-toggle" />' },
    /** 时区入口替身：头部渲染它就是真实接线成功的证据。 */
    TimezoneButton: { template: '<div data-test="timezone" />' },
  }),
);

/**
 * 挂载真实头部，并注入用户下拉插槽作为右侧工具区的参照节点。
 * @returns 已挂载的头部包装器。
 */
function mountHeader() {
  return mount(LayoutHeader, {
    slots: {
      'user-dropdown': '<div data-test="user-dropdown" />',
    },
  });
}

beforeEach(
  /** 建立确定性的真实偏好基线：只打开时区入口，关闭其余右侧小部件。 */ () => {
    preferencesManager.updatePreferences({
      widget: {
        fullscreen: false,
        globalSearch: false,
        notification: false,
        themeToggle: false,
        timezone: true,
      },
    });
  },
);

afterEach(
  /** 恢复被用例改写的真实偏好，避免影响同进程内的其他用例。 */ () => {
    preferencesManager.resetPreferences();
  },
);

describe('头部时区入口接线', /** 时区偏好开启却不渲染，会让用户完全没有设置时区的入口。 */ () => {
  it('时区偏好打开时头部渲染时区入口', /** 白名单漏写或模板缺少渲染分支都会让该入口静默消失。 */ () => {
    const wrapper = mountHeader();

    expect(wrapper.findComponent(TimezoneButton).exists()).toBe(true);
    expect(wrapper.find('[data-test="timezone"]').exists()).toBe(true);
  });

  it('时区入口与用户下拉同属右侧工具区', /** 入口放错区域会让它脱离顶栏右侧工具条，位置随布局变化漂移。 */ () => {
    const wrapper = mountHeader();
    const timezone = wrapper.get('[data-test="timezone"]').element;
    const userDropdown = wrapper.get('[data-test="user-dropdown"]').element;

    expect(timezone.parentElement).toBe(userDropdown.parentElement);
  });

  it('时区偏好关闭时不渲染时区入口', /** 负对照：证明上一条断言来自偏好分支，而不是入口无条件存在。 */ () => {
    preferencesManager.updatePreferences({ widget: { timezone: false } });
    const wrapper = mountHeader();

    expect(wrapper.findComponent(TimezoneButton).exists()).toBe(false);
    expect(wrapper.find('[data-test="timezone"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="user-dropdown"]').exists()).toBe(true);
  });
});
