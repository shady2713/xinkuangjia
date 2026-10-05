/**
 * 偏好设置-全局限快捷键区块（preferences/blocks/shortcut-keys/global.vue）真实交互回归。
 *
 * 区块用四个开关控制键盘快捷键：总开关关闭时其余三项必须整体置灰，否则用户会以为快捷键仍然生效；
 * 每个开关写回断开会让用户改了快捷键配置却没有任何变化；快捷键提示必须按当前系统显示 Ctrl/⌘ 与
 * Alt/⌥，显示错会让另一个系统的用户在键盘上按出无效组合。用例真实点击开关行、按系统替换
 * navigator.userAgent 这一外部边界后断言写回载荷、禁用联动与两套按键提示。
 */
import { mount } from '@vue/test-utils';
import { createApp, defineComponent, h, ref } from 'vue';

import { setupI18n } from '@vben/locales';

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import SwitchItem from '../switch-item.vue';
import GlobalShortcutKeys from './global.vue';

/** Windows 与 macOS 两套真实 userAgent 片段：系统判定读取该外部边界。 */
const WINDOWS_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const MAC_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

/** 每个用例挂载的宿主，用例结束后统一卸载。 */
let mounted: ReturnType<typeof mount> | undefined;

beforeEach(
  /** 每例先清掉上一例替换的平台标识，保证系统判定从干净状态开始。 */ () => {
    vi.unstubAllGlobals();
  },
);

afterEach(
  /** 卸载宿主并还原被替换的平台标识。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    vi.unstubAllGlobals();
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
  /** 按真实 API 装载中文语言包，开关文案取自真实语言包。 */ async () => {
    await setupI18n(createAppHost(), { defaultLocale: 'zh-CN' });
  },
);

/**
 * 把平台标识这一外部边界替换为指定系统，让快捷键提示断言不依赖跑测试的机器。
 * @param userAgent 目标系统的真实 userAgent 片段。
 * @returns 无返回值，仅替换全局平台标识。
 */
function stubUserAgent(userAgent: string) {
  vi.stubGlobal('navigator', { userAgent });
}

/**
 * 用真实双向绑定串起四个快捷键开关。
 * @param enable 初始是否启用快捷键。
 * @returns 四个开关的本地状态与已挂载宿主。
 */
function mountShortcutKeys(enable = true) {
  const shortcutKeysEnable = ref(enable);
  const shortcutKeysGlobalSearch = ref(false);
  const shortcutKeysLogout = ref(false);
  const shortcutKeysLockScreen = ref(false);
  const wrapper = mount(
    defineComponent({
      /**
       * 渲染带真实双向绑定的快捷键区块。
       * @returns 渲染函数，返回绑定到本地状态的快捷键区块。
       */
      setup() {
        return /** 返回绑定到本地状态的快捷键区块。 */ () =>
          h(GlobalShortcutKeys, {
            shortcutKeysEnable: shortcutKeysEnable.value,
            shortcutKeysGlobalSearch: shortcutKeysGlobalSearch.value,
            shortcutKeysLockScreen: shortcutKeysLockScreen.value,
            shortcutKeysLogout: shortcutKeysLogout.value,
            /** 写回快捷键总开关。 */
            'onUpdate:shortcutKeysEnable': (value: boolean | undefined) => {
              shortcutKeysEnable.value = value ?? false;
            },
            /** 写回全局搜索快捷键开关。 */
            'onUpdate:shortcutKeysGlobalSearch': (
              value: boolean | undefined,
            ) => {
              shortcutKeysGlobalSearch.value = value ?? false;
            },
            /** 写回锁屏快捷键开关。 */
            'onUpdate:shortcutKeysLockScreen': (value: boolean | undefined) => {
              shortcutKeysLockScreen.value = value ?? false;
            },
            /** 写回退出登录快捷键开关。 */
            'onUpdate:shortcutKeysLogout': (value: boolean | undefined) => {
              shortcutKeysLogout.value = value ?? false;
            },
          });
      },
    }),
  );
  mounted = wrapper;
  return {
    shortcutKeysEnable,
    shortcutKeysGlobalSearch,
    shortcutKeysLockScreen,
    shortcutKeysLogout,
    wrapper,
  };
}

