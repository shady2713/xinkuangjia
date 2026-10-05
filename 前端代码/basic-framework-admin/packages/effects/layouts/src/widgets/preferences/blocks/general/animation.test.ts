/**
 * 偏好设置-动画区块（preferences/blocks/general/animation.vue）真实交互回归。
 *
 * 动画区块用三个开关与四个过渡预设控制页面切换效果：进度条、Loading、过渡动画三个开关写回断开
 * 会让用户关不掉或开不了对应效果，过渡预设区只在开启动画时出现，且点击必须写回过渡名，
 * 否则用户选了过渡效果却看不到变化。用例真实点击开关行与过渡预设并断言写回载荷、条件渲染与选中态。
 */
import { mount } from '@vue/test-utils';
import { createApp, defineComponent, h, ref } from 'vue';

import { setupI18n } from '@vben/locales';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import SwitchItem from '../switch-item.vue';
import Animation from './animation.vue';

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
  /** 按真实 API 装载中文语言包，开关文案取自真实语言包。 */ async () => {
    await setupI18n(createAppHost(), { defaultLocale: 'zh-CN' });
  },
);

/**
 * 用真实双向绑定串起四个动画偏好。
 * @param transitionEnable 初始是否开启页面切换动画。
 * @param transitionName 初始过渡名。
 * @returns 四个偏好项的本地状态与已挂载宿主。
 */
function mountAnimation(transitionEnable = false, transitionName = 'fade') {
  const enable = ref(transitionEnable);
  const name = ref(transitionName);
  const loading = ref(false);
  const progress = ref(false);
  const wrapper = mount(
    defineComponent({
      /**
       * 渲染带真实双向绑定的动画区块。
       * @returns 渲染函数，返回绑定到本地状态的动画区块。
       */
      setup() {
        return /** 返回绑定到本地状态的动画区块。 */ () =>
          h(Animation, {
            transitionEnable: enable.value,
            transitionLoading: loading.value,
            transitionName: name.value,
            transitionProgress: progress.value,
            /** 写回页面切换动画开关。 */
            'onUpdate:transitionEnable': (value: boolean | undefined) => {
              enable.value = value ?? false;
            },
            /** 写回页面切换 Loading 开关。 */
            'onUpdate:transitionLoading': (value: boolean | undefined) => {
              loading.value = value ?? false;
            },
            /** 写回选中的过渡名。 */
            'onUpdate:transitionName': (value: string | undefined) => {
              name.value = value ?? 'fade';
            },
            /** 写回页面切换进度条开关。 */
            'onUpdate:transitionProgress': (value: boolean) => {
              progress.value = value;
            },
          });
      },
    }),
  );
  mounted = wrapper;
  return { enable, loading, name, progress, wrapper };
}

describe('动画偏好', /** 三个开关与过渡预设决定页面切换效果能否被用户掌控。 */ () => {
  it('渲染三个动画开关且未开启动画时不显示过渡预设', /** 预设区提前出现会让用户点了过渡效果却看不到任何变化。 */ () => {
    const wrapper = mount(Animation);
    mounted = wrapper;
    const rows = wrapper.findAllComponents(SwitchItem);

    expect(rows).toHaveLength(3);
    expect(rows[0]?.text()).toBe('页面切换进度条');
    expect(rows[1]?.text()).toBe('页面切换 Loading');
    expect(rows[2]?.text()).toBe('页面切换动画');
    expect(wrapper.findAll('button[role="switch"]')).toHaveLength(3);
    expect(wrapper.find('.outline-box').exists()).toBe(false);
    // 进度条默认关闭：默认值写错会让用户一进面板就看到多余的进度条。
    expect(
      wrapper.findAll('button[role="switch"]')[0]?.attributes('aria-checked'),
    ).toBe('false');
  });

  it('开启动画后渲染四个过渡预设并高亮当前项', /** 预设漏渲染会让用户选不到某个过渡效果。 */ () => {
    const { wrapper } = mountAnimation(true, 'fade-slide');
    const presets = wrapper.findAll('.outline-box');

    expect(presets).toHaveLength(4);
    expect(wrapper.find('.fade-slow').exists()).toBe(true);
    expect(wrapper.find('.fade-slide-slow').exists()).toBe(true);
    expect(wrapper.find('.fade-up-slow').exists()).toBe(true);
    expect(wrapper.find('.fade-down-slow').exists()).toBe(true);
    expect(presets[1]?.classes()).toContain('outline-box-active');
    expect(presets[0]?.classes()).not.toContain('outline-box-active');
  });

  it('点击其它过渡预设写回过渡名并移动选中态', /** 写回断开会让用户选了过渡效果却仍是旧动画。 */ async () => {
    const { name, wrapper } = mountAnimation(true, 'fade');
    const presets = wrapper.findAll('.outline-box');

    await presets[3]?.trigger('click');

    expect(name.value).toBe('fade-down');
    expect(presets[3]?.classes()).toContain('outline-box-active');
    expect(presets[0]?.classes()).not.toContain('outline-box-active');
  });

  it('点击三个开关分别写回各自取值', /** 绑定错位会让用户改一项却影响另一项效果。 */ async () => {
    const { enable, loading, progress, wrapper } = mountAnimation(false);
    const rows = wrapper.findAllComponents(SwitchItem);

    await rows[0]?.trigger('click');
    await rows[1]?.trigger('click');
    await rows[2]?.trigger('click');

    expect(progress.value).toBe(true);
    expect(loading.value).toBe(true);
    expect(enable.value).toBe(true);
    expect(wrapper.findAll('.outline-box')).toHaveLength(4);
  });

  it('关闭页面切换动画后过渡预设区消失', /** 关闭后仍显示预设会让用户误以为过渡效果还在生效。 */ async () => {
    const { enable, name, wrapper } = mountAnimation(true, 'fade-up');
    const rows = wrapper.findAllComponents(SwitchItem);

    await rows[2]?.trigger('click');

    expect(enable.value).toBe(false);
    expect(name.value).toBe('fade-up');
    expect(wrapper.find('.outline-box').exists()).toBe(false);
  });
});
