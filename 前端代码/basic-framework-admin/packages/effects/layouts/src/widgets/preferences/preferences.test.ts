/**
 * 偏好设置抽屉入口（preferences/preferences.vue）真实交互回归。
 *
 * 该组件把全局 preferences 摊平成抽屉的扁平属性与 update: 事件，并承载默认的齿轮入口按钮：
 * 摊平写错会让抽屉里的控件显示与真实偏好不一致，写回链路断开会让用户在抽屉里改的任何偏好都
 * 存不进全局状态，语言写回漏掉语言包切换会让界面文案停留在旧语言。用例真实点击入口按钮打开
 * 抽屉、真实切换分区、真实操作分区控件，并断言全局偏好写入、样式类副作用与语言包切换。
 */
import { DOMWrapper, mount } from '@vue/test-utils';
import { createApp, h, nextTick } from 'vue';

import { SUPPORT_LANGUAGES } from '@vben/constants';
import { i18n, setupI18n } from '@vben/locales';
import {
  preferences,
  resetPreferences,
  updatePreferences,
} from '@vben/preferences';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import Preferences from './preferences.vue';

/** 每个用例挂载的宿主，用例结束后统一卸载并清理抽屉传送节点。 */
let mounted: ReturnType<typeof mount> | undefined;

afterEach(
  /** 卸载宿主、清理传送节点并还原被用例改动的偏好。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    document.body.innerHTML = '';
    resetPreferences();
  },
);

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
  /** 按真实 API 装载中文语言包，抽屉与分区文案都取自真实语言包。 */ async () => {
    await setupI18n(createAppHost(), { defaultLocale: 'zh-CN' });
  },
);

/**
 * 挂载偏好设置入口，使用默认的齿轮按钮插槽。
 * @returns 已挂载的入口宿主。
 */
function mountPreferences() {
  mounted = mount(Preferences);
  return mounted;
}

/**
 * 挂载偏好设置入口并把外部 class 透传给抽屉。
 * @param className 透传给抽屉的外层 class。
 * @returns 已挂载的入口宿主。
 */
function mountPreferencesWithClass(className: string | undefined) {
  mounted = mount(Preferences, { attrs: { class: className } });
  return mounted;
}

/**
 * 真实点击默认齿轮入口打开抽屉，并等待抽屉内容传送挂载。
 * @param wrapper 已挂载的偏好设置入口宿主。
 * @returns 抽屉内容真实渲染后的 Promise。
 */
async function openDrawer(wrapper: ReturnType<typeof mount>) {
  await wrapper.get('button').trigger('click');
  await vi.waitFor(
    /** 等待抽屉内容真实传送出分区页签。 */ () => {
      expect(document.querySelector('[role="tablist"]')).not.toBeNull();
    },
    { timeout: 2000 },
  );
}

/**
 * 按可见文案真实点击抽屉里的分区页签。
 * @param label 页签文案。
 * @returns 分区内容切换完成后的 Promise。
 */