describe('全局快捷键偏好', /** 开关写回与禁用联动决定快捷键配置能否被正确保存与生效。 */ () => {
  it('渲染四个快捷键开关与真实文案', /** 开关或文案缺失会让用户不知道有哪些快捷键可配。 */ () => {
    const { wrapper } = mountShortcutKeys(true);
    const rows = wrapper.findAllComponents(SwitchItem);

    expect(rows).toHaveLength(4);
    expect(rows[0]?.text()).toBe('快捷键');
    expect(rows[1]?.text()).toContain('全局搜索');
    expect(rows[2]?.text()).toContain('退出登录');
    expect(rows[3]?.text()).toContain('锁定屏幕');
    expect(wrapper.findAll('button[role="switch"]')).toHaveLength(4);
    // 快捷键提示区由 shortcut 插槽承载，缺失会让用户看不到该按哪些键。
    expect(rows[1]?.find('kbd').text()).toBe('K');
  });

  it('windows 上显示 Ctrl 与 Alt 组合键提示', /** 提示显示成 Mac 组合会让 Windows 用户按出无效快捷键。 */ () => {
    stubUserAgent(WINDOWS_USER_AGENT);
    const { wrapper } = mountShortcutKeys(true);
    const rows = wrapper.findAllComponents(SwitchItem);

    expect(rows[1]?.text()).toContain('Ctrl');
    expect(rows[2]?.text()).toContain('Alt');
    expect(rows[3]?.text()).toContain('Alt');
    expect(wrapper.text()).not.toContain('⌘');
  });

  it('macOS 上显示 ⌘ 与 ⌥ 组合键提示', /** 提示写死 Ctrl 会让 Mac 用户按不出快捷键。 */ () => {
    stubUserAgent(MAC_USER_AGENT);
    const { wrapper } = mountShortcutKeys(true);
    const rows = wrapper.findAllComponents(SwitchItem);

    expect(rows[1]?.text()).toContain('⌘');
    expect(rows[2]?.text()).toContain('⌥ Q');
    expect(rows[3]?.text()).toContain('⌥ L');
    expect(wrapper.text()).not.toContain('Ctrl');
  });

  it('未传初始值时总开关关闭且细节开关置灰', /** 默认值缺失会让未配置用户看到含义不明的开关状态。 */ () => {
    const wrapper = mount(GlobalShortcutKeys);
    mounted = wrapper;
    const rows = wrapper.findAllComponents(SwitchItem);

    expect(
      wrapper.findAll('button[role="switch"]')[0]?.attributes('aria-checked'),
    ).toBe('false');
    expect(rows[1]?.classes()).toContain('pointer-events-none');
    expect(rows[2]?.classes()).toContain('pointer-events-none');
    expect(rows[3]?.classes()).toContain('pointer-events-none');
  });

  it('总开关关闭时细节开关整体置灰', /** 整体禁用失效会让用户改动不会生效的快捷键配置。 */ () => {
    const { wrapper } = mountShortcutKeys(false);
    const rows = wrapper.findAllComponents(SwitchItem);

    expect(rows[0]?.classes()).not.toContain('pointer-events-none');
    expect(rows[1]?.classes()).toContain('pointer-events-none');
    expect(rows[1]?.classes()).toContain('opacity-50');
    expect(rows[2]?.classes()).toContain('pointer-events-none');
    expect(rows[3]?.classes()).toContain('pointer-events-none');
  });

  it('点击总开关写回并解除细节开关禁用', /** 写回断开会让用户开启快捷键后仍改不了任何组合键。 */ async () => {
    const { shortcutKeysEnable, wrapper } = mountShortcutKeys(false);
    const rows = wrapper.findAllComponents(SwitchItem);

    await rows[0]?.trigger('click');

    expect(shortcutKeysEnable.value).toBe(true);
    expect(rows[1]?.classes()).not.toContain('pointer-events-none');
    expect(
      wrapper.findAll('button[role="switch"]')[0]?.attributes('aria-checked'),
    ).toBe('true');
  });

  it('点击三个细节开关分别写回各自取值', /** 绑定错位会让用户改一项快捷键却影响另一项。 */ async () => {
    const {
      shortcutKeysGlobalSearch,
      shortcutKeysLockScreen,
      shortcutKeysLogout,
      wrapper,
    } = mountShortcutKeys(true);
    const rows = wrapper.findAllComponents(SwitchItem);

    await rows[1]?.trigger('click');
    await rows[2]?.trigger('click');
    await rows[3]?.trigger('click');

    expect(shortcutKeysGlobalSearch.value).toBe(true);
    expect(shortcutKeysLogout.value).toBe(true);
    expect(shortcutKeysLockScreen.value).toBe(true);
    expect(rows[1]?.emitted('update:modelValue')).toEqual([[true]]);
  });
});
