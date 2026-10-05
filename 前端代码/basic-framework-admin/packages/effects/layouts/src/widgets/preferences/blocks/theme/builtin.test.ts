/**
 * 偏好设置-内置主题色板（preferences/blocks/theme/builtin.vue）真实交互回归。
 *
 * 色板把内置主题与自定义取色器渲染成一排候选：点选必须写回主题类型并把当前主题色写入
 * themeColorPrimary（暗色下取该主题的 darkPrimaryColor），自定义取色器必须能唤起系统取色并把
 * 选中的颜色换算成 HSL；这些链路任一处断开，用户选了主题却看不到颜色变化，或自定义取色被主题
 * 类型切换悄悄覆盖。用例真实点击色板、真实触发取色器 input 事件并断言写回载荷与选中态。
 */
import { DOMWrapper, mount } from '@vue/test-utils';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';

import { setupI18n } from '@vben/locales';
import { BUILT_IN_THEME_PRESETS } from '@vben/preferences';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import BuiltinTheme from './builtin.vue';

/** 每个用例挂载的宿主，用例结束后统一卸载。 */
let mounted: ReturnType<typeof mount> | undefined;

afterEach(
  /** 卸载宿主并还原被替换的方法。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    vi.restoreAllMocks();
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
  /** 按真实 API 装载中文语言包，主题名文案取自真实语言包。 */ async () => {
    await setupI18n(createAppHost(), { defaultLocale: 'zh-CN' });
  },
);

/**
 * 用真实双向绑定串起主题类型、主题色与暗色标记。
 * @param modelValue 初始主题类型。
 * @param themeColorPrimary 初始主题色。
 * @param isDark 初始是否处于暗色模式。
 * @returns 三个输入项的本地状态与已挂载宿主。
 */
function mountBuiltin(
  modelValue = 'default',
  themeColorPrimary: string | undefined = 'hsl(212 100% 45%)',
  isDark = false,
) {
  const themeBuiltinType = ref(modelValue);
  const primaryColor = ref(themeColorPrimary);
  const dark = ref(isDark);
  const wrapper = mount(
    defineComponent({
      /**
       * 渲染带真实双向绑定的内置主题色板。
       * @returns 渲染函数，返回绑定到本地状态的内置主题色板。
       */
      setup() {
        return /** 返回绑定到本地状态的内置主题色板。 */ () =>
          h(BuiltinTheme, {
            isDark: dark.value,
            modelValue: themeBuiltinType.value,
            themeColorPrimary: primaryColor.value,
            /** 写回选中的主题类型。 */
            'onUpdate:modelValue': (value: string) => {
              themeBuiltinType.value = value;
            },
            /** 写回主题色。 */
            'onUpdate:themeColorPrimary': (value: string | undefined) => {
              primaryColor.value = value ?? '';
            },
          });
      },
    }),
  );
  mounted = wrapper;
  return { dark, primaryColor, themeBuiltinType, wrapper };
}

/**
 * 按主题类型定位色板上的候选卡片。
 * @param type 主题类型。
 * @returns 命中候选卡片的索引，未找到时为 -1。
 */
function presetIndex(type: string) {
  return BUILT_IN_THEME_PRESETS.findIndex(
    /** 按主题类型匹配预设顺序。 */ (preset) => preset.type === type,
  );
}

