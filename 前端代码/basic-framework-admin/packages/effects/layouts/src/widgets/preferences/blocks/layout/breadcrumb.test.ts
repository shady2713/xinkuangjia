/**
 * 偏好设置-面包屑区块（preferences/blocks/layout/breadcrumb.vue）真实交互回归。
 *
 * 面包屑区块用四个开关加一组风格按钮控制导航定位能力：总开关关闭时其余项必须整体置灰，
 * 否则用户会改动不会生效的面包屑配置；关闭图标后首页按钮必须单独置灰，因为首页按钮本身
 * 就是图标；风格按钮写回断开会让用户选了风格却看不到变化。用例真实点击开关行与风格按钮，
 * 断言写回载荷、禁用联动与选中态。
 */
import { mount } from '@vue/test-utils';
import { createApp, defineComponent, h, ref } from 'vue';

import { setupI18n } from '@vben/locales';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import SwitchItem from '../switch-item.vue';
import ToggleItem from '../toggle-item.vue';
import Breadcrumb from './breadcrumb.vue';

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
  /** 按真实 API 装载中文语言包，开关与风格文案取自真实语言包。 */ async () => {
    await setupI18n(createAppHost(), { defaultLocale: 'zh-CN' });
  },
);

/**
 * 用真实双向绑定串起五个面包屑偏好。
 * @param enable 初始是否开启面包屑导航。
 * @param showIcon 初始是否显示面包屑图标。
 * @returns 面包屑偏好的本地状态与已挂载宿主。
 */
function mountBreadcrumb(enable = true, showIcon = true) {
  const breadcrumbEnable = ref(enable);
  const breadcrumbShowIcon = ref(showIcon);
  const breadcrumbStyleType = ref('normal');
  const breadcrumbShowHome = ref(false);
  const breadcrumbHideOnlyOne = ref(false);
  const wrapper = mount(
    defineComponent({
      /**
       * 渲染带真实双向绑定的面包屑区块。
       * @returns 渲染函数，返回绑定到本地状态的面包屑区块。
       */
      setup() {
        return /** 返回绑定到本地状态的面包屑区块。 */ () =>
          h(Breadcrumb, {
            breadcrumbEnable: breadcrumbEnable.value,
            breadcrumbHideOnlyOne: breadcrumbHideOnlyOne.value,
            breadcrumbShowHome: breadcrumbShowHome.value,
            breadcrumbShowIcon: breadcrumbShowIcon.value,
            breadcrumbStyleType: breadcrumbStyleType.value,
            /** 写回面包屑导航开关。 */
            'onUpdate:breadcrumbEnable': (value: boolean | undefined) => {
              breadcrumbEnable.value = value ?? false;
            },
            /** 写回仅有一个时隐藏开关。 */
            'onUpdate:breadcrumbHideOnlyOne': (value: boolean | undefined) => {
              breadcrumbHideOnlyOne.value = value ?? false;
            },
            /** 写回显示首页按钮开关。 */
            'onUpdate:breadcrumbShowHome': (value: boolean | undefined) => {
              breadcrumbShowHome.value = value ?? false;
            },
            /** 写回显示面包屑图标开关。 */
            'onUpdate:breadcrumbShowIcon': (value: boolean | undefined) => {
              breadcrumbShowIcon.value = value ?? false;
            },
            /** 写回面包屑风格。 */
            'onUpdate:breadcrumbStyleType': (value: string | undefined) => {
              breadcrumbStyleType.value = value ?? 'normal';
            },
          });
      },
    }),
  );
  mounted = wrapper;
  return {
    breadcrumbEnable,
    breadcrumbHideOnlyOne,
    breadcrumbShowHome,
    breadcrumbShowIcon,
    breadcrumbStyleType,
    wrapper,
  };
}

