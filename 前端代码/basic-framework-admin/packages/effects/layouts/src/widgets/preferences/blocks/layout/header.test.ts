/**
 * 偏好设置-顶栏配置区块（widgets/preferences/blocks/layout/header.vue）真实交互回归。
 *
 * 该区块把顶栏显隐、顶栏模式与菜单位置三个偏好交给真实控件：显隐开关写反会让用户关不掉顶栏，
 * 模式下拉写回断开会让顶栏模式停在旧值，菜单位置写回断开会让菜单对齐方式改不动，禁用属性漏传
 * 会让顶栏隐藏后仍能继续改模式。用例真实点击开关、真实展开下拉选中模式、真实点击位置按钮。
 */
import type {
  LayoutHeaderMenuAlignType,
  LayoutHeaderModeType,
} from '@vben/types';

import { mount } from '@vue/test-utils';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';

import { setupI18n } from '@vben/locales';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import SelectItem from '../select-item.vue';
import SwitchItem from '../switch-item.vue';
import ToggleItem from '../toggle-item.vue';
import PreferenceHeaderConfig from './header.vue';

/** 每个用例挂载的宿主，用例结束后统一卸载并清理下拉传送节点。 */
let mounted: ReturnType<typeof mount> | undefined;

afterEach(
  /** 卸载宿主并清理下拉面板传送节点，避免残留影响后续用例。 */ () => {
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
  /** 按真实 API 装载中文语言包，配置项文案与下拉选项都取自真实语言包。 */ async () => {
    await setupI18n(createAppHost(), { defaultLocale: 'zh-CN' });
  },
);

/**
 * 用真实双向绑定串起顶栏配置的三个偏好。
 * @param options 可选的初始顶栏显隐状态。
 * @returns 三个偏好的本地状态与已挂载宿主。
 */
function mountHeaderConfig(options: { headerEnable?: boolean } = {}) {
  const headerEnable = ref<boolean | undefined>(options.headerEnable ?? true);
  const headerMode = ref<LayoutHeaderModeType | undefined>('static');
  const headerMenuAlign = ref<LayoutHeaderMenuAlignType | undefined>('start');
  const wrapper = mount(
    defineComponent({
      /**
       * 渲染带真实双向绑定的顶栏配置区块。
       * @returns 渲染函数，返回绑定到本地状态的顶栏配置区块。
       */
      setup() {
        return /** 返回绑定到本地状态的顶栏配置区块。 */ () =>
          h(PreferenceHeaderConfig, {
            disabled: false,
            headerEnable: headerEnable.value,
            headerMenuAlign: headerMenuAlign.value,
            headerMode: headerMode.value,
            /** 写回顶栏显隐状态。 */
            'onUpdate:headerEnable': (value: boolean | undefined) => {
              headerEnable.value = value;
            },
            /** 写回菜单位置。 */
            'onUpdate:headerMenuAlign': (
              value: LayoutHeaderMenuAlignType | undefined,
            ) => {
              headerMenuAlign.value = value;
            },
            /** 写回顶栏模式。 */
            'onUpdate:headerMode': (
              value: LayoutHeaderModeType | undefined,
            ) => {
              headerMode.value = value;
            },
          });
      },
    }),
  );
  mounted = wrapper;
  return { headerEnable, headerMenuAlign, headerMode, wrapper };
}

/**
 * 展开顶栏模式下拉并真实选中一项。
 * @param wrapper 已挂载的顶栏配置宿主。
 * @param optionLabel 目标下拉项文案。
 * @returns 选中写回后的 Promise。
 */
async function selectMode(
  wrapper: ReturnType<typeof mount>,
  optionLabel: string,
) {
  const trigger = wrapper.get('[role="combobox"]');

  await trigger.trigger('click');
  await trigger.trigger('keydown', { key: 'ArrowDown' });
  await vi.waitFor(
    /** 等待顶栏模式的全部下拉项真实渲染。 */ () => {
      expect(document.querySelectorAll('[role="option"]')).toHaveLength(4);
    },
    { timeout: 2000 },
  );

  const option = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find(
    /** 按文案定位目标下拉项。 */ (element) =>
      element.textContent?.includes(optionLabel),
  );
  expect(option).toBeDefined();
  if (option) {
    // 下拉项走真实指针链路提交选择：reka-ui 在 pointerup 上写回取值。
    option.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0 }),
    );
    option.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, button: 0 }),
    );
    option.click();
  }
  await vi.waitFor(
    /** 等待选中结果真实回显到下拉触发器。 */ () => {
      expect(trigger.text()).toContain(optionLabel);
    },
    { timeout: 2000 },
  );
}

