/**
 * 偏好设置-主题模式区块（preferences/blocks/theme/theme.vue）真实交互回归。
 *
 * 区块把浅色、深色、跟随系统三个预设渲染成互斥卡片，并用两个开关控制深色侧边栏与深色顶栏：
 * 预设点击写回断开会让用户选不中想要的主题，半暗开关写回断开会让深色布局偏好永不生效，
 * 深色模式下开关不禁用会让用户改出与主题冲突的组合。用例真实点击预设卡片与开关行，
 * 断言写回载荷、选中态与禁用联动。
 */
import { mount } from '@vue/test-utils';
import { createApp, defineComponent, h, ref } from 'vue';

import { setupI18n } from '@vben/locales';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import SwitchItem from '../switch-item.vue';
import Theme from './theme.vue';

/** 每个用例挂载的宿主，用例结束后统一卸载。 */
let mounted: ReturnType<typeof mount> | undefined;

afterEach(
  /** 卸载宿主，避免残留影响后续用例。 */ () => {
    mounted?.unmount();
    mounted = undefined;
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
  /** 按真实 API 装载中文语言包，预设与开关文案都取自真实语言包。 */ async () => {
    await setupI18n(createAppHost(), { defaultLocale: 'zh-CN' });
  },
);

/**
 * 用真实双向绑定串起主题模式与两个半暗开关。
 * @param themeMode 初始主题模式。
 * @param semiDarkSidebar 初始深色侧边栏取值。
 * @param semiDarkHeader 初始深色顶栏取值。
 * @returns 三个偏好项的本地状态与已挂载宿主。
 */
function mountTheme(
  themeMode = 'light',
  semiDarkSidebar = false,
  semiDarkHeader = false,
) {
  const themeModeRef = ref(themeMode);
  const semiDarkSidebarRef = ref(semiDarkSidebar);
  const semiDarkHeaderRef = ref(semiDarkHeader);
  const wrapper = mount(
    defineComponent({
      /**
       * 渲染带真实双向绑定的主题模式区块。
       * @returns 渲染函数，返回绑定到本地状态的主题模式区块。
       */
      setup() {
        return /** 返回绑定到本地状态的主题模式区块。 */ () =>
          h(Theme, {
            modelValue: themeModeRef.value,
            /** 写回选中的主题模式。 */
            'onUpdate:modelValue': (value: string) => {
              themeModeRef.value = value;
            },
            themeSemiDarkHeader: semiDarkHeaderRef.value,
            /** 写回深色顶栏开关。 */
            'onUpdate:themeSemiDarkHeader': (value: boolean | undefined) => {
              semiDarkHeaderRef.value = value ?? false;
            },
            themeSemiDarkSidebar: semiDarkSidebarRef.value,
            /** 写回深色侧边栏开关。 */
            'onUpdate:themeSemiDarkSidebar': (value: boolean | undefined) => {
              semiDarkSidebarRef.value = value ?? false;
            },
          });
      },
    }),
  );
  mounted = wrapper;
  return { semiDarkHeaderRef, semiDarkSidebarRef, themeModeRef, wrapper };
}

describe('主题模式偏好', /** 预设选中与半暗开关决定用户能否配出想要的明暗外观。 */ () => {
  it('渲染三个主题预设并高亮当前模式', /** 预设漏渲染或选中态丢失会让用户看不到当前主题。 */ () => {
    const { wrapper } = mountTheme('light');
    const presets = wrapper.findAll('.outline-box');

    expect(presets).toHaveLength(3);
    expect(wrapper.text()).toContain('浅色');
    expect(wrapper.text()).toContain('深色');
    expect(wrapper.text()).toContain('跟随系统');
    expect(presets[0]?.classes()).toContain('outline-box-active');
    expect(presets[1]?.classes()).not.toContain('outline-box-active');
    expect(presets[2]?.classes()).not.toContain('outline-box-active');
    expect(wrapper.findAllComponents(SwitchItem)).toHaveLength(2);
    expect(wrapper.text()).toContain('深色侧边栏');
    expect(wrapper.text()).toContain('深色顶栏');
  });

  it('未传初始值时默认选中跟随系统', /** 默认值缺失会让未配置用户看不到任何被选中的主题。 */ () => {
    const wrapper = mount(Theme);
    mounted = wrapper;
    const presets = wrapper.findAll('.outline-box');

    expect(presets[2]?.classes()).toContain('outline-box-active');
    expect(presets[0]?.classes()).not.toContain('outline-box-active');
  });

  it('点击深色预设写回 dark 并禁用两个半暗开关', /** 写回断开会让用户选不中深色主题，禁用联动失效会改出与主题冲突的配置。 */ async () => {
    const { themeModeRef, wrapper } = mountTheme('light');
    const presets = wrapper.findAll('.outline-box');

    await presets[1]?.trigger('click');

    expect(themeModeRef.value).toBe('dark');
    expect(presets[1]?.classes()).toContain('outline-box-active');
    expect(presets[0]?.classes()).not.toContain('outline-box-active');
    const rows = wrapper.findAllComponents(SwitchItem);
    expect(rows[0]?.classes()).toContain('pointer-events-none');
    expect(rows[0]?.classes()).toContain('opacity-50');
    expect(rows[1]?.classes()).toContain('pointer-events-none');
  });

  it('点击跟随系统预设写回 auto 并解除半暗开关禁用', /** 跟随系统写回失败会让自动主题停留在上一次的模式。 */ async () => {
    const { themeModeRef, wrapper } = mountTheme('dark');
    const presets = wrapper.findAll('.outline-box');

    await presets[2]?.trigger('click');

    expect(themeModeRef.value).toBe('auto');
    expect(presets[2]?.classes()).toContain('outline-box-active');
    expect(wrapper.findAllComponents(SwitchItem)[0]?.classes()).not.toContain(
      'pointer-events-none',
    );
  });

  it('点击深色侧边栏与深色顶栏开关写回各自取值', /** 半暗开关写回断开会让深色布局偏好永不生效，串扰会让用户改一项却动了两项。 */ async () => {
    const { semiDarkHeaderRef, semiDarkSidebarRef, wrapper } =
      mountTheme('light');
    const [sidebarRow, headerRow] = wrapper.findAllComponents(SwitchItem);

    await sidebarRow?.trigger('click');
    await headerRow?.trigger('click');

    expect(semiDarkSidebarRef.value).toBe(true);
    expect(semiDarkHeaderRef.value).toBe(true);
    expect(wrapper.findAllComponents(SwitchItem)[0]?.props('disabled')).toBe(
      false,
    );
    const switches = wrapper.findAll('button[role="switch"]');
    expect(switches[0]?.attributes('aria-checked')).toBe('true');
    expect(switches[1]?.attributes('aria-checked')).toBe('true');
  });
});
