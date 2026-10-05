/**
 * 主题模式切换器（widgets/theme-toggle/theme-toggle.vue）真实主题切换回归。
 *
 * 该部件提供两个入口：主按钮在明暗之间直接翻转，悬浮后展开的切换组可选浅色、深色与跟随系统。
 * 两条路径都必须把模式写进真实偏好并同步 html 根节点的 `dark` 类，写错会让主题停在旧值，
 * 或让界面主题与用户选择不一致。用例真实挂载组件、用真实指针事件展开切换组、用真实点击驱动
 * 两个入口，断言真实偏好状态、真实根节点主题类与切换组的按压态。
 *
 * 环境不具备浏览器的视图过渡能力，主按钮翻转走的是“直接切换”真实分支，因此不做动画断言。
 */
import type { ThemeModeType } from '@vben/types';

import { mount } from '@vue/test-utils';
import { createApp, h, nextTick } from 'vue';

import { setupI18n } from '@vben/locales';
import { preferences, preferencesManager } from '@vben/preferences';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import ThemeToggle from './theme-toggle.vue';

/** 切换组中三个主题预设的真实顺序，用于按位置点击。 */
const presetOrder = ['light', 'dark', 'auto'] as const;

/**
 * 建立仅用于安装 i18n 插件的空应用宿主。
 * @returns 未挂载的空 Vue 应用实例。
 */
function createAppHost() {
  return createApp({
    /** 渲染空节点：该宿主只用于安装 i18n 插件，不参与界面断言。 */
    render: () => h('div'),
  });
}

beforeAll(
  /** 按真实 API 装载中文语言包，三个预设的提示文案取自真实语言包。 */ async () => {
    await setupI18n(createAppHost(), { defaultLocale: 'zh-CN' });
  },
);

afterEach(
  /** 清空浮层节点并复位主题偏好，避免上一例的传送节点与主题影响下一例。 */ () => {
    document.body.innerHTML = '';
    preferencesManager.resetPreferences();
    document.documentElement.classList.remove('dark');
  },
);

/**
 * 把偏好设为指定主题模式，并同步根节点主题类。
 * @param mode 目标主题模式。
 */
function setMode(mode: ThemeModeType) {
  preferencesManager.updatePreferences({ theme: { mode } });
}

/**
 * 读取悬浮层里已渲染的预设按钮。
 * @returns 切换组中真正的预设按钮元素数组。
 */
function readPresetButtons() {
  return [...document.querySelectorAll<HTMLElement>('button[type="button"]')];
}

/**
 * 用真实指针事件悬浮展开预设切换组。
 * @param wrapper 已挂载的主题切换器。
 * @returns 展开后的预设按钮数组，按浅色、深色、跟随系统顺序排列。
 */
async function openPresets(wrapper: ReturnType<typeof mount>) {
  const trigger = wrapper.get('button.theme-toggle');
  await trigger.trigger('pointerenter');
  // 悬浮层按键盘可达性在获得焦点时也会展开，这里用真实焦点事件确认浮层内容。
  await trigger.trigger('focus');
  await vi.waitFor(
    /** 等待悬浮层真实渲染出三个预设按钮。 */ () => {
      expect(readPresetButtons()).toHaveLength(presetOrder.length);
    },
    { timeout: 2000 },
  );
  return readPresetButtons();
}

describe('主题预设渲染与选中态', /** 预设缺失或选中态错位会让用户看不到当前主题。 */ () => {
  it('渲染三个预设并高亮当前模式', /** 预设漏渲染会让用户无法选择想要的主题。 */ async () => {
    setMode('light');
    const wrapper = mount(ThemeToggle, { props: { shouldOnHover: true } });
    const buttons = await openPresets(wrapper);

    expect(buttons[0]?.dataset.state).toBe('on');
    expect(buttons[1]?.dataset.state).toBe('off');
    expect(buttons[2]?.dataset.state).toBe('off');
  });

  it('当前为深色时高亮深色预设', /** 选中态不跟随偏好会让用户误判当前主题。 */ async () => {
    setMode('dark');
    const wrapper = mount(ThemeToggle, { props: { shouldOnHover: true } });
    const buttons = await openPresets(wrapper);

    expect(buttons[1]?.dataset.state).toBe('on');
    expect(buttons[0]?.dataset.state).toBe('off');
  });
});

