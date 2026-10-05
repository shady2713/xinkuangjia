/**
 * 运行时配置到框架偏好（preferences.ts）的真实映射回归。
 *
 * 该模块把页面加载的 `_app.config.js` 固定配置映射成框架偏好：后端路由模式、固定
 * 概览首页与认证失效策略属于业务硬约束；字符串 'true'/'false' 必须真实转成布尔值，
 * 否则偏好开关会永远为假。用例注入受控运行时配置后导入模块，断言真实映射结果。
 * 模块图首次加载属于测试初始化成本，用静态导入完成（`vi.hoisted` 已在导入前建立
 * 替身），避免把它计入用例的 5000ms 预算。
 */
import { afterAll, describe, expect, it, vi } from 'vitest';

import { overridesPreferences } from './preferences';

vi.hoisted(
  /**
   * 该模块在加载期读取运行时配置，必须在导入前建立替身。
   */
  () => {
    vi.stubGlobal('_VBEN_ADMIN_PRO_APP_CONF_', {
      VITE_APP_AUTH_PAGE_LAYOUT: 'panel-center',
      VITE_APP_ENABLE_PREFERENCES: 'true',
      VITE_APP_GLOBAL_SEARCH_ENABLE: 'false',
      VITE_APP_NAMESPACE: 'preferences-test',
      VITE_APP_THEME_BUILTIN_TYPE: 'violet',
      VITE_APP_THEME_COLOR_PRIMARY: 'hsl(250 100% 45%)',
      VITE_APP_THEME_MODE: 'auto',
      VITE_APP_THEME_TOGGLE_ENABLE: 'true',
      VITE_APP_TITLE: '偏好映射测试平台',
    });
  },
);

describe('运行时配置到框架偏好的映射', /** 映射错误会让路由模式、主题或版权信息与部署配置不一致。 */ () => {
  afterAll(
    /** 恢复被替换的全局运行时配置。 */ () => {
      vi.unstubAllGlobals();
    },
  );

  it('固定业务口径与字符串开关都映射为真实偏好值', /** 后端路由模式与固定首页是硬约束，字符串开关不转换会永远为假。 */ () => {
    expect(overridesPreferences).toMatchObject({
      app: {
        accessMode: 'backend',
        authPageLayout: 'panel-center',
        defaultHomePath: '/dashboard',
        enablePreferences: true,
        enableRefreshToken: true,
        loginExpiredMode: 'page',
        name: '偏好映射测试平台',
      },
      copyright: {
        companyName: '偏好映射测试平台',
        companySiteLink: '',
      },
      logo: {
        source: '/brand-logo.svg',
        sourceDark: '/brand-logo.svg',
      },
      theme: {
        builtinType: 'violet',
        colorPrimary: 'hsl(250 100% 45%)',
        mode: 'auto',
      },
      widget: {
        globalSearch: false,
        themeToggle: true,
      },
    });
  });
});
