/**
 * 偏好设置-侧边栏配置区块（widgets/preferences/blocks/layout/sidebar.vue）真实交互回归。
 *
 * 该区块用开关、按钮组和数值输入控制侧边栏：开关写反会让用户开不出想要的侧边栏行为，按钮组与
 * 折叠/固定开关之间的双向同步算错会让界面勾选态与实际按钮配置不一致，数值步进写回断开会让宽度
 * 调不动，依赖禁用漏传会让折叠前的悬停展开等项被随意改动。用例真实点击每个控件并断言写回载荷。
 */
import { mount } from '@vue/test-utils';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';

import { setupI18n } from '@vben/locales';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import CheckboxItem from '../checkbox-item.vue';
import NumberFieldItem from '../number-field-item.vue';
import SwitchItem from '../switch-item.vue';
import PreferenceSidebarConfig from './sidebar.vue';

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
  /** 按真实 API 装载中文语言包，配置项文案与按钮文案都取自真实语言包。 */ async () => {
    await setupI18n(createAppHost(), { defaultLocale: 'zh-CN' });
  },
);

/**
 * 用真实双向绑定串起侧边栏配置偏好，按钮集合按真实抽屉的做法交给区块内部维护。
 * @param options 可选的禁用状态与初始按钮配置。
 * @returns 各偏好的本地状态、区块组件与已挂载宿主。
 */
function mountSidebarConfig(
  options: { disabled?: boolean; sidebarButtons?: string[] } = {},
) {
  const sidebarEnable = ref<boolean | undefined>(true);
  const sidebarWidth = ref<number | undefined>(224);
  const sidebarCollapsed = ref<boolean | undefined>(true);
  const sidebarCollapsedShowTitle = ref<boolean | undefined>(false);
  const sidebarExpandOnHover = ref<boolean | undefined>(true);
  const sidebarCollapsedButton = ref<boolean | undefined>(true);
  const sidebarFixedButton = ref<boolean | undefined>(true);
  const wrapper = mount(
    defineComponent({
      /**
       * 渲染带真实双向绑定的侧边栏配置区块。
       * @returns 渲染函数，返回绑定到本地状态的侧边栏配置区块。
       */
      setup() {
        return /** 返回绑定到本地状态的侧边栏配置区块。 */ () =>
          h(PreferenceSidebarConfig, {
            disabled: options.disabled ?? false,
            sidebarButtons: options.sidebarButtons,
            sidebarCollapsed: sidebarCollapsed.value,
            sidebarCollapsedButton: sidebarCollapsedButton.value,
            sidebarCollapsedShowTitle: sidebarCollapsedShowTitle.value,
            sidebarEnable: sidebarEnable.value,
            sidebarExpandOnHover: sidebarExpandOnHover.value,
            sidebarFixedButton: sidebarFixedButton.value,
            sidebarWidth: sidebarWidth.value,
            /** 写回折叠偏好的按钮开关。 */
            'onUpdate:sidebarCollapsedButton': (value: boolean | undefined) => {
              sidebarCollapsedButton.value = value;
            },
            /** 写回折叠菜单偏好。 */
            'onUpdate:sidebarCollapsed': (value: boolean | undefined) => {
              sidebarCollapsed.value = value;
            },
            /** 写回折叠显示菜单名偏好。 */
            'onUpdate:sidebarCollapsedShowTitle': (
              value: boolean | undefined,
            ) => {
              sidebarCollapsedShowTitle.value = value;
            },
            /** 写回侧边栏显隐偏好。 */
            'onUpdate:sidebarEnable': (value: boolean | undefined) => {
              sidebarEnable.value = value;
            },
            /** 写回鼠标悬停展开偏好。 */
            'onUpdate:sidebarExpandOnHover': (value: boolean | undefined) => {
              sidebarExpandOnHover.value = value;
            },
            /** 写回固定按钮开关。 */
            'onUpdate:sidebarFixedButton': (value: boolean | undefined) => {
              sidebarFixedButton.value = value;
            },
            /** 写回侧边栏宽度偏好。 */
            'onUpdate:sidebarWidth': (value: number | undefined) => {
              sidebarWidth.value = value;
            },
          });
      },
    }),
  );
  mounted = wrapper;
  return {
    config: wrapper.findComponent(PreferenceSidebarConfig),
    sidebarCollapsed,
    sidebarCollapsedButton,
    sidebarCollapsedShowTitle,
    sidebarEnable,
    sidebarExpandOnHover,
    sidebarFixedButton,
    sidebarWidth,
    wrapper,
  };
}

