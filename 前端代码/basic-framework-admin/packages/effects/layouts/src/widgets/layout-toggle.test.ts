/**
 * 登录页布局切换入口（effects/layouts 的 widgets/layout-toggle.vue）真实写入回归。
 *
 * 该入口把下拉菜单选中的布局写进真实偏好 preferences.app.authPageLayout，并按当前布局渲染对应
 * 图标：写入遗漏会让登录页布局与用户选择不一致，空值守卫失效会在未选值时清空布局，图标分支写错
 * 会让当前布局与图标对不上。用例装载真实语言包，用真实指针事件展开 reka-ui 下拉菜单，点击真实
 * 菜单项，断言真实偏好状态、真实菜单选中标记与真实渲染出的图标。
 */
import { mount } from '@vue/test-utils';
import { createApp, h, nextTick } from 'vue';

import { loadLocaleMessages, setupI18n } from '@vben/locales';
import {
  preferences,
  preferencesManager,
  updatePreferences,
} from '@vben/preferences';

import { VbenDropdownRadioMenu } from '@vben-core/shadcn-ui';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import LayoutToggle from './layout-toggle.vue';

/** 每个用例挂载的宿主，用例结束后卸载以清理下拉菜单的传送节点。 */
let mounted: ReturnType<typeof mount> | undefined;

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

/**
 * 用真实指针事件展开布局下拉菜单。
 * @param wrapper 已挂载的布局切换宿主。
 * @returns 菜单项真实渲染完成后的 Promise。
 */
async function openMenu(wrapper: ReturnType<typeof mount>) {
  const trigger = wrapper.get('button');
  await trigger.trigger('pointerdown', { button: 0 });
  await trigger.trigger('click');
  await trigger.trigger('keydown', { key: 'ArrowDown' });
  await vi.waitFor(
    /** 等待传送节点真实渲染出菜单项。 */ () => {
      expect(document.querySelectorAll('[role="menuitem"]').length).toBe(3);
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

/**
 * 按文案取出菜单项。
 * @param text 菜单项文案。
 * @returns 命中的菜单项元素。
 * @throws Error 菜单项未渲染时抛出，避免用例静默地什么都不点。
 */
function menuItem(text: string) {
  const item = readMenuItems().find(
    /** 只挑出文案匹配的菜单项。 */ (node) => node.textContent?.includes(text),
  );
  if (!item) {
    throw new Error(`布局菜单未渲染菜单项：${text}`);
  }
  return item;
}

beforeAll(
  /** 按真实 API 装载中文语言包，菜单文案与图标分支都依赖真实翻译。 */ async () => {
    await setupI18n(createAppHost(), { defaultLocale: 'zh-CN' });
  },
);

afterEach(
  /** 恢复默认偏好、还原语言并卸载宿主，避免用例之间互相影响。 */ async () => {
    mounted?.unmount();
    mounted = undefined;
    document.body.innerHTML = '';
    preferencesManager.resetPreferences();
    await loadLocaleMessages('zh-CN');
  },
);

describe('布局切换入口图标', /** 图标分支决定当前布局是否被如实呈现。 */ () => {
  it('默认偏好为右对齐时只渲染右对齐图标', /** 图标分支写错会让用户看到的布局与生效布局不一致。 */ () => {
    mounted = mount(LayoutToggle);

    expect(preferences.app.authPageLayout).toBe('panel-right');
    expect(mounted.find('button').exists()).toBe(true);
    expect(mounted.find('svg.lucide-panel-right').exists()).toBe(true);
    expect(mounted.find('svg.lucide-panel-left').exists()).toBe(false);
    expect(mounted.find('svg.lucide-inspection-panel').exists()).toBe(false);
  });

  it('偏好为左对齐或居中时渲染对应图标', /** 只认一种布局会让其余布局的入口显示错误图标。 */ () => {
    updatePreferences({ app: { authPageLayout: 'panel-left' } });
    mounted = mount(LayoutToggle);
    expect(mounted.find('svg.lucide-panel-left').exists()).toBe(true);
    expect(mounted.find('svg.lucide-panel-right').exists()).toBe(false);
    mounted.unmount();

    updatePreferences({ app: { authPageLayout: 'panel-center' } });
    mounted = mount(LayoutToggle);
    expect(mounted.find('svg.lucide-inspection-panel').exists()).toBe(true);
    expect(mounted.find('svg.lucide-panel-left').exists()).toBe(false);
  });
});

describe('布局切换菜单', /** 菜单选项与选中标记决定用户能否看懂当前生效布局。 */ () => {
  it('展开菜单展示三个布局选项并标记当前项', /** 选项缺失或选中标记失效会让用户不知道当前布局。 */ async () => {
    mounted = mount(LayoutToggle);
    await openMenu(mounted);

    const items = readMenuItems();
    expect(items).toHaveLength(3);
    const labels = items.map(
      /** 读取每个菜单项的真实翻译文案。 */ (item) => item.textContent?.trim(),
    );
    expect(labels).toEqual(['居左', '居中', '居右']);
    // 当前布局为右对齐，只有该项带选中底色。
    expect(items[2]?.classList.contains('bg-accent')).toBe(true);
    expect(items[0]?.classList.contains('bg-accent')).toBe(false);
    expect(items[1]?.classList.contains('bg-accent')).toBe(false);
  });

  it('点击居中项写入真实偏好并切换图标', /** 只改菜单状态不写偏好会让登录页布局停在旧值。 */ async () => {
    mounted = mount(LayoutToggle);
    await openMenu(mounted);

    menuItem('居中').click();

    await vi.waitFor(
      /** 等待真实偏好写入与图标随之切换。 */ () => {
        expect(preferences.app.authPageLayout).toBe('panel-center');
        expect(mounted?.find('svg.lucide-inspection-panel').exists()).toBe(
          true,
        );
      },
      { timeout: 2000 },
    );
    expect(mounted.find('svg.lucide-panel-right').exists()).toBe(false);
  });

  it('收到空值时忽略写入并保留当前布局', /** 空值守卫失效会在未选值时把布局清成非法值。 */ async () => {
    const wrapper = mount(LayoutToggle);
    mounted = wrapper;

    // 下拉组件只会点出真实布局值，这里用真实子组件事件触发空值守卫。
    wrapper
      .findComponent(VbenDropdownRadioMenu)
      .vm.$emit('update:modelValue', undefined);
    await nextTick();

    expect(preferences.app.authPageLayout).toBe('panel-right');
    expect(wrapper.find('svg.lucide-panel-right').exists()).toBe(true);
  });
});