describe('内置主题色板', /** 主题类型与主题色的写回决定用户选的主题能否真正生效。 */ () => {
  it('渲染全部内置主题与自定义取色器', /** 预设漏渲染会让用户选不到某个主题；取色器缺失会让自定义主题无法配色。 */ () => {
    const wrapper = mount(BuiltinTheme, {
      props: {
        isDark: false,
        modelValue: 'default',
        themeColorPrimary: 'hsl(212 100% 45%)',
      },
    });
    mounted = wrapper;
    const boxes = wrapper.findAll('.outline-box');

    expect(boxes).toHaveLength(BUILT_IN_THEME_PRESETS.length);
    expect(wrapper.text()).toContain('默认');
    expect(wrapper.text()).toContain('紫罗兰');
    expect(wrapper.text()).toContain('自定义');
    expect(boxes[0]?.classes()).toContain('outline-box-active');
    expect(boxes[1]?.classes()).not.toContain('outline-box-active');
    expect(wrapper.find('input[type="color"]').exists()).toBe(true);
  });

  it('未配置主题色时取色器回退到黑色而不是抛错', /** 回退缺失会让未配过色的用户一打开面板就报错或拿到空色值。 */ () => {
    const wrapper = mount(BuiltinTheme, {
      props: { isDark: false, modelValue: 'custom', themeColorPrimary: '' },
    });
    mounted = wrapper;

    expect(
      (wrapper.get('input[type="color"]').element as HTMLInputElement).value,
    ).toBe('#000000');
  });

  it('点击内置主题写回类型与该主题的浅色主题色', /** 写回断开会让用户选了主题却看不到颜色变化。 */ async () => {
    const { primaryColor, themeBuiltinType, wrapper } = mountBuiltin(
      'default',
      'hsl(212 100% 45%)',
      false,
    );
    const zinc = presetIndex('zinc');
    const boxes = wrapper.findAll('.outline-box');

    await boxes[zinc]?.trigger('click');

    expect(themeBuiltinType.value).toBe('zinc');
    expect(primaryColor.value).toBe('hsl(240 5.9% 10%)');
    expect(boxes[zinc]?.classes()).toContain('outline-box-active');
    expect(boxes[0]?.classes()).not.toContain('outline-box-active');
    expect(wrapper.text()).toContain('锌色灰');
  });

  it('暗色模式下取该主题的暗色主题色', /** 暗色下沿用浅色主题色会得到看不清的对比度。 */ async () => {
    const { dark, primaryColor, wrapper } = mountBuiltin(
      'zinc',
      'hsl(240 5.9% 10%)',
      false,
    );

    dark.value = true;
    await nextTick();

    expect(primaryColor.value).toBe('hsl(0 0% 98%)');
    expect(
      (wrapper.get('input[type="color"]').element as HTMLInputElement).value,
    ).toBe('#fafafa');
  });

  it('点击自定义主题写回 custom 并清空主题色', /** 自定义主题不继承上一个主题的颜色，否则用户会拿到错误的自定义起点。 */ async () => {
    const { primaryColor, themeBuiltinType, wrapper } = mountBuiltin(
      'default',
      'hsl(212 100% 45%)',
      false,
    );
    const custom = presetIndex('custom');

    await wrapper.findAll('.outline-box')[custom]?.trigger('click');
    await nextTick();

    expect(themeBuiltinType.value).toBe('custom');
    expect(primaryColor.value).toBe('');
    expect(
      (wrapper.get('input[type="color"]').element as HTMLInputElement).value,
    ).toBe('#000000');
  });

  it('自定义主题下切换暗色标记不覆盖用户已选颜色', /** 覆盖会让用户在暗色模式下丢失刚取好的自定义色。 */ async () => {
    const { dark, primaryColor, wrapper } = mountBuiltin(
      'custom',
      'hsl(120 100% 50%)',
      false,
    );

    dark.value = true;
    await nextTick();

    expect(primaryColor.value).toBe('hsl(120 100% 50%)');
    expect(
      (wrapper.get('input[type="color"]').element as HTMLInputElement).value,
    ).toBe('#00ff00');
  });

  it('点击自定义取色区唤起系统取色且不改动主题类型', /** 取色区点击冒泡会让用户每次取色都被重置回默认主题。 */ async () => {
    const { themeBuiltinType, wrapper } = mountBuiltin(
      'default',
      'hsl(212 100% 45%)',
      false,
    );
    const colorInput = wrapper.get('input[type="color"]');
    // 原生取色器是浏览器外部能力；happy-dom 的 click() 不实现"点击进行中"标志，
    // 真实派发取色点击会与组件的冒泡处理互相调用形成无限递归，这里只替换派发本身。
    const clickSpy = vi
      .spyOn(colorInput.element as HTMLInputElement, 'click')
      .mockImplementation(
        /** 只记录取色唤起动作，不再真实派发会递归的点击事件。 */ () => {},
      );
    const pickerArea = colorInput.element.closest('.size-full');
    expect(pickerArea).not.toBeNull();

    if (pickerArea) {
      await new DOMWrapper(pickerArea as HTMLElement).trigger('click');
    }

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(themeBuiltinType.value).toBe('default');
  });

  it('取色器选中颜色后换算成 HSL 主题色写回', /** 不换算或不回写会让用户在取色器里选的颜色完全无效。 */ async () => {
    const { primaryColor, wrapper } = mountBuiltin(
      'custom',
      'hsl(212 100% 45%)',
      false,
    );
    const colorInput = wrapper.get('input[type="color"]');

    await colorInput.setValue('#00ff00');

    await vi.waitFor(
      /** 等待节流后的取色结果真实写回主题色。 */ () => {
        expect(primaryColor.value).toBe('hsl(120 100% 50%)');
      },
      { timeout: 2000 },
    );
    expect(
      (wrapper.get('input[type="color"]').element as HTMLInputElement).value,
    ).toBe('#00ff00');
  });
});