describe('侧边栏配置偏好', /** 控件写回与按钮组同步决定侧边栏能否被正确配置。 */ () => {
  it('渲染全部侧边栏配置项与提示图标', /** 配置项缺失会让用户改不了对应的侧边栏行为。 */ () => {
    const { wrapper } = mountSidebarConfig();

    for (const label of [
      '显示侧边栏',
      '折叠菜单',
      '鼠标悬停展开',
      '折叠显示菜单名',
      '显示按钮',
      '折叠按钮',
      '固定按钮',
      '宽度',
    ]) {
      expect(wrapper.text()).toContain(label);
    }
    expect(wrapper.find('.cursor-help').exists()).toBe(true);
    expect(wrapper.find('[data-slot="increment"]').exists()).toBe(true);
  });

  it('按钮组与折叠、固定开关一致时不重复写回', /** 重复写回会让按钮组配置在每次渲染后被无谓覆盖。 */ () => {
    const { config, wrapper } = mountSidebarConfig({
      sidebarButtons: ['collapsed', 'fixed'],
    });

    expect(wrapper.findAllComponents(SwitchItem)).toHaveLength(4);
    // 初始按钮配置与两个开关完全一致，watch 必须判定为相同而不产生多余写回。
    expect(config.emitted('update:sidebarButtons')).toBeUndefined();
  });

  it('按钮配置与开关不一致时按开关重算按钮集合', /** 不一致时不同步会让界面勾选态与实际按钮配置长期偏离。 */ () => {
    const { config } = mountSidebarConfig({
      sidebarButtons: ['collapsed', 'extra'],
    });

    expect(config.emitted('update:sidebarButtons')).toEqual([
      [['collapsed', 'fixed']],
    ]);
  });

  it('按钮配置少于开关数量时补齐按钮集合', /** 数量不符却判定为相同会让缺失的按钮永远补不回来。 */ () => {
    const { config } = mountSidebarConfig({ sidebarButtons: [] });

    expect(config.emitted('update:sidebarButtons')).toEqual([
      [['collapsed', 'fixed']],
    ]);
  });

  it('点击折叠按钮真实同步按钮集合与折叠开关', /** 按钮组点击不同步会让勾选态与开关互相打架。 */ async () => {
    const { config, sidebarCollapsedButton, sidebarFixedButton, wrapper } =
      mountSidebarConfig();
    const buttons = wrapper.getComponent(CheckboxItem).findAll('button');
    expect(buttons).toHaveLength(2);

    await buttons[0]?.trigger('click');
    await nextTick();

    expect(config.emitted('update:sidebarButtons')?.at(-1)).toEqual([
      ['fixed'],
    ]);
    expect(sidebarCollapsedButton.value).toBe(false);
    expect(sidebarFixedButton.value).toBe(true);
  });

  it('点击固定按钮真实同步按钮集合与固定开关', /** 固定按钮点击无效会让用户关不掉侧边栏固定按钮。 */ async () => {
    const { config, sidebarFixedButton, wrapper } = mountSidebarConfig();
    const buttons = wrapper.getComponent(CheckboxItem).findAll('button');

    await buttons[1]?.trigger('click');
    await nextTick();

    expect(config.emitted('update:sidebarButtons')?.at(-1)).toEqual([
      ['collapsed'],
    ]);
    expect(sidebarFixedButton.value).toBe(false);
  });

  it('逐个点击开关翻转对应偏好', /** 开关串位会让用户改一项却动了另一项侧边栏配置。 */ async () => {
    const {
      sidebarCollapsed,
      sidebarCollapsedShowTitle,
      sidebarEnable,
      sidebarExpandOnHover,
      wrapper,
    } = mountSidebarConfig();
    const switches = wrapper.findAllComponents(SwitchItem);
    expect(switches).toHaveLength(4);

    await switches[2]?.trigger('click');
    expect(sidebarExpandOnHover.value).toBe(false);

    await switches[3]?.trigger('click');
    expect(sidebarCollapsedShowTitle.value).toBe(true);

    await switches[1]?.trigger('click');
    expect(sidebarCollapsed.value).toBe(false);

    await switches[0]?.trigger('click');
    expect(sidebarEnable.value).toBe(false);
  });

  it('点击加号按步长写回侧边栏宽度', /** 步进写回断开会让用户点加号却没有反应。 */ async () => {
    const { sidebarWidth, wrapper } = mountSidebarConfig();
    // 步进按钮的指针监听在挂载后一拍才绑到真实按钮上，先等待挂载完成。
    await nextTick();
    const increment = wrapper
      .getComponent(NumberFieldItem)
      .get('[data-slot="increment"]');

    await increment.trigger('pointerdown', { button: 0 });
    await increment.trigger('pointerup');
    await nextTick();

    // 224 加一个步长后，reka-ui 会把结果吸附到以 min 为基准的步长网格上，得到 230。
    expect(sidebarWidth.value).toBe(230);
    expect((sidebarWidth.value ?? 0) % 10).toBe(0);
  });

  it('聚焦提示图标时渲染悬停展开的真实说明', /** 提示失效会让用户不知道折叠后悬停会发生什么。 */ async () => {
    const { wrapper } = mountSidebarConfig();

    await wrapper.get('.cursor-help').trigger('focus');

    await vi.waitFor(
      /** 等待提示气泡真实渲染出悬停展开说明。 */ () => {
        expect(document.body.textContent).toContain('鼠标在折叠区域悬浮时');
      },
      { timeout: 2000 },
    );
  });

  it('未折叠时悬停展开与折叠标题进入禁用态', /** 依赖禁用失效会让用户改到当前折叠状态下无效的配置。 */ async () => {
    const { sidebarCollapsed, wrapper } = mountSidebarConfig();
    const switches = wrapper.findAllComponents(SwitchItem);

    await switches[1]?.trigger('click');

    expect(sidebarCollapsed.value).toBe(false);
    expect(switches[2]?.classes()).toContain('pointer-events-none');
    expect(switches[3]?.classes()).toContain('pointer-events-none');
  });

  it('区块禁用时全部开关与宽度输入进入禁用态', /** 非侧边布局下仍可改侧边栏会让用户改出无效配置。 */ () => {
    const wrapper = mount(PreferenceSidebarConfig, {
      props: {
        disabled: true,
        sidebarCollapsed: true,
        sidebarEnable: true,
        sidebarWidth: 224,
      },
    });
    mounted = wrapper;

    for (const item of wrapper.findAllComponents(SwitchItem)) {
      expect(item.classes()).toContain('pointer-events-none');
    }
    expect(wrapper.getComponent(NumberFieldItem).classes()).toContain(
      'pointer-events-none',
    );
    // 禁用只拦截交互，当前配置必须照常渲染出来。
    expect(wrapper.text()).toContain('显示侧边栏');
  });
});
