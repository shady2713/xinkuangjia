import { mount } from '@vue/test-utils';

import { describe, expect, it, vi } from 'vitest';

import LayoutHeader from '../header.vue';

vi.mock('@vben/hooks', () => ({
  useRefresh: () => ({
    refresh: () => undefined,
  }),
}));

vi.mock('@vben/preferences', () => ({
  preferences: {
    header: {
      menuAlign: 'start',
    },
    widget: {
      fullscreen: true,
      globalSearch: true,
      languageToggle: true,
      notification: false,
      refresh: true,
      themeToggle: true,
      timezone: true,
    },
  },
  usePreferences: () => ({
    globalSearchShortcutKey: { value: false },
    preferencesButtonPosition: { value: { header: true } },
  }),
}));

vi.mock('@vben/stores', () => ({
  useAccessStore: () => ({
    accessMenus: [],
  }),
}));

vi.mock('../../../widgets', () => ({
  GlobalSearch: {
    template: '<div data-test="global-search" />',
  },
  LanguageToggle: {
    template: '<div data-test="language-toggle" />',
  },
  PreferencesButton: {
    template: '<div data-test="preferences" />',
  },
  ThemeToggle: {
    template: '<div data-test="theme-toggle" />',
  },
  TimezoneButton: {
    template: '<div data-test="timezone" />',
  },
}));

describe('layout header', /** 头部右侧入口是否渲染由偏好开关决定，漏接的入口会让用户找不到对应功能。 */ () => {
  it('renders the timezone control but not the language control', /** 时区开关打开必须出现入口；语言切换属于认证页工具栏，头部不渲染。 */ () => {
    const wrapper = mount(LayoutHeader, {
      slots: {
        'user-dropdown': '<div data-test="user-dropdown" />',
      },
      global: {
        stubs: {
          RotateCw: {
            template: '<span data-test="refresh-icon" />',
          },
          VbenFullScreen: {
            template: '<div data-test="fullscreen" />',
          },
          VbenIconButton: {
            template: '<button><slot /></button>',
          },
        },
      },
    });

    expect(wrapper.find('[data-test="global-search"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="theme-toggle"]').exists()).toBe(true);
    // 语言切换入口只属于认证页工具栏，头部白名单里没有它，因此偏好打开也不渲染。
    expect(wrapper.find('[data-test="language-toggle"]').exists()).toBe(false);
    // 时区偏好已在 mock 中打开，头部必须真实渲染该入口；渲染不出来即为接线缺失。
    expect(wrapper.find('[data-test="timezone"]').exists()).toBe(true);
  });
});
