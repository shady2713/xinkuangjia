/**
 * 偏好设置-内容区宽度区块（preferences/blocks/layout/content.vue）真实交互回归。
 *
 * 该区块用流式、定宽两张预览卡片控制内容区宽度：卡片漏渲染会让用户选不到对应宽度，
 * 写回断开会让内容区宽度与抽屉里的选中态不一致，预览图标缺失会让卡片变成空白。
 * 用例真实点击两张卡片并断言写回载荷、选中态与真实预览图形。
 */
import { mount } from '@vue/test-utils';
import { createApp, defineComponent, h, ref } from 'vue';

import { setupI18n } from '@vben/locales';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import Content from './content.vue';

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
  /** 按真实 API 装载中文语言包，卡片文案取自真实语言包。 */ async () => {
    await setupI18n(createAppHost(), { defaultLocale: 'zh-CN' });
  },
);

/**
 * 用真实双向绑定串起内容区宽度。
 * @param initialContentCompact 初始内容区宽度类型。
 * @returns 内容区宽度本地状态与已挂载宿主。
 */
function mountContent(initialContentCompact = 'wide') {
  const contentCompact = ref(initialContentCompact);
  const wrapper = mount(
    defineComponent({
      /**
       * 渲染带真实双向绑定的内容区宽度区块。
       * @returns 渲染函数，返回绑定到本地状态的内容区宽度区块。
       */
      setup() {
        return /** 返回绑定到本地状态的内容区宽度区块。 */ () =>
          h(Content, {
            modelValue: contentCompact.value,
            /** 写回选中的内容区宽度类型。 */
            'onUpdate:modelValue': (value: string) => {
              contentCompact.value = value;
            },
          });
      },
    }),
  );
  mounted = wrapper;
  return { contentCompact, wrapper };
}

describe('内容区宽度偏好', /** 两张卡片的写回与选中态决定内容区宽度能否被正确设置。 */ () => {
  it('渲染流式与定宽两张预览卡片', /** 卡片漏渲染会让用户选不到某种内容区宽度。 */ () => {
    const { wrapper } = mountContent('wide');
    const cards = wrapper.findAll('.outline-box');

    expect(cards).toHaveLength(2);
    expect(wrapper.text()).toContain('流式');
    expect(wrapper.text()).toContain('定宽');
    expect(cards[0]?.classes()).toContain('outline-box-active');
    expect(cards[1]?.classes()).not.toContain('outline-box-active');
    // 预览图是卡片上唯一的可视标识，缺失会让两种宽度看起来一模一样。
    expect(wrapper.findAll('svg')).toHaveLength(2);
  });

  it('未传初始值时默认选中流式', /** 默认值缺失会让首次打开抽屉的用户看不到选中项。 */ () => {
    const wrapper = mount(Content);
    mounted = wrapper;
    const cards = wrapper.findAll('.outline-box');

    expect(cards[0]?.classes()).toContain('outline-box-active');
    expect(cards[1]?.classes()).not.toContain('outline-box-active');
  });

  it('点击定宽卡片写回 compact 并移动选中态', /** 写回断开会让内容区宽度与选中态不一致。 */ async () => {
    const { contentCompact, wrapper } = mountContent('wide');
    const cards = wrapper.findAll('.outline-box');

    await cards[1]?.trigger('click');

    expect(contentCompact.value).toBe('compact');
    expect(cards[1]?.classes()).toContain('outline-box-active');
    expect(cards[0]?.classes()).not.toContain('outline-box-active');
  });

  it('点击流式卡片写回 wide', /** 只能切换到定宽会让用户无法改回流式布局。 */ async () => {
    const { contentCompact, wrapper } = mountContent('compact');
    const cards = wrapper.findAll('.outline-box');

    await cards[0]?.trigger('click');

    expect(contentCompact.value).toBe('wide');
    expect(cards[0]?.classes()).toContain('outline-box-active');
  });
});
