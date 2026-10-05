/**
 * 应用国际化装配（locales/index）真实行为回归。
 *
 * 该模块把应用自己的语言包、Element Plus 语言包与 dayjs 语言包接到核心 i18n 上：
 * 语言包没有按语言目录合并会让页面文案退回键名，Element Plus 或 dayjs 语言未随
 * 切换更新会让日期与组件文案语言不一致，缺省语言必须取偏好设置，调用方显式传入的
 * 选项要能覆盖缺省值。用例使用真实核心 i18n 装配、真实语言包动态导入与真实 dayjs，
 * 断言翻译结果、组件库语言对象、dayjs 当前语言与 html lang。
 *
 * dayjs 语言包的应用动作按 [裁决 D9] 的口径提取为接收显式语言包的 applyDayjsLocale：
 * 动态导入的返回值由调用方传入，因此"语言包缺失"这一上游边界可以被直接构造与断言，
 * 不必依赖动态导入真的交出空值。
 */
import type { App } from 'vue';

import type { SupportedLanguagesType } from '@vben/locales';

import { createApp } from 'vue';

import { i18n } from '@vben/locales';
import { preferences } from '@vben/preferences';

import dayjs from 'dayjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyDayjsLocale, elementLocale, setupI18n } from './index';

/** 不在支持列表中的语言编码；用于验证兜底分支的真实行为。 */
const unsupportedLocale = 'ja-JP' as SupportedLanguagesType;

/**
 * 建立真实 Vue 应用实例，供核心 i18n 安装插件。
 * @returns 可重复创建的空应用。
 */
function createProbeApp(): App {
  return createApp({
    /** 探针根组件不渲染任何节点。 */
    render: () => null,
  });
}

beforeEach(
  /** 每例开始前恢复 console.warn，避免上一例的监听残留。 */ () => {
    vi.restoreAllMocks();
  },
);

describe('语言包装配', /** 语言包必须按语言目录加载并合并进 i18n，否则页面只显示键名。 */ () => {
  it('缺省语言取偏好设置并加载中文语言包', /** 缺省语言写死会让偏好设置失效，界面语言与用户选择不一致。 */ async () => {
    await setupI18n(createProbeApp());

    expect(i18n.global.locale.value).toBe(preferences.app.locale);
    expect(i18n.global.t('page.auth.login')).toBe('登录');
    expect(i18n.global.t('utils.rangePicker.today')).toBe('今天');
    expect(elementLocale.value.name).toBe('zh-cn');
    expect(dayjs.locale()).toBe('zh-cn');
  });

  it('切换到英文时应用语言包、组件库与 dayjs 同步更新', /** 只更新其中一处会让日期格式与组件文案停留在上一种语言。 */ async () => {
    await setupI18n(createProbeApp(), { defaultLocale: 'en-US' });

    expect(i18n.global.locale.value).toBe('en-US');
    expect(i18n.global.t('page.auth.login')).toBe('Login');
    expect(i18n.global.t('utils.rangePicker.today')).toBe('Today');
    expect(elementLocale.value.name).toBe('en');
    expect(dayjs.locale()).toBe('en');
    expect(document.querySelector('html')?.getAttribute('lang')).toBe('en-US');
  });

  it('调用方传入的语言与缺省值冲突时以传入值为准', /** 选项展开顺序写错会让宿主应用无法指定自己的默认语言。 */ async () => {
    await setupI18n(createProbeApp(), { defaultLocale: 'en-US' });

    expect(i18n.global.locale.value).toBe('en-US');
    expect(i18n.global.t('page.auth.login')).toBe('Login');
  });

  it('不支持的语言按英语回退且不改变组件库语言', /** 兜底分支不可用会让非预期语言直接抛错；该输入已越出支持列表，上游合并会如实拒绝。 */ async () => {
    await setupI18n(createProbeApp(), { defaultLocale: 'en-US' });

    await expect(
      setupI18n(createProbeApp(), { defaultLocale: unsupportedLocale }),
    ).rejects.toThrow('Invalid value');

    // dayjs 兜底使用英语，Element Plus 语言没有对应分支因此保持上一次的值。
    expect(dayjs.locale()).toBe('en');
    expect(elementLocale.value.name).toBe('en');
    expect(document.querySelector('html')?.getAttribute('lang')).toBe('en-US');
  });
});

describe('缺省按键告警', /** 缺省按键告警由宿主选项控制，关掉后不应再打印警告。 */ () => {
  it('未显式关闭时对缺失的多段键打印告警', /** 测试与开发环境需要缺键提示，否则漏译只能在界面上肉眼发现。 */ async () => {
    const warn = vi
      .spyOn(console, 'warn')
      .mockImplementation(
        /** 静默预期内的警告输出，避免污染测试结果。 */ () => {},
      );

    await setupI18n(createProbeApp());
    i18n.global.t('not.exist.key');

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Not found 'not.exist.key' key"),
    );
    warn.mockRestore();
  });

  it('显式关闭后不再打印缺键告警', /** 选项被忽略会让宿主无法关闭生产环境的缺键噪音。 */ async () => {
    const warn = vi
      .spyOn(console, 'warn')
      .mockImplementation(
        /** 静默预期内的警告输出，避免污染测试结果。 */ () => {},
      );

    await setupI18n(createProbeApp(), {
      defaultLocale: 'zh-CN',
      missingWarn: false,
    });
    i18n.global.t('not.exist.key');

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('dayjs 语言包应用', /** 语言包缺失时的处置决定日期格式会不会悄悄退回默认语言。 */ () => {
  it('语言包缺失时只告警并保持当前语言', /** 把空值交给 dayjs.locale 会重置语言，用户切换语言后日期格式会莫名回退。 */ () => {
    const warn = vi
      .spyOn(console, 'warn')
      .mockImplementation(
        /** 静默预期内的警告输出，避免污染测试结果。 */ () => {},
      );
    dayjs.locale('zh-cn');

    applyDayjsLocale(undefined, 'en-US');

    // 语言必须保持在切换前的值，不能被空值重置回内置默认语言。
    expect(dayjs.locale()).toBe('zh-cn');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        '[i18n:dayjs-locale] Failed to load dayjs locale for en-US',
      ),
    );
    warn.mockRestore();
  });

  it('语言包可用时真实切换 dayjs 语言', /** 语言包被丢弃会让日期与组件文案停留在上一种语言。 */ async () => {
    const warn = vi
      .spyOn(console, 'warn')
      .mockImplementation(
        /** 静默预期内的警告输出，避免污染测试结果。 */ () => {},
      );
    dayjs.locale('zh-cn');

    applyDayjsLocale(await import('dayjs/locale/en'), 'en-US');

    expect(dayjs.locale()).toBe('en');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
