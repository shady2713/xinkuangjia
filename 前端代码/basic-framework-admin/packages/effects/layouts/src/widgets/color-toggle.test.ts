/**
 * 认证页主色切换器（widgets/color-toggle.vue）真实配色切换回归。
 *
 * 该部件把内置配色预设渲染成一排色点，点击后必须把主色与内置主题类型写进真实偏好，并让 html
 * 根节点带上对应的 `data-theme`：写错会让用户选了颜色却看不到界面变化，选中勾错位会让用户误判
 * 当前生效的配色。用例真实挂载组件、用真实点击驱动预设，断言真实偏好状态、真实根节点主题属性
 * 与勾选标记所在位置。
 *
 * 色点的背景色以行内 style 下发，而本测试环境的 DOM 实现不把行内样式序列化进元素属性，
 * 因此颜色断言经 `data-theme` 与偏好值间接核对，不对无法观察的行内样式做假断言。
 */
import { mount } from '@vue/test-utils';
import { createApp, h } from 'vue';

import { setupI18n } from '@vben/locales';
import {
  COLOR_PRESETS,
  preferences,
  preferencesManager,
} from '@vben/preferences';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import ColorToggle from './color-toggle.vue';

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
  /** 按真实 API 装载中文语言包，部件内提示文案取自真实语言包。 */ async () => {
    await setupI18n(createAppHost(), { defaultLocale: 'zh-CN' });
  },
);

afterEach(
  /** 把偏好与根节点主题属性复位，避免上一例选中的配色影响下一例。 */ () => {
    preferencesManager.resetPreferences();
    delete document.documentElement.dataset.theme;
  },
);

/**
 * 取出全部可选色点按钮。
 * @param wrapper 已挂载的配色切换器。
 * @returns 按渲染顺序排列的色点按钮数组，最后一项为打开调色板的入口。
 */
function colorButtons(wrapper: ReturnType<typeof mount>) {
  const buttons = wrapper.findAll('button');
  // 末尾的调色板入口不参与配色选择，这里只返回预设色点。
  return buttons.slice(0, COLOR_PRESETS.length);
}

describe('配色切换器渲染', /** 色点缺失会让用户看不到可选的配色。 */ () => {
  it('按内置预设渲染全部色点并标出当前配色', /** 色点数量或选中勾写错会让用户选错配色。 */ () => {
    const wrapper = mount(ColorToggle);

    const buttons = colorButtons(wrapper);
    expect(buttons).toHaveLength(COLOR_PRESETS.length);
    expect(wrapper.findAll('button')).toHaveLength(COLOR_PRESETS.length + 1);
    // 默认内置主题是 default，只有第一个色点带勾选标记。
    expect(buttons[0]?.find('svg').exists()).toBe(true);
    expect(buttons[1]?.find('svg').exists()).toBe(false);
  });

  it('按偏好里的内置主题标记选中勾', /** 勾选标记不跟随偏好会让用户误判当前生效的配色。 */ () => {
    preferencesManager.updatePreferences({
      theme: { builtinType: 'sky-blue' },
    });
    const wrapper = mount(ColorToggle);
    const buttons = colorButtons(wrapper);
    const index = COLOR_PRESETS.findIndex(
      /** 在真实预设表里定位天蓝色所在位置。 */ (preset) =>
        preset.type === 'sky-blue',
    );

    expect(buttons[index]?.find('svg').exists()).toBe(true);
    expect(buttons[0]?.find('svg').exists()).toBe(false);
  });
});

describe('配色切换真实写入', /** 写错偏好会让界面配色与用户选择不一致。 */ () => {
  it('点击色点写入主色、内置主题与 html 主题属性', /** 三项中任一项没写都会让配色停在旧值。 */ async () => {
    const wrapper = mount(ColorToggle);
    const target = COLOR_PRESETS[2];

    await colorButtons(wrapper)[2]?.trigger('click');

    expect(preferences.theme.builtinType).toBe(target?.type);
    expect(preferences.theme.colorPrimary).toBe(target?.color);
    // updateCSSVariables 会把内置主题写到 html 的 data-theme 上，供 CSS 变量选择。
    expect(document.documentElement.dataset.theme).toBe(target?.type);
    expect(colorButtons(wrapper)[2]?.find('svg').exists()).toBe(true);
    expect(colorButtons(wrapper)[0]?.find('svg').exists()).toBe(false);
  });

  it('连续切换时偏好与勾选标记都跟随最后一次点击', /** 只更新勾选而不更新偏好会让界面与配置脱节。 */ async () => {
    const wrapper = mount(ColorToggle);
    const target = COLOR_PRESETS[5];

    await colorButtons(wrapper)[1]?.trigger('click');
    await colorButtons(wrapper)[5]?.trigger('click');

    expect(preferences.theme.builtinType).toBe(target?.type);
    expect(preferences.theme.colorPrimary).toBe(target?.color);
    expect(document.documentElement.dataset.theme).toBe(target?.type);
    expect(colorButtons(wrapper)[5]?.find('svg').exists()).toBe(true);
    expect(colorButtons(wrapper)[1]?.find('svg').exists()).toBe(false);
  });
});
