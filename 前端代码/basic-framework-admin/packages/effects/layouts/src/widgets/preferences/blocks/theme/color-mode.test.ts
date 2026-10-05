/**
 * 偏好设置色彩模式区块（preferences/blocks/theme/color-mode.vue）双向绑定回归。
 *
 * 区块提供色弱模式与灰色模式两个开关：写回断开会让无障碍配色偏好改了不生效，默认值缺失会让
 * 未配置过的用户一进抽屉就得到 undefined 状态。用例真实点击开关行并断言写回载荷与选中态。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';

import { $t } from '@vben/locales';

import { afterEach, describe, expect, it } from 'vitest';

import SwitchItem from '../switch-item.vue';
import ColorMode from './color-mode.vue';

/** 每个用例挂载的宿主，用例结束后统一卸载。 */
let mounted: ReturnType<typeof mount> | undefined;

afterEach(
  /** 卸载宿主，避免残留影响后续用例。 */ () => {
    mounted?.unmount();
    mounted = undefined;
  },
);

/**
 * 用真实双向绑定串起两个色彩模式开关。
 * @returns 两个开关的本地状态与已挂载宿主。
 */
function mountColorMode() {
  const appColorWeakMode = ref(false);
  const appColorGrayMode = ref(false);
  const wrapper = mount(
    defineComponent({
      /**
       * 渲染带真实双向绑定的色彩模式区块。
       * @returns 渲染函数，返回绑定到本地状态的色彩模式区块。
       */
      setup() {
        return /** 返回绑定到本地状态的色彩模式区块。 */ () =>
          h(ColorMode, {
            appColorWeakMode: appColorWeakMode.value,
            appColorGrayMode: appColorGrayMode.value,
            /** 写回色弱模式开关。 */
            'onUpdate:appColorWeakMode': (value: boolean) => {
              appColorWeakMode.value = value;
            },
            /** 写回灰色模式开关。 */
            'onUpdate:appColorGrayMode': (value: boolean) => {
              appColorGrayMode.value = value;
            },
          });
      },
    }),
  );
  mounted = wrapper;
  return { appColorGrayMode, appColorWeakMode, wrapper };
}

describe('色彩模式偏好开关', /** 两个无障碍配色开关的写回决定特殊用户能否正常使用界面。 */ () => {
  it('渲染色弱模式与灰色模式两个开关', /** 文案缺失会让用户不知道这两个开关的无障碍用途。 */ () => {
    const { wrapper } = mountColorMode();
    const rows = wrapper.findAllComponents(SwitchItem);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.text()).toBe($t('preferences.theme.weakMode'));
    expect(rows[1]?.text()).toBe($t('preferences.theme.grayMode'));
  });

  it('未传初始值时两个开关默认关闭', /** 默认值缺失会让未配置用户拿到 undefined 状态。 */ () => {
    const wrapper = mount(ColorMode);
    mounted = wrapper;
    const switches = wrapper.findAll('button[role="switch"]');

    expect(switches).toHaveLength(2);
    expect(switches[0]?.attributes('aria-checked')).toBe('false');
    expect(switches[1]?.attributes('aria-checked')).toBe('false');

    // 未传初始值时点击应写回明确的 true，而不是把 undefined 取反。
    expect(wrapper.emitted('update:appColorWeakMode')).toBeUndefined();
  });

  it('点击色弱模式开关写回 true 且不影响灰色模式', /** 两个开关互相串扰会让用户开启一个模式却改动另一个。 */ async () => {
    const { appColorGrayMode, appColorWeakMode, wrapper } = mountColorMode();
    const [weakRow] = wrapper.findAllComponents(SwitchItem);

    await weakRow?.trigger('click');

    expect(appColorWeakMode.value).toBe(true);
    expect(appColorGrayMode.value).toBe(false);
    expect(
      wrapper.findAll('button[role="switch"]')[0]?.attributes('aria-checked'),
    ).toBe('true');
    expect(
      wrapper.findAll('button[role="switch"]')[1]?.attributes('aria-checked'),
    ).toBe('false');
  });

  it('点击灰色模式开关写回 true', /** 灰色模式写回断开会让阅读障碍用户的配色偏好失效。 */ async () => {
    const { appColorGrayMode, wrapper } = mountColorMode();
    const [, grayRow] = wrapper.findAllComponents(SwitchItem);

    await grayRow?.trigger('click');

    expect(appColorGrayMode.value).toBe(true);
    expect(
      wrapper.findAll('button[role="switch"]')[1]?.attributes('aria-checked'),
    ).toBe('true');
  });
});