describe('主题预设真实写入', /** 写错偏好会让界面主题与用户选择不一致。 */ () => {
  it('点击深色预设写入 dark 并给根节点加上 dark 类', /** 只改选中态不写偏好会让刷新后主题回退。 */ async () => {
    setMode('light');
    const wrapper = mount(ThemeToggle, { props: { shouldOnHover: true } });
    const buttons = await openPresets(wrapper);

    buttons[1]?.click();

    await vi.waitFor(
      /** 等待真实偏好与根节点主题类同步更新。 */ () => {
        expect(preferences.theme.mode).toBe('dark');
        expect(document.documentElement.classList.contains('dark')).toBe(true);
      },
      { timeout: 2000 },
    );
    expect(readPresetButtons()[1]?.dataset.state).toBe('on');
    expect(readPresetButtons()[0]?.dataset.state).toBe('off');
  });

  it('点击跟随系统预设写入 auto', /** auto 写不进去会让跟随系统选项失效。 */ async () => {
    setMode('dark');
    const wrapper = mount(ThemeToggle, { props: { shouldOnHover: true } });
    const buttons = await openPresets(wrapper);

    buttons[2]?.click();

    await vi.waitFor(
      /** 等待真实偏好写入 auto。 */ () => {
        expect(preferences.theme.mode).toBe('auto');
      },
      { timeout: 2000 },
    );
    expect(readPresetButtons()[2]?.dataset.state).toBe('on');
    expect(readPresetButtons()[1]?.dataset.state).toBe('off');
  });
});

describe('明暗切换按钮', /** 按钮翻转失效会让用户点不动主题。 */ () => {
  it('亮色下点击按钮切到深色', /** 翻转方向写反会让按钮点一次没有任何变化。 */ async () => {
    setMode('light');
    const wrapper = mount(ThemeToggle);
    const button = wrapper.get('button.theme-toggle');

    expect(button.classes()).toContain('is-dark');
    await button.trigger('click');

    expect(preferences.theme.mode).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(wrapper.get('button.theme-toggle').classes()).toContain('is-light');
  });

  it('深色下点击按钮切回亮色', /** 深色状态下翻转失效会让用户无法回到亮色。 */ async () => {
    setMode('dark');
    const wrapper = mount(ThemeToggle);
    const button = wrapper.get('button.theme-toggle');

    expect(button.classes()).toContain('is-light');
    await button.trigger('click');

    expect(preferences.theme.mode).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(wrapper.get('button.theme-toggle').classes()).toContain('is-dark');
  });
});

describe('悬浮展开切换组', /** 悬浮提示是预设选择的唯一入口。 */ () => {
  it('shouldOnHover 打开时悬浮渲染三个带图标的预设', /** 面板不渲染会让用户看不到三个主题预设。 */ async () => {
    setMode('light');
    const wrapper = mount(ThemeToggle, { props: { shouldOnHover: true } });
    await nextTick();

    const buttons = await openPresets(wrapper);

    // 三个预设各自带一个真实 svg 图标，图标缺失会让按钮变成空白方块。
    expect(
      buttons.every(
        /** 每个预设按钮都必须渲染出真实 svg 图标。 */ (button) =>
          button.querySelector('svg') !== null,
      ),
    ).toBe(true);
    // 浮层默认选中当前模式对应的预设。
    expect(buttons[0]?.dataset.state).toBe('on');
    expect(buttons[1]?.dataset.state).toBe('off');
    expect(buttons[2]?.dataset.state).toBe('off');
  });

  it('未开启悬浮提示时组件内只渲染主按钮', /** 提示层错挂会让按钮在不该出现浮层时也被包进浮层。 */ async () => {
    setMode('light');
    const wrapper = mount(ThemeToggle);
    await nextTick();

    expect(wrapper.get('button.theme-toggle').attributes('aria-label')).toBe(
      'dark',
    );
    expect(readPresetButtons()).toHaveLength(0);
  });
});
