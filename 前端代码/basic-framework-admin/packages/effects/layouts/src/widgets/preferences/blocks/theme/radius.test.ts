/**
 * 主题圆角预设（preferences/blocks/theme/radius.vue）交互回归。
 *
 * 圆角区块把五个预设值渲染成互斥按钮：预设漏渲染会让用户选不到某档圆角，选中写回断开会让
 * 界面圆角与抽屉里的选中态不一致。用例真实点击按钮并断言写回载荷与选中态。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';

import { afterEach, describe, expect, it } from 'vitest';

import Radius from './radius.vue';

/** 每个用例挂载的宿主，用例结束后统一卸载。 */
let mounted: ReturnType<typeof mount> | undefined;

afterEach(
  /** 卸载宿主，避免残留影响后续用例。 */ () => {
    mounted?.unmount();
    mounted = undefined;
  },
);

/**
 * 用真实双向绑定串起圆角预设按钮组。
 * @returns 主题圆角本地状态与已挂载宿主。
 */
function mountRadius() {
  const themeRadius = ref('0.5');
  const wrapper = mount(
    defineComponent({
      /**
       * 渲染带真实双向绑定的圆角预设。
       * @returns 渲染函数，返回绑定到本地状态的圆角预设。
       */
      setup() {
        return /** 返回绑定到本地状态的圆角预设。 */ () =>
          h(Radius, {
            themeRadius: themeRadius.value,
            /** 写回选中的圆角预设。 */
            'onUpdate:themeRadius': (value: string | undefined) => {
              themeRadius.value = value ?? '0.5';
            },
          });
      },
    }),
  );
  mounted = wrapper;
  return { themeRadius, wrapper };
}

describe('主题圆角预设', /** 预设完整性与选中写回决定圆角能否被正确设置。 */ () => {
  it('渲染五档圆角预设并标出当前选中项', /** 预设漏渲染会让用户选不到某档圆角。 */ () => {
    const { wrapper } = mountRadius();
    const items = wrapper.findAll('button');

    expect(items).toHaveLength(5);
    expect(
      items.map(/** 收集按钮文案用于核对预设档位。 */ (item) => item.text()),
    ).toEqual(['0', '0.25', '0.5', '0.75', '1']);
    const selected = items.filter(
      /** 只保留处于按下状态的档位。 */ (item) =>
        item.attributes('data-state') === 'on',
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]?.text()).toBe('0.5');
  });

  it('未传初始值时默认选中 0.5 档', /** 默认值缺失会让用户看不到任何选中项。 */ () => {
    const wrapper = mount(Radius);
    mounted = wrapper;
    const selected = wrapper
      .findAll('button')
      .filter(
        /** 只保留处于按下状态的档位。 */ (item) =>
          item.attributes('data-state') === 'on',
      );

    expect(selected).toHaveLength(1);
    expect(selected[0]?.text()).toBe('0.5');
    expect(selected[0]?.attributes('aria-pressed')).toBe('true');
  });

  it('点击其他档位写回新的圆角值', /** 写回断开会让界面圆角与选中态不一致。 */ async () => {
    const { themeRadius, wrapper } = mountRadius();
    const items = wrapper.findAll('button');

    await items[1]?.trigger('click');

    expect(themeRadius.value).toBe('0.25');
    expect(items[1]?.attributes('data-state')).toBe('on');
    expect(items[2]?.attributes('data-state')).toBe('off');
  });
});
