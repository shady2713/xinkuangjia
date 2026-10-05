/**
 * 语言切换入口（widgets/language-toggle.vue）真实语言切换回归。
 *
 * 该入口把下拉菜单选中的语言写进真实偏好并装载对应语言包：写入遗漏会让界面语言停在旧值，语言包
 * 未装载会让整站翻译缺失，空值守卫失效会在未选值时清空语言。用例按真实 API 装载 vue-i18n 与语言
 * 包，用真实指针事件打开菜单，断言真实偏好状态、真实 i18n 状态与真实 DOM 文案的变化。
 */
import { mount } from '@vue/test-utils';
import { createApp, defineComponent, h, nextTick } from 'vue';

import { i18n, loadLocaleMessages, setupI18n, useI18n } from '@vben/locales';
import { preferences, preferencesManager } from '@vben/preferences';

import { VbenDropdownRadioMenu } from '@vben-core/shadcn-ui';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import LanguageToggle from './language-toggle.vue';

/** 每个用例挂载的宿主，用例结束后统一卸载以清理菜单传送节点。 */
let mounted: ReturnType<typeof mount> | undefined;

/** 宿主组件：把被测入口与一段真实翻译文案放在同一页面，验证切换后页面文案同步更新。 */
const LanguageHost = defineComponent({
  name: 'LanguageHost',
  /**
   * 渲染语言入口与真实翻译文案。
   * @returns 渲染入口与探针文案的渲染函数。
   */
  setup() {
    const { t } = useI18n();
    return /** 渲染入口与探针文案。 */ () =>
      h('div', [
        h(LanguageToggle),
        h('span', { 'data-test': 'probe' }, t('preferences.language')),
      ]);
  },
});

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
  /** 按真实 API 建立 vue-i18n 全局实例并装载中文语言包，语言切换依赖这套真实状态。 */ async () => {
    await setupI18n(createAppHost(), { defaultLocale: 'zh-CN' });
  },
);

afterEach(
  /** 恢复默认语言、清空传送节点并卸载宿主，避免用例之间互相影响。 */ async () => {
    mounted?.unmount();
    mounted = undefined;
    document.body.innerHTML = '';
    preferencesManager.resetPreferences();
    await loadLocaleMessages('zh-CN');
  },
);

/**
 * 用真实指针事件打开语言下拉菜单。
 * @param wrapper 已挂载的语言切换宿主。
 * @returns 菜单真实展开后的 Promise。
 */
async function openMenu(wrapper: ReturnType<typeof mount>) {
  const trigger = wrapper.get('button');
  await trigger.trigger('pointerdown', { button: 0 });
  await trigger.trigger('click');
  await trigger.trigger('keydown', { key: 'ArrowDown' });
  await vi.waitFor(
    /** 等待传送节点真实渲染出菜单项。 */ () => {
      expect(document.querySelectorAll('[role="menuitem"]').length).toBe(2);
    },
    { timeout: 2000 },
  );
}

/**
 * 读取展开后真实渲染的菜单项。
 * @returns 按渲染顺序排列的菜单项元素数组。
 */
function readMenuItems() {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

describe('语言切换入口', /** 语言状态或语言包写入错误会让整站界面语言与用户选择不一致。 */ () => {
  it('按当前语言标记选中项并渲染真实语言文案', /** 缺少选中标记会让用户不知道当前生效语言。 */ async () => {
    mounted = mount(LanguageHost, { global: { plugins: [i18n] } });

    expect(mounted.get('[data-test="probe"]').text()).toBe('语言');

    await openMenu(mounted);
    const items = readMenuItems();

    expect(items).toHaveLength(2);
    expect(document.body.textContent).toContain('简体中文');
    expect(document.body.textContent).toContain('English');
    // 当前语言为简体中文，该项带激活底色，另一项不带。
    expect(items[0]?.classList.contains('bg-accent')).toBe(true);
    expect(items[1]?.classList.contains('bg-accent')).toBe(false);
  });

  it('点击英文项切换真实偏好、真实语言包与页面文案', /** 只改偏好不装载语言包会让页面文案仍是旧语言，反之则偏好与界面不一致。 */ async () => {
    mounted = mount(LanguageHost, { global: { plugins: [i18n] } });
    await openMenu(mounted);

    const englishItem = readMenuItems().find(
      /** 定位英文选项，模拟用户点选。 */ (item) =>
        item.textContent?.includes('English'),
    );
    englishItem?.click();

    await vi.waitFor(
      /** 等待真实偏好写入与语言包装载完成，两者都对才算切换成功。 */ () => {
        expect(preferences.app.locale).toBe('en-US');
        expect(i18n.global.locale.value).toBe('en-US');
        // setI18nLanguage 会把语言写到 html 根节点的 lang 属性上，供无障碍与排版使用。
        expect(document.documentElement.lang).toBe('en-US');
      },
      { timeout: 2000 },
    );
    // 真实英文语言包已装载，页面探针文案必须同步切换。
    expect(Object.keys(i18n.global.getLocaleMessage('en-US'))).toContain(
      'preferences',
    );
    await vi.waitFor(
      /** 等待真实 DOM 文案随语言更新。 */ () => {
        expect(mounted?.get('[data-test="probe"]').text()).toBe('Language');
      },
      { timeout: 2000 },
    );

    await openMenu(mounted);
    const items = readMenuItems();
    expect(items[1]?.classList.contains('bg-accent')).toBe(true);
    expect(items[0]?.classList.contains('bg-accent')).toBe(false);
  });

  it('收到空值时忽略切换并保留当前语言', /** 下拉菜单只会点出真实语言值，这里用真实子组件事件触发空值守卫；守卫失效会清空语言。 */ async () => {
    mounted = mount(LanguageHost, { global: { plugins: [i18n] } });

    mounted
      .findComponent(LanguageToggle)
      .findComponent(VbenDropdownRadioMenu)
      .vm.$emit('update:modelValue', undefined);
    await nextTick();

    expect(preferences.app.locale).toBe('zh-CN');
    expect(i18n.global.locale.value).toBe('zh-CN');
  });
});
