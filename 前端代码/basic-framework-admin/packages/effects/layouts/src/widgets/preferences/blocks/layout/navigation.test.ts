/**
 * 偏好设置-导航菜单配置（widgets/preferences/blocks/layout/navigation.vue）真实交互回归。
 *
 * 该配置块把导航风格、菜单分离与手风琴三个偏好交给真实开关与分组按钮：双向绑定写错会让用户在偏好
 * 面板上的改动不生效或方向相反，禁用属性漏传会让不可用的偏好在特定布局下仍可点击，选项标签取错会
 * 让用户看不懂可选风格。用例按真实语言包装载文案，点击真实控件并断言真实取值更新与禁用样式。
 */
import { mount } from '@vue/test-utils';
import { createApp, h } from 'vue';

import { setupI18n } from '@vben/locales';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import SwitchItem from '../switch-item.vue';
import ToggleItem from '../toggle-item.vue';
import PreferenceNavigationConfig from './navigation.vue';

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
  /** 按真实 API 装载中文语言包，配置项文案与风格标签都取自真实语言包。 */ async () => {
    await setupI18n(createAppHost(), { defaultLocale: 'zh-CN' });
  },
);

describe('偏好设置-导航菜单配置', /** 三个绑定写反会让用户改不动导航样式或开关状态与显示相反。 */ () => {
  it('渲染真实中文文案与两种导航风格选项', /** 选项标签或文案缺失会让用户无法理解可选项。 */ () => {
    const wrapper = mount(PreferenceNavigationConfig, {
      props: { navigationStyleType: 'plain' },
    });
    const toggle = wrapper.getComponent(ToggleItem);

    expect(toggle.text()).toContain('导航菜单风格');
    expect(toggle.text()).toContain('圆润');
    expect(toggle.text()).toContain('朴素');
    expect(wrapper.text()).toContain('导航菜单分离');
    expect(wrapper.text()).toContain('侧边导航菜单手风琴模式');
    // 分离开关带说明气泡，提示图标缺失会让用户看不到该项的影响范围。
    expect(wrapper.find('.cursor-help').exists()).toBe(true);
  });

  it('点击风格选项更新导航风格取值', /** 点击不更新会让用户无法在圆润与朴素风格之间切换。 */ async () => {
    const wrapper = mount(PreferenceNavigationConfig, {
      props: { navigationStyleType: 'plain' },
    });
    const options = wrapper.getComponent(ToggleItem).findAll('button');

    expect(options).toHaveLength(2);
    await options[0]?.trigger('click');

    expect(wrapper.emitted('update:navigationStyleType')).toEqual([
      ['rounded'],
    ]);
  });

  it('悬停提示图标时渲染出真实提示文案', /** 提示文案缺失会让用户不知道分离开关会影响哪些菜单。 */ async () => {
    const wrapper = mount(PreferenceNavigationConfig, {
      props: { navigationSplit: false },
    });

    await wrapper.get('.cursor-help').trigger('pointermove');

    await vi.waitFor(
      /** 等待提示面板真实渲染出说明文案。 */ () => {
        expect(document.body.textContent).toContain(
          '开启时，侧边栏显示顶栏对应菜单的子菜单',
        );
      },
      { timeout: 2000 },
    );
    wrapper.unmount();
    document.body.innerHTML = '';
  });

  it('点击开关翻转菜单分离与手风琴取值', /** 开关方向写反会让用户打开分离却得到关闭结果。 */ async () => {
    const wrapper = mount(PreferenceNavigationConfig, {
      props: { navigationAccordion: true, navigationSplit: false },
    });
    const switches = wrapper.findAllComponents(SwitchItem);

    expect(switches).toHaveLength(2);
    await switches[0]?.trigger('click');
    await switches[1]?.trigger('click');

    expect(wrapper.emitted('update:navigationSplit')).toEqual([[true]]);
    expect(wrapper.emitted('update:navigationAccordion')).toEqual([[false]]);
  });

  it('禁用属性真实落到控件样式上', /** 不可用的偏好仍可点击会让用户改出无效配置。 */ () => {
    const wrapper = mount(PreferenceNavigationConfig, {
      props: {
        disabled: true,
        disabledNavigationSplit: true,
        navigationSplit: false,
      },
    });
    const toggle = wrapper.getComponent(ToggleItem);
    const switches = wrapper.findAllComponents(SwitchItem);

    expect(toggle.classes()).toContain('pointer-events-none');
    expect(toggle.classes()).toContain('opacity-50');
    expect(switches[0]?.classes()).toContain('pointer-events-none');
    expect(switches[1]?.classes()).toContain('pointer-events-none');
  });

  it('未禁用时控件保持可点击样式', /** 负对照：禁用样式不能误加到可用配置上。 */ () => {
    const wrapper = mount(PreferenceNavigationConfig);
    const toggle = wrapper.getComponent(ToggleItem);
    const switches = wrapper.findAllComponents(SwitchItem);

    expect(toggle.classes()).not.toContain('pointer-events-none');
    expect(switches[0]?.classes()).not.toContain('pointer-events-none');
    expect(switches[1]?.classes()).not.toContain('pointer-events-none');
  });
});
