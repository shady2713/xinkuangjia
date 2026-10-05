/**
 * 偏好设置页脚区块（preferences/blocks/layout/footer.vue）双向绑定回归。
 *
 * 区块用两个开关控制页脚显示与固定：写回链路断开会让用户改了偏好却不生效，禁用联动失效会让
 * 用户在页脚未开启时仍能改动固定项。用例真实点击开关行，断言写回载荷与选中态、禁用态样式。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';

import { $t } from '@vben/locales';

import { afterEach, describe, expect, it } from 'vitest';

import SwitchItem from '../switch-item.vue';
import Footer from './footer.vue';

/** 每个用例挂载的宿主，用例结束后统一卸载。 */
let mounted: ReturnType<typeof mount> | undefined;

afterEach(
  /** 卸载宿主，避免残留影响后续用例。 */ () => {
    mounted?.unmount();
    mounted = undefined;
  },
);

/**
 * 用真实双向绑定串起两个页脚开关，便于断言写回后的 DOM 状态。
 * @returns 两个开关的本地状态与已挂载宿主。
 */
function mountFooter() {
  const footerEnable = ref(false);
  const footerFixed = ref(false);
  const wrapper = mount(
    defineComponent({
      /**
       * 渲染带真实双向绑定的页脚区块。
       * @returns 渲染函数，返回绑定到本地状态的页脚区块。
       */
      setup() {
        return /** 返回绑定到本地状态的页脚区块。 */ () =>
          h(Footer, {
            footerEnable: footerEnable.value,
            footerFixed: footerFixed.value,
            /** 写回页脚显示开关。 */
            'onUpdate:footerEnable': (value: boolean | undefined) => {
              footerEnable.value = value ?? false;
            },
            /** 写回页脚固定开关。 */
            'onUpdate:footerFixed': (value: boolean | undefined) => {
              footerFixed.value = value ?? false;
            },
          });
      },
    }),
  );
  mounted = wrapper;
  return { footerEnable, footerFixed, wrapper };
}

describe('页脚偏好开关', /** 两个开关的写回与联动决定页脚设置能否生效。 */ () => {
  it('渲染显示与固定两个开关行', /** 文案缺失会让用户无法分辨两个开关各自控制什么。 */ () => {
    const { wrapper } = mountFooter();
    const rows = wrapper.findAllComponents(SwitchItem);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.text()).toBe($t('preferences.footer.visible'));
    expect(rows[1]?.text()).toBe($t('preferences.footer.fixed'));
    expect(wrapper.findAll('button[role="switch"]')).toHaveLength(2);
  });

  it('页脚未开启时固定开关行不可交互', /** 缺少禁用样式会让用户改动注定不生效的固定项。 */ () => {
    const { wrapper } = mountFooter();
    const rows = wrapper.findAllComponents(SwitchItem);

    expect(rows[0]?.classes()).not.toContain('pointer-events-none');
    expect(rows[1]?.classes()).toContain('pointer-events-none');
    expect(rows[1]?.classes()).toContain('opacity-50');
  });

  it('点击显示开关写回 true 并解除固定开关禁用', /** 写回断开会让用户打开页脚后仍改不了固定项。 */ async () => {
    const { footerEnable, footerFixed, wrapper } = mountFooter();
    const [visibleRow, fixedRow] = wrapper.findAllComponents(SwitchItem);

    await visibleRow?.trigger('click');

    expect(footerEnable.value).toBe(true);
    expect(footerFixed.value).toBe(false);
    expect(
      wrapper.findAll('button[role="switch"]')[0]?.attributes('aria-checked'),
    ).toBe('true');
    expect(fixedRow?.classes()).not.toContain('pointer-events-none');
  });

  it('点击固定开关写回 true', /** 固定开关写回断开会让页脚固定永远停留在关闭。 */ async () => {
    const { footerEnable, footerFixed, wrapper } = mountFooter();
    const [visibleRow, fixedRow] = wrapper.findAllComponents(SwitchItem);

    await visibleRow?.trigger('click');
    await fixedRow?.trigger('click');

    expect(footerEnable.value).toBe(true);
    expect(footerFixed.value).toBe(true);
    expect(
      wrapper.findAll('button[role="switch"]')[1]?.attributes('aria-checked'),
    ).toBe('true');
  });
});
