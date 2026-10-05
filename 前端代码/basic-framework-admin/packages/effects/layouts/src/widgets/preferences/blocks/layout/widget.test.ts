/**
 * 偏好设置-小部件区块（preferences/blocks/layout/widget.vue）真实交互回归。
 *
 * 区块用七个开关控制顶栏小部件，并用一个下拉控制偏好按钮位置：开关写回错位会让用户改一个部件
 * 却影响另一个，下拉选项缺失或选择不回写会让偏好按钮无处安放。用例真实点击每个开关行、
 * 用键盘打开下拉并选中真实选项，断言写回载荷与控件状态。
 */
import { DOMWrapper, mount } from '@vue/test-utils';
import { createApp, defineComponent, h, ref } from 'vue';

import { setupI18n } from '@vben/locales';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import SelectItem from '../select-item.vue';
import SwitchItem from '../switch-item.vue';
import Widget from './widget.vue';

/** 每个用例挂载的宿主，用例结束后统一卸载并清理下拉传送节点。 */
let mounted: ReturnType<typeof mount> | undefined;

afterEach(
  /** 卸载宿主、清理传送节点，避免残留影响后续用例。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    document.body.innerHTML = '';
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
  /** 按真实 API 装载中文语言包，开关与下拉文案取自真实语言包。 */ async () => {
    await setupI18n(createAppHost(), { defaultLocale: 'zh-CN' });
  },
);

/**
 * 用真实双向绑定串起七个小部件开关与按钮位置。
 * @returns 八个偏好项的本地状态与已挂载宿主。
 */
function mountWidget() {
  const widgetGlobalSearch = ref(false);
  const widgetThemeToggle = ref(false);
  const widgetFullscreen = ref(false);
  const widgetNotification = ref(false);
  const widgetLockScreen = ref(false);
  const widgetSidebarToggle = ref(false);
  const widgetRefresh = ref(false);
  const appPreferencesButtonPosition = ref('auto');
  const wrapper = mount(
    defineComponent({
      /**
       * 渲染带真实双向绑定的小部件区块。
       * @returns 渲染函数，返回绑定到本地状态的小部件区块。
       */
      setup() {
        return /** 返回绑定到本地状态的小部件区块。 */ () =>
          h(Widget, {
            appPreferencesButtonPosition: appPreferencesButtonPosition.value,
            widgetFullscreen: widgetFullscreen.value,
            widgetGlobalSearch: widgetGlobalSearch.value,
            widgetLockScreen: widgetLockScreen.value,
            widgetNotification: widgetNotification.value,
            widgetRefresh: widgetRefresh.value,
            widgetSidebarToggle: widgetSidebarToggle.value,
            widgetThemeToggle: widgetThemeToggle.value,
            /** 写回偏好按钮位置。 */
            'onUpdate:appPreferencesButtonPosition': (
              value: string | undefined,
            ) => {
              appPreferencesButtonPosition.value = value ?? 'auto';
            },
            /** 写回全屏部件开关。 */
            'onUpdate:widgetFullscreen': (value: boolean | undefined) => {
              widgetFullscreen.value = value ?? false;
            },
            /** 写回全局搜索部件开关。 */
            'onUpdate:widgetGlobalSearch': (value: boolean | undefined) => {
              widgetGlobalSearch.value = value ?? false;
            },
            /** 写回锁屏部件开关。 */
            'onUpdate:widgetLockScreen': (value: boolean | undefined) => {
              widgetLockScreen.value = value ?? false;
            },
            /** 写回通知部件开关。 */
            'onUpdate:widgetNotification': (value: boolean | undefined) => {
              widgetNotification.value = value ?? false;
            },
            /** 写回刷新部件开关。 */
            'onUpdate:widgetRefresh': (value: boolean | undefined) => {
              widgetRefresh.value = value ?? false;
            },
            /** 写回侧边栏切换部件开关。 */
            'onUpdate:widgetSidebarToggle': (value: boolean | undefined) => {
              widgetSidebarToggle.value = value ?? false;
            },
            /** 写回主题切换部件开关。 */
            'onUpdate:widgetThemeToggle': (value: boolean | undefined) => {
              widgetThemeToggle.value = value ?? false;
            },
          });
      },
    }),
  );
  mounted = wrapper;
  return {
    appPreferencesButtonPosition,
    widgetFullscreen,
    widgetGlobalSearch,
    widgetLockScreen,
    widgetNotification,
    widgetRefresh,
    widgetSidebarToggle,
    widgetThemeToggle,
    wrapper,
  };
}

