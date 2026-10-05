/**
 * 偏好设置-布局预设区块（widgets/preferences/blocks/layout/layout.vue）真实交互回归。
 *
 * 该区块用七张预览卡片控制整体布局：卡片漏渲染会让用户选不到某种布局，写回断开会让布局停在旧值，
 * 选中态算错会让用户看不出当前布局，提示气泡失效会让用户不知道每种布局的含义。用例真实点击每张
 * 预览卡片、真实聚焦帮助图标，并断言写回载荷、选中态与真实提示文案。
 */
import type { LayoutType } from '@vben/types';

import { mount } from '@vue/test-utils';
import { createApp, defineComponent, h, ref } from 'vue';

import { setupI18n } from '@vben/locales';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import PreferenceLayout from './layout.vue';

/** 七张预设卡片按渲染顺序对应的布局类型与卡片文案。 */
const PRESETS: Array<{ label: string; tip: string; type: LayoutType }> = [
  { label: '垂直', tip: '侧边垂直菜单模式', type: 'sidebar-nav' },
  { label: '双列菜单', tip: '垂直双列菜单模式', type: 'sidebar-mixed-nav' },
  {
    label: '水平',
    tip: '水平菜单模式，菜单全部显示在顶部',
    type: 'header-nav',
  },
  {
    label: '侧边导航',
    tip: '顶部通栏，侧边导航模式',
    type: 'header-sidebar-nav',
  },
  { label: '混合垂直', tip: '垂直水平菜单共存', type: 'mixed-nav' },
  {
    label: '混合双列',
    tip: '双列、水平菜单共存模式',
    type: 'header-mixed-nav',
  },
  {
    label: '内容全屏',
    tip: '不显示任何菜单，只显示内容主体',
    type: 'full-content',
  },
];

/** 每个用例挂载的宿主，用例结束后统一卸载并清理提示传送节点。 */
let mounted: ReturnType<typeof mount> | undefined;

afterEach(
  /** 卸载宿主并清理提示气泡传送节点，避免残留影响后续用例。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    document.body.innerHTML = '';
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
  /** 按真实 API 装载中文语言包，卡片文案与提示文案都取自真实语言包。 */ async () => {
    await setupI18n(createAppHost(), { defaultLocale: 'zh-CN' });
  },
);

/**
 * 用真实双向绑定串起布局预设。
 * @param initialLayout 宿主传入的初始布局类型。
 * @returns 布局本地状态与已挂载宿主。
 */
function mountLayout(initialLayout?: LayoutType) {
  const appLayout = ref(initialLayout);
  const wrapper = mount(
    defineComponent({
      /**
       * 渲染带真实双向绑定的布局预设区块。
       * @returns 渲染函数，返回绑定到本地状态的布局预设区块。
       */
      setup() {
        return /** 返回绑定到本地状态的布局预设区块。 */ () =>
          h(PreferenceLayout, {
            modelValue: appLayout.value,
            /** 写回选中的布局类型。 */
            'onUpdate:modelValue': (value: LayoutType) => {
              appLayout.value = value;
            },
          });
      },
    }),
  );
  mounted = wrapper;
  return { appLayout, wrapper };
}

describe('布局预设偏好', /** 卡片渲染、写回与提示决定用户能否正确切换整体布局。 */ () => {
  it('渲染七张带预览图形的预设卡片', /** 卡片或预览图形缺失会让用户选不到某种布局。 */ () => {
    const { wrapper } = mountLayout('sidebar-nav');
    const cards = wrapper.findAll('.outline-box');

    expect(cards).toHaveLength(PRESETS.length);
    for (const [index, preset] of PRESETS.entries()) {
      expect(wrapper.text()).toContain(preset.label);
      // 预览图是卡片上唯一的可视标识，缺失会让七种布局看起来一模一样。
      expect(cards[index]?.find('svg').exists()).toBe(true);
    }
    expect(cards[0]?.classes()).toContain('outline-box-active');
    expect(cards[1]?.classes()).not.toContain('outline-box-active');
  });

  it('未传初始值时默认选中垂直布局', /** 默认值缺失会让首次打开抽屉的用户看不到选中项。 */ () => {
    const { wrapper } = mountLayout();
    const cards = wrapper.findAll('.outline-box');

    expect(cards[0]?.classes()).toContain('outline-box-active');
    // 未点击任何卡片时不得向外写回，否则默认布局会被无谓覆盖。
    expect(
      wrapper.findComponent(PreferenceLayout).emitted('update:modelValue'),
    ).toBeUndefined();
  });

  it('逐张点击预设卡片写回对应布局并移动选中态', /** 写回断开或串位会让用户选的布局与生效布局不一致。 */ async () => {
    const { appLayout, wrapper } = mountLayout('sidebar-nav');
    const cards = wrapper.findAll('.outline-box');

    for (const [index, preset] of PRESETS.entries()) {
      await cards[index]?.trigger('click');

      expect(appLayout.value).toBe(preset.type);
      expect(cards[index]?.classes()).toContain('outline-box-active');
      for (const [otherIndex, otherCard] of cards.entries()) {
        if (otherIndex !== index) {
          expect(otherCard.classes()).not.toContain('outline-box-active');
        }
      }
    }
  });

  it('聚焦帮助图标时渲染该布局的真实提示文案', /** 提示失效会让用户不知道每种布局的实际表现。 */ async () => {
    const { wrapper } = mountLayout();
    const helps = wrapper.findAll('.cursor-help');

    // 每张卡片都有说明气泡，缺失会让用户在多种布局之间无从判断。
    expect(helps).toHaveLength(PRESETS.length);
    const mixed = PRESETS[4];
    expect(mixed).toBeDefined();

    await helps[4]?.trigger('focus');

    await vi.waitFor(
      /** 等待提示气泡真实渲染出该布局的说明文案。 */ () => {
        expect(document.body.textContent).toContain(mixed?.tip);
      },
      { timeout: 2000 },
    );
  });
});