async function switchTab(label: string) {
  const tab = [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find(
    /** 按可见文案定位目标分区页签。 */ (element) =>
      element.textContent?.trim() === label,
  );
  expect(tab).toBeDefined();
  if (tab) {
    // reka-ui 的页签在鼠标左键按下时切换选中段，与真实用户操作一致。
    await new DOMWrapper(tab).trigger('mousedown');
  }
  await nextTick();
  await nextTick();
}

/**
 * 按可见文案在抽屉里定位主题预设卡片。
 * @param label 预设卡片文案。
 * @returns 命中的预设卡片元素，未找到时为 undefined。
 */
function findThemePreset(label: string) {
  return [...document.querySelectorAll<HTMLElement>('.outline-box')].find(
    /** 只保留外层文案匹配的预设卡片。 */ (box) =>
      box.parentElement?.textContent?.trim() === label,
  );
}

/**
 * 按可见文案真实点击抽屉里的某个开关行。
 * @param label 开关行文案。
 * @returns 点击完成后的 Promise。
 */
async function clickSwitchRow(label: string) {
  const rows = [
    ...document.querySelectorAll<HTMLElement>('button[role="switch"]'),
  ]
    .map(
      /** 从开关按钮回退到承载整行点击事件的父节点。 */ (button) =>
        button.parentElement,
    )
    .filter(
      /** 只保留文案匹配的开关行。 */ (element): element is HTMLElement =>
        element?.textContent?.includes(label) === true,
    );
  expect(rows).toHaveLength(1);
  await new DOMWrapper(rows[0] as HTMLElement).trigger('click');
  await nextTick();
  await nextTick();
}

describe('偏好设置面板', /** 摊平、写回与语言切换决定用户能否在抽屉里真正配置偏好。 */ () => {
  it('渲染默认齿轮入口按钮且初始不打开抽屉', /** 首屏自动弹出抽屉会遮挡用户正在浏览的页面。 */ () => {
    const wrapper = mountPreferences();
    const button = wrapper.get('button');

    expect(button.attributes('title')).toBe('偏好设置');
    expect(button.find('svg').exists()).toBe(true);
    expect(button.classes()).toContain('rounded-l-lg');
    expect(document.body.textContent).not.toContain(
      '自定义偏好设置 & 实时预览',
    );
  });

  it('点击入口按钮真实打开抽屉并渲染外观分区', /** 入口点不开会让用户改不了任何偏好。 */ async () => {
    const wrapper = mountPreferences();

    await openDrawer(wrapper);

    expect(document.body.textContent).toContain('外观');
    expect(document.body.textContent).toContain('内置主题');
    expect(document.body.textContent).toContain('字体大小');
    expect(document.body.textContent).toContain('色弱模式');
    expect(document.body.textContent).toContain('清空缓存 & 退出登录');
  });

  it('外部 class 真实透传到抽屉内容根节点', /** class 被丢弃会让业务方无法给抽屉加定位或尺寸样式。 */ async () => {
    const wrapper = mountPreferencesWithClass('DUMMY-preferences-entry');

    await openDrawer(wrapper);

    // 抽屉内容根节点是偏好组件的子节点，class 必须一路透传到它上面。
    expect(
      wrapper.element.querySelector('.DUMMY-preferences-entry'),
    ).not.toBeNull();
  });

  it('未传 class 时抽屉正常渲染且不带空 class', /** 空 class 会被下游 cn 拼成无意义的样式类。 */ async () => {
    const wrapper = mountPreferencesWithClass(undefined);

    await openDrawer(wrapper);

    expect(wrapper.find('.undefined').exists()).toBe(false);
    expect(document.querySelector('[role="tablist"]')).not.toBeNull();
  });

  it('切换分区后渲染对应配置块', /** 分区页签渲染错会让用户找不到要改的偏好。 */ async () => {
    const wrapper = mountPreferences();
    await openDrawer(wrapper);

    await switchTab('布局');
    expect(document.body.textContent).toContain('侧边栏');
    expect(document.body.textContent).toContain('标签栏');
    expect(document.body.textContent).toContain('面包屑导航');
    expect(document.body.textContent).toContain('版权');

    await switchTab('快捷键');
    expect(document.body.textContent).toContain('全局搜索');
    expect(document.body.textContent).toContain('锁定屏幕');

    await switchTab('通用');
    expect(document.body.textContent).toContain('动画');
    expect(document.body.textContent).toContain('语言');
    expect(document.body.textContent).toContain('水印');
  });

  it('在外观分区点选深色主题真实写回全局偏好', /** 写回链路断开会让用户在抽屉里改的主题存不进偏好。 */ async () => {
    const wrapper = mountPreferences();
    await openDrawer(wrapper);
    const darkPreset = findThemePreset('深色');
    expect(darkPreset).toBeDefined();

    if (darkPreset) {
      await new DOMWrapper(darkPreset).trigger('click');
    }

    await vi.waitFor(
      /** 等待主题模式真实写入全局偏好。 */ () => {
        expect(preferences.theme.mode).toBe('dark');
      },
      { timeout: 2000 },
    );
    expect(darkPreset?.classList.contains('outline-box-active')).toBe(true);
  });

  it('在外观分区点击色弱模式开关真实写回偏好并切换样式类', /** 开关写回断开会让无障碍配色偏好改了不生效。 */ async () => {
    const wrapper = mountPreferences();
    await openDrawer(wrapper);

    await clickSwitchRow('色弱模式');

    await vi.waitFor(
      /** 等待色弱模式真实写入全局偏好。 */ () => {
        expect(preferences.app.colorWeakMode).toBe(true);
      },
      { timeout: 2000 },
    );
    // 写回偏好只是第一步，界面必须真的进入色弱模式，否则用户仍看不清内容。
    expect(document.documentElement.classList.contains('invert-mode')).toBe(
      true,
    );
  });

  it('在通用分区切换语言后写回偏好并切换语言包', /** 语言写回漏掉语言包切换会让界面文案与所选语言不符。 */ async () => {
    const wrapper = mountPreferences();
    await openDrawer(wrapper);
    await switchTab('通用');

    const trigger = document.querySelector<HTMLElement>('[role="combobox"]');
    expect(trigger).toBeDefined();
    if (trigger) {
      // 键盘路径是选择控件真实支持的无障碍交互，不依赖 happy-dom 缺失的指针捕获能力。
      await new DOMWrapper(trigger).trigger('keydown', { key: 'Enter' });
    }
    await vi.waitFor(
      /** 等待语言下拉真实展开出全部支持语言。 */ () => {
        expect(document.querySelectorAll('[role="option"]').length).toBe(
          SUPPORT_LANGUAGES.length,
        );
      },
      { timeout: 2000 },
    );

    const english = [
      ...document.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find(
      /** 定位英文选项，模拟用户选中。 */ (option) =>
        option.textContent?.includes('English'),
    );
    if (english) {
      await new DOMWrapper(english).trigger('keydown', { key: 'Enter' });
    }

    await vi.waitFor(
      /** 等待语言真实写入全局偏好。 */ () => {
        expect(preferences.app.locale).toBe('en-US');
      },
      { timeout: 2000 },
    );
    await vi.waitFor(
      /** 等待语言包真实切换，界面文案才会跟着变。 */ () => {
        expect(i18n.global.locale.value).toBe('en-US');
      },
      { timeout: 2000 },
    );
  });

  it('非对象顶层偏好项原样透传给抽屉而不被丢弃', /** 摊平逻辑只处理对象会让非对象偏好项在抽屉里整体消失。 */ async () => {
    updatePreferences({
      DUMMY_topLevel: 'X',
    } as unknown as Parameters<typeof updatePreferences>[0]);
    expect(Object.keys(preferences)).toContain('DUMMY_topLevel');

    const wrapper = mountPreferences();
    await openDrawer(wrapper);

    // mount() 的宽泛重载把宿主元素推断成 any，这里按真实 DOM 元素遍历属性，
    // 否则 Array.from 会退化成 unknown[]，属性名与属性值都失去类型。
    const passedThrough = [
      ...(wrapper.element as Element).querySelectorAll('*'),
    ].flatMap(
      /** 收集每个元素上以透传键名开头的属性值。 */ (element) =>
        [...element.attributes]
          .filter(
            /** 只保留透传键名对应的属性。 */ (attribute) =>
              attribute.name.toLowerCase().startsWith('dummy_toplevel'),
          )
          .map(
            /** 取属性值用于核对原样透传。 */ (attribute) => attribute.value,
          ),
    );

    // 非对象偏好项不走分组摊平，但必须原样透传到抽屉内容根节点，而不是被静默丢弃。
    expect(passedThrough).toContain('X');
  });
});
