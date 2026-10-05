/**
 * 偏好设置-字体大小区块（preferences/blocks/theme/font-size.vue）真实交互回归。
 *
 * 字体大小用数字输入承载 15-22px 的全局字号：增减按钮写回断开会让用户调不动字号，
 * 越界钳制失效会让界面出现 3px 或 99px 这类破坏布局的字号，输入框写回断开会让用户手输的字号丢失。
 * 用例真实点击增减按钮、真实在输入框里输入并断言写回载荷、输入框取值与钳制结果。
 */
import { mount } from '@vue/test-utils';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';

import { setupI18n } from '@vben/locales';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import FontSize from './font-size.vue';

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
  /** 按真实 API 装载中文语言包，字号提示文案取自真实语言包。 */ async () => {
    await setupI18n(createAppHost(), { defaultLocale: 'zh-CN' });
  },
);

/**
 * 用真实双向绑定串起字号数字输入。
 * @param initialFontSize 初始字号。
 * @returns 字号本地状态与已挂载宿主。
 */
function mountFontSize(initialFontSize = 16) {
  const fontSize = ref(initialFontSize);
  const wrapper = mount(
    defineComponent({
      /**
       * 渲染带真实双向绑定的字号区块。
       * @returns 渲染函数，返回绑定到本地状态的字体大小区块。
       */
      setup() {
        return /** 返回绑定到本地状态的字体大小区块。 */ () =>
          h(FontSize, {
            modelValue: fontSize.value,
            /** 写回调整后的字号。 */
            'onUpdate:modelValue': (value: number) => {
              fontSize.value = value;
            },
          });
      },
    }),
  );
  mounted = wrapper;
  return { fontSize, wrapper };
}

/**
 * 点击数字输入的步进按钮：reka-ui 的步进走按下即触发的按住连击链路。
 * @param wrapper 已挂载的字号宿主。
 * @param slot 步进按钮的 data-slot 取值。
 * @returns 步进完成后的 Promise。
 */
async function stepFontSize(
  wrapper: ReturnType<typeof mount>,
  slot: 'decrement' | 'increment',
) {
  // 先等一个刷新周期：reka-ui 的按住连击监听在元素引用就绪后才挂到步进按钮上。
  await nextTick();
  const button = wrapper.get(`[data-slot="${slot}"]`);
  await button.trigger('pointerdown', { button: 0 });
  await button.trigger('pointerup');
  await nextTick();
}

describe('主题字体大小', /** 步进、手输与钳制决定全局字号能否被安全调整。 */ () => {
  it('未传初始值时渲染 16px 的数值输入与提示', /** 默认值缺失或提示丢失会让用户不知道当前字号是多少。 */ () => {
    const wrapper = mount(FontSize);
    mounted = wrapper;
    const input = wrapper.get('input');

    expect((input.element as HTMLInputElement).value).toBe('16');
    expect(input.attributes('role')).toBe('spinbutton');
    expect(input.attributes('aria-valuemin')).toBe('15');
    expect(input.attributes('aria-valuemax')).toBe('22');
    expect(wrapper.text()).toContain('px');
    expect(wrapper.text()).toContain('调整全局字体大小，实时预览效果');
  });

  it('点击加号按步长写回更大的字号', /** 加号写回断开会让用户无法放大全局字号。 */ async () => {
    const { fontSize, wrapper } = mountFontSize(16);

    await stepFontSize(wrapper, 'increment');

    expect(fontSize.value).toBe(17);
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('17');
  });

  it('点击减号按步长写回更小的字号', /** 减号写回断开会让用户无法缩小全局字号。 */ async () => {
    const { fontSize, wrapper } = mountFontSize(16);

    await stepFontSize(wrapper, 'decrement');

    expect(fontSize.value).toBe(15);
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('15');
  });

  it('在输入框里手输字号并失焦后写回', /** 手输不回写会让用户敲进去的字号被丢弃。 */ async () => {
    const { fontSize, wrapper } = mountFontSize(16);
    const input = wrapper.get('input');

    await input.setValue('18');
    await input.trigger('blur');
    await nextTick();

    expect(fontSize.value).toBe(18);
  });

  it('父级下发低于下限的字号时钳制到 15', /** 钳制失效会让历史配置把界面缩到看不清。 */ async () => {
    const { fontSize, wrapper } = mountFontSize(16);

    fontSize.value = 3;
    await nextTick();
    await nextTick();

    expect(fontSize.value).toBe(15);
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('15');
  });

  it('父级下发高于上限的字号时钳制到 22', /** 钳制失效会让历史配置把界面撑到溢出。 */ async () => {
    const { fontSize, wrapper } = mountFontSize(16);

    fontSize.value = 99;
    await nextTick();
    await nextTick();

    expect(fontSize.value).toBe(22);
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('22');
  });
});
