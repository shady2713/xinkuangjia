/**
 * 偏好设置入口按钮（preferences/preferences-button.vue）交互回归。
 *
 * 该组件是侧边栏顶部唯一的偏好入口：点击必须真实打开偏好抽屉，抽屉里的“清除缓存并退出”必须
 * 原样冒泡给业务外壳触发退出登录。入口点不开会让用户改不了任何偏好，事件断链会让清退按钮点
 * 了没反应。用例真实点击入口按钮、真实点击抽屉清退按钮并断言真实 DOM 与事件载荷。
 */
import { mount } from '@vue/test-utils';

import { $t } from '@vben/locales';
import { resetPreferences, updatePreferences } from '@vben/preferences';

import { afterEach, describe, expect, it, vi } from 'vitest';

import PreferencesButton from './preferences-button.vue';

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
 * 制造一份与初始值不同的偏好，让抽屉底部按钮从禁用变为可点。
 * @returns 无返回值，仅改动全局偏好设置。
 */
function makePreferencesDirty() {
  updatePreferences({ app: { name: 'DUMMY-品牌名' } });
}

/**
 * 按真实文案在传送后的抽屉 DOM 中定位按钮。
 * @param text 目标按钮的文案。
 * @returns 命中的按钮元素，未找到时为 undefined。
 */
function findButtonByText(text: string) {
  return [...document.querySelectorAll('button')].find(
    /** 只保留包含目标文案的按钮。 */ (button) =>
      button.textContent?.includes(text),
  );
}

describe('偏好设置入口按钮', /** 入口点击与清退冒泡决定用户能否配置并安全退出。 */ () => {
  it('渲染侧边栏偏好入口图标且初始不打开抽屉', /** 首屏自动弹出抽屉会遮挡用户正在浏览的页面。 */ () => {
    mounted = mount(PreferencesButton);
    const button = mounted.find('button');

    expect(button.exists()).toBe(true);
    expect(button.find('svg').exists()).toBe(true);
    expect(button.classes()).toContain(
      'hover:animate-[shrink_0.3s_ease-in-out]',
    );
    expect(document.body.textContent).not.toContain($t('preferences.title'));
  });

  it('点击入口按钮真实打开偏好抽屉', /** 入口点不开会让用户改不了任何偏好。 */ async () => {
    mounted = mount(PreferencesButton);

    await mounted.find('button').trigger('click');
    await vi.waitFor(
      /** 等待抽屉内容真实传送挂载。 */ () => {
        expect(document.body.textContent).toContain($t('preferences.title'));
      },
    );

    expect(document.body.textContent).toContain($t('preferences.appearance'));
    expect(document.body.textContent).toContain(
      $t('preferences.clearAndLogout'),
    );
  });

  it('点击抽屉清退按钮冒泡出清退事件', /** 事件断链会让清退按钮点了没反应。 */ async () => {
    makePreferencesDirty();
    mounted = mount(PreferencesButton);

    await mounted.find('button').trigger('click');
    const logoutButton = await vi.waitFor(
      /** 等待清退按钮随抽屉内容真实挂载。 */ () => {
        const target = findButtonByText($t('preferences.clearAndLogout'));
        expect(target).toBeDefined();
        return target;
      },
    );

    // 偏好与初始值不同后按钮必须恢复可点，否则用户无法清空缓存并退出。
    expect(logoutButton?.hasAttribute('disabled')).toBe(false);

    logoutButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(
      /** 等待清退事件真实冒泡到组件外层。 */ () => {
        expect(mounted?.emitted('clearPreferencesAndLogout')).toBeDefined();
      },
    );

    expect(mounted?.emitted('clearPreferencesAndLogout')).toHaveLength(1);
  });
});