describe('面包屑偏好', /** 开关与风格按钮的写回、禁用联动决定面包屑能否被正确配置。 */ () => {
  it('渲染四个开关与一组风格按钮', /** 控件漏渲染会让用户改不了某项面包屑配置。 */ () => {
    const { wrapper } = mountBreadcrumb(true, true);
    const rows = wrapper.findAllComponents(SwitchItem);
    const toggle = wrapper.getComponent(ToggleItem);

    expect(rows).toHaveLength(4);
    expect(rows[0]?.text()).toBe('开启面包屑导航');
    expect(rows[1]?.text()).toBe('仅有一个时隐藏');
    expect(rows[2]?.text()).toBe('显示面包屑图标');
    expect(rows[3]?.text()).toBe('显示首页按钮');
    expect(toggle.text()).toContain('面包屑风格');
    expect(toggle.text()).toContain('常规');
    expect(toggle.text()).toContain('背景');
  });

  it('面包屑未开启时后续项整体置灰', /** 整体禁用失效会让用户改动不会生效的面包屑配置。 */ () => {
    const { wrapper } = mountBreadcrumb(false, true);
    const rows = wrapper.findAllComponents(SwitchItem);
    const toggle = wrapper.getComponent(ToggleItem);

    expect(rows[0]?.classes()).not.toContain('pointer-events-none');
    expect(rows[1]?.classes()).toContain('pointer-events-none');
    expect(rows[2]?.classes()).toContain('pointer-events-none');
    expect(rows[3]?.classes()).toContain('pointer-events-none');
    expect(toggle.classes()).toContain('pointer-events-none');
    expect(toggle.classes()).toContain('opacity-50');
  });

  it('关闭图标时首页按钮单独置灰', /** 首页按钮只有图标，图标关闭后仍可开启会让用户得到空按钮。 */ () => {
    const { wrapper } = mountBreadcrumb(true, false);
    const rows = wrapper.findAllComponents(SwitchItem);

    expect(rows[2]?.classes()).not.toContain('pointer-events-none');
    expect(rows[3]?.classes()).toContain('pointer-events-none');
  });

  it('点击总开关写回并解除后续项禁用', /** 写回断开会让用户开启面包屑后仍改不了任何细节。 */ async () => {
    const { breadcrumbEnable, wrapper } = mountBreadcrumb(false, true);
    const rows = wrapper.findAllComponents(SwitchItem);

    await rows[0]?.trigger('click');

    expect(breadcrumbEnable.value).toBe(true);
    expect(rows[1]?.classes()).not.toContain('pointer-events-none');
    expect(rows[2]?.classes()).not.toContain('pointer-events-none');
  });

  it('点击三个细节开关分别写回各自取值', /** 绑定错位会让用户改一项却影响另一项面包屑配置。 */ async () => {
    const {
      breadcrumbHideOnlyOne,
      breadcrumbShowHome,
      breadcrumbShowIcon,
      wrapper,
    } = mountBreadcrumb(true, true);
    const rows = wrapper.findAllComponents(SwitchItem);

    await rows[1]?.trigger('click');
    await rows[3]?.trigger('click');
    await rows[2]?.trigger('click');

    expect(breadcrumbHideOnlyOne.value).toBe(true);
    expect(breadcrumbShowHome.value).toBe(true);
    expect(breadcrumbShowIcon.value).toBe(false);
    // 图标关闭后首页按钮立即置灰，避免用户停留在无效组合上。
    expect(rows[3]?.classes()).toContain('pointer-events-none');
  });

  it('点击风格按钮写回背景风格', /** 风格写回断开会让面包屑外观与选中按钮不一致。 */ async () => {
    const { breadcrumbStyleType, wrapper } = mountBreadcrumb(true, true);
    const buttons = wrapper.getComponent(ToggleItem).findAll('button');

    expect(buttons).toHaveLength(2);
    await buttons[1]?.trigger('click');

    expect(breadcrumbStyleType.value).toBe('background');
    expect(buttons[1]?.attributes('data-state')).toBe('on');
    expect(buttons[0]?.attributes('data-state')).toBe('off');
  });

  it('父级禁用时开关与风格按钮都置灰', /** 布局不适用面包屑时仍可点击会让用户改出无效配置。 */ () => {
    const wrapper = mount(Breadcrumb, {
      props: { breadcrumbEnable: true, disabled: true },
    });
    mounted = wrapper;
    const rows = wrapper.findAllComponents(SwitchItem);
    const toggle = wrapper.getComponent(ToggleItem);

    expect(rows[0]?.classes()).toContain('pointer-events-none');
    expect(toggle.classes()).toContain('pointer-events-none');
  });
});