describe('顶栏配置偏好', /** 三个绑定的写回与禁用决定顶栏能否被正确配置。 */ () => {
  it('渲染显隐开关、模式下拉与菜单位置按钮组', /** 控件或文案缺失会让用户无法配置顶栏。 */ async () => {
    const { wrapper } = mountHeaderConfig();
    const toggle = wrapper.getComponent(ToggleItem);
    // reka-ui 的下拉在挂载后一拍才把选中项文案注册进触发器。
    await nextTick();

    expect(wrapper.text()).toContain('显示顶栏');
    expect(toggle.text()).toContain('菜单位置');
    expect(toggle.text()).toContain('左侧');
    expect(toggle.text()).toContain('居中');
    expect(toggle.text()).toContain('右侧');
    // 未选择过模式时下拉展示当前模式文案，说明已按真实取值回显。
    expect(wrapper.get('[role="combobox"]').text()).toContain('静止');
  });

  it('点击开关翻转顶栏显隐状态', /** 开关方向写反会让用户关不掉顶栏。 */ async () => {
    const { headerEnable, wrapper } = mountHeaderConfig();

    await wrapper.getComponent(SwitchItem).trigger('click');

    expect(headerEnable.value).toBe(false);
    expect(
      wrapper
        .findComponent(PreferenceHeaderConfig)
        .emitted('update:headerEnable'),
    ).toEqual([[false]]);
  });

  it('展开模式下拉并选中后写回顶栏模式', /** 下拉写回断开会让顶栏模式停在旧值。 */ async () => {
    const { headerMode, wrapper } = mountHeaderConfig();

    await selectMode(wrapper, '滚动隐藏和显示');

    expect(headerMode.value).toBe('auto-scroll');
  });

  it('点击菜单位置按钮写回菜单对齐方式', /** 位置写回断开会让菜单对齐方式改不动。 */ async () => {
    const { headerMenuAlign, wrapper } = mountHeaderConfig();
    const options = wrapper.getComponent(ToggleItem).findAll('button');

    expect(options).toHaveLength(3);
    await options[1]?.trigger('click');

    expect(headerMenuAlign.value).toBe('center');
    expect(options[1]?.attributes('data-state')).toBe('on');
    expect(options[0]?.attributes('data-state')).toBe('off');
  });

  it('顶栏关闭后模式与菜单位置进入禁用态', /** 禁用失效会让用户继续改已隐藏顶栏的模式。 */ async () => {
    const { headerEnable, wrapper } = mountHeaderConfig();

    await wrapper.getComponent(SwitchItem).trigger('click');

    expect(headerEnable.value).toBe(false);
    expect(wrapper.getComponent(SelectItem).classes()).toContain(
      'pointer-events-none',
    );
    expect(wrapper.getComponent(ToggleItem).classes()).toContain(
      'pointer-events-none',
    );
  });

  it('禁用属性真实落到显隐开关上且不影响只读渲染', /** 布局不支持顶栏时开关仍可点会让用户改出无效配置。 */ () => {
    const wrapper = mount(PreferenceHeaderConfig, {
      props: { disabled: true, headerEnable: true },
    });
    mounted = wrapper;

    expect(wrapper.getComponent(SwitchItem).classes()).toContain(
      'pointer-events-none',
    );
    // 只读状态下控件必须照常渲染，否则用户看不到当前顶栏配置。
    expect(wrapper.text()).toContain('显示顶栏');
    expect(wrapper.findAll('button').length).toBeGreaterThan(0);
  });
});