/**
 * 用键盘路径打开偏好按钮位置下拉：这是选择控件真实支持的无障碍交互，且不依赖 happy-dom 缺失的指针捕获能力。
 * @param wrapper 已挂载的小部件宿主。
 * @returns 下拉面板真实展开后的 Promise。
 */
async function openPositionSelect(wrapper: ReturnType<typeof mount>) {
  await wrapper.get('[role="combobox"]').trigger('keydown', { key: 'Enter' });
  await vi.waitFor(
    /** 等待传送节点真实渲染出三个位置选项。 */ () => {
      expect(document.querySelectorAll('[role="option"]').length).toBe(3);
    },
    { timeout: 2000 },
  );
}

describe('小部件偏好', /** 七个开关与位置下拉决定顶栏功能能否被逐项裁剪。 */ () => {
  it('渲染七个开关与三个位置的按钮位置下拉', /** 开关或选项漏渲染会让用户改不了对应部件。 */ () => {
    const { wrapper } = mountWidget();
    const rows = wrapper.findAllComponents(SwitchItem);
    const select = wrapper.getComponent(SelectItem);

    expect(rows).toHaveLength(7);
    expect(rows[0]?.text()).toBe('启用全局搜索');
    expect(rows[1]?.text()).toBe('启用主题切换');
    expect(rows[2]?.text()).toBe('启用全屏');
    expect(rows[3]?.text()).toBe('启用通知');
    expect(rows[4]?.text()).toBe('启用锁屏');
    expect(rows[5]?.text()).toBe('启用侧边栏切换');
    expect(rows[6]?.text()).toBe('启用刷新');
    expect(select.text()).toContain('偏好设置位置');
    expect(select.props('items')).toEqual([
      { label: '自动', value: 'auto' },
      { label: '顶栏', value: 'header' },
      { label: '固定', value: 'fixed' },
    ]);
  });

  it('点击每个开关写回对应部件且互不串扰', /** 绑定错位会让用户改一个部件却影响另一个。 */ async () => {
    const {
      widgetFullscreen,
      widgetGlobalSearch,
      widgetLockScreen,
      widgetNotification,
      widgetRefresh,
      widgetSidebarToggle,
      widgetThemeToggle,
      wrapper,
    } = mountWidget();
    const rows = wrapper.findAllComponents(SwitchItem);

    await rows[0]?.trigger('click');

    expect(widgetGlobalSearch.value).toBe(true);
    expect(widgetThemeToggle.value).toBe(false);
    expect(widgetFullscreen.value).toBe(false);

    await rows[1]?.trigger('click');
    await rows[2]?.trigger('click');
    await rows[3]?.trigger('click');
    await rows[4]?.trigger('click');
    await rows[5]?.trigger('click');
    await rows[6]?.trigger('click');

    expect(widgetThemeToggle.value).toBe(true);
    expect(widgetFullscreen.value).toBe(true);
    expect(widgetNotification.value).toBe(true);
    expect(widgetLockScreen.value).toBe(true);
    expect(widgetSidebarToggle.value).toBe(true);
    expect(widgetRefresh.value).toBe(true);
    expect(
      wrapper.findAll('button[role="switch"]')[6]?.attributes('aria-checked'),
    ).toBe('true');
  });

  it('已开启的开关再次点击写回关闭', /** 只能开启不能关闭会让用户无法收起不想要的部件。 */ async () => {
    const { widgetGlobalSearch, wrapper } = mountWidget();
    const rows = wrapper.findAllComponents(SwitchItem);

    await rows[0]?.trigger('click');
    await rows[0]?.trigger('click');

    expect(widgetGlobalSearch.value).toBe(false);
    expect(
      wrapper.findAll('button[role="switch"]')[0]?.attributes('aria-checked'),
    ).toBe('false');
  });

  it('用键盘在下拉里选中固定位置并写回', /** 选择结果丢包会让用户的偏好按钮位置设置无效。 */ async () => {
    const { appPreferencesButtonPosition, wrapper } = mountWidget();
    await openPositionSelect(wrapper);

    const fixedOption = [
      ...document.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find(
      /** 定位固定位置选项，模拟用户点选。 */ (option) =>
        option.textContent?.includes('固定'),
    );
    // 选项选择由真实键盘选中事件完成：面板被传送到 body，键盘路径无需 happy-dom 缺失的指针捕获能力。
    if (fixedOption) {
      await new DOMWrapper(fixedOption).trigger('keydown', { key: 'Enter' });
    }

    await vi.waitFor(
      /** 等待选择事件真实回写到按钮位置取值。 */ () => {
        expect(appPreferencesButtonPosition.value).toBe('fixed');
      },
      { timeout: 2000 },
    );
    expect(wrapper.getComponent(SelectItem).text()).toContain('固定');
  });
});
