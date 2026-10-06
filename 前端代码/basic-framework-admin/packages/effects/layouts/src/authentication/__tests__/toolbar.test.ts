/**
 * 认证页工具栏的渲染契约回归：默认入口集只有配色、布局、主题三个开关，
 * 语言切换即使被偏好和 widgets 导出，也不得出现在认证工具栏上。
 * 偏好模块与 ../widgets 全部以 mock 顶替，各开关自身交互不在覆盖范围内。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it, vi } from 'vitest';

import AuthenticationToolbar from '../toolbar.vue';

vi.mock('@vben/preferences', () => ({
  preferences: {
    widget: {
      languageToggle: true,
      themeToggle: true,
    },
  },
}));

vi.mock('../../widgets', () => ({
  AuthenticationColorToggle: {
    template: '<div data-test="color-toggle" />',
  },
  AuthenticationLayoutToggle: {
    template: '<div data-test="layout-toggle" />',
  },
  LanguageToggle: {
    template: '<div data-test="language-toggle" />',
  },
  ThemeToggle: {
    template: '<div data-test="theme-toggle" />',
  },
}));

describe('authentication toolbar', () => {
  it('does not render the language toggle control', () => {
    const wrapper = mount(AuthenticationToolbar);

    expect(wrapper.find('[data-test="language-toggle"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="theme-toggle"]').exists()).toBe(true);
  });
});
