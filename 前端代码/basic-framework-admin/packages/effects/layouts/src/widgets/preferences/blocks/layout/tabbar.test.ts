/**
 * 偏好设置-标签栏配置区块（widgets/preferences/blocks/layout/tabbar.vue）真实交互回归。
 *
 * 该区块用九个开关、一个数值输入和一个风格下拉控制标签栏：开关写反会让用户开不出想要的标签行为，
 * 数值步进写回断开会让最大标签数点不动，风格下拉断开会让标签页外观停在旧样式。用例逐个真实点击
 * 每个开关、真实步进数值、真实展开下拉选中风格，并断言每项偏好真实写回。
 */
import type { Ref } from 'vue';

import { DOMWrapper, mount } from '@vue/test-utils';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';

import { setupI18n } from '@vben/locales';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import PreferenceTabsConfig from './tabbar.vue';

/** 除启用开关外的八个开关按渲染顺序对应的行文案。 */
const SWITCH_LABELS = [
  '持久化标签页',
  '访问历史记录',
  '启动拖拽排序',
  '启用纵向滚轮响应',
  '点击鼠标中键关闭标签页',
  '显示标签栏图标',
  '显示更多按钮',
  '显示最大化按钮',
];

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
  /** 按真实 API 装载中文语言包，配置项文案与风格选项都取自真实语言包。 */ async () => {
    await setupI18n(createAppHost(), { defaultLocale: 'zh-CN' });
  },
);

/**
 * 用真实双向绑定串起标签栏配置的全部偏好。
 * @param options 可选的初始标签栏启用状态。
 * @returns 各偏好的本地状态与已挂载宿主。
 */
function mountTabsConfig(options: { tabbarEnable?: boolean } = {}) {
  // 除启用开关外，其余开关都按“已开启”起步，便于逐个点击后核对翻转结果。
  const tabbarEnable = ref<boolean | undefined>(options.tabbarEnable ?? true);
  const tabbarPersist = ref<boolean | undefined>(true);
  const tabbarVisitHistory = ref<boolean | undefined>(true);
  const tabbarDraggable = ref<boolean | undefined>(true);
  const tabbarWheelable = ref<boolean | undefined>(true);
  const tabbarMiddleClickToClose = ref<boolean | undefined>(false);
  const tabbarShowIcon = ref<boolean | undefined>(true);
  const tabbarShowMore = ref<boolean | undefined>(true);
  const tabbarShowMaximize = ref<boolean | undefined>(true);
  const tabbarMaxCount = ref<number | undefined>(0);
  const tabbarStyleType = ref<string | undefined>('chrome');
  const switches: Array<{ label: string; value: Ref<boolean | undefined> }> = [
    { label: '持久化标签页', value: tabbarPersist },
    { label: '访问历史记录', value: tabbarVisitHistory },
    { label: '启动拖拽排序', value: tabbarDraggable },
    { label: '启用纵向滚轮响应', value: tabbarWheelable },
    { label: '点击鼠标中键关闭标签页', value: tabbarMiddleClickToClose },
    { label: '显示标签栏图标', value: tabbarShowIcon },
    { label: '显示更多按钮', value: tabbarShowMore },
    { label: '显示最大化按钮', value: tabbarShowMaximize },
  ];
  const wrapper = mount(
    defineComponent({
      /**
       * 渲染带真实双向绑定的标签栏配置区块。
       * @returns 渲染函数，返回绑定到本地状态的标签栏配置区块。
       */
      setup() {
        return /** 返回绑定到本地状态的标签栏配置区块。 */ () =>
          h(PreferenceTabsConfig, {
            tabbarDraggable: tabbarDraggable.value,
            tabbarEnable: tabbarEnable.value,
            tabbarMaxCount: tabbarMaxCount.value,
            tabbarMiddleClickToClose: tabbarMiddleClickToClose.value,
            tabbarPersist: tabbarPersist.value,
            tabbarShowIcon: tabbarShowIcon.value,
            tabbarShowMaximize: tabbarShowMaximize.value,
            tabbarShowMore: tabbarShowMore.value,
            tabbarStyleType: tabbarStyleType.value,
            tabbarVisitHistory: tabbarVisitHistory.value,
            tabbarWheelable: tabbarWheelable.value,
            /** 写回拖拽排序偏好。 */
            'onUpdate:tabbarDraggable': (value: boolean | undefined) => {
              tabbarDraggable.value = value;
            },
            /** 写回标签栏启用偏好。 */
            'onUpdate:tabbarEnable': (value: boolean | undefined) => {
              tabbarEnable.value = value;
            },
            /** 写回最大标签数偏好。 */
            'onUpdate:tabbarMaxCount': (value: number | undefined) => {
              tabbarMaxCount.value = value;
            },
            /** 写回中键关闭偏好。 */
            'onUpdate:tabbarMiddleClickToClose': (
              value: boolean | undefined,
            ) => {
              tabbarMiddleClickToClose.value = value;
            },
            /** 写回持久化偏好。 */
            'onUpdate:tabbarPersist': (value: boolean | undefined) => {
              tabbarPersist.value = value;
            },
            /** 写回标签图标偏好。 */
            'onUpdate:tabbarShowIcon': (value: boolean | undefined) => {
              tabbarShowIcon.value = value;
            },
            /** 写回最大化按钮偏好。 */
            'onUpdate:tabbarShowMaximize': (value: boolean | undefined) => {
              tabbarShowMaximize.value = value;
            },
            /** 写回更多按钮偏好。 */
            'onUpdate:tabbarShowMore': (value: boolean | undefined) => {
              tabbarShowMore.value = value;
            },
            /** 写回标签页风格偏好。 */
            'onUpdate:tabbarStyleType': (value: string | undefined) => {
              tabbarStyleType.value = value;
            },
            /** 写回访问历史偏好。 */
            'onUpdate:tabbarVisitHistory': (value: boolean | undefined) => {
              tabbarVisitHistory.value = value;
            },
            /** 写回滚轮响应偏好。 */
            'onUpdate:tabbarWheelable': (value: boolean | undefined) => {
              tabbarWheelable.value = value;
            },
          });
      },
    }),
  );
  mounted = wrapper;
  return { switches, tabbarEnable, tabbarMaxCount, tabbarStyleType, wrapper };
}

/**
 * 按可见文案真实点击某个开关行。
 * @param wrapper 已挂载的标签栏配置宿主。
 * @param label 开关行文案。
 * @returns 点击完成后的 Promise。
 */
async function clickSwitchRow(
  wrapper: ReturnType<typeof mount>,
  label: string,
) {
  const rows = wrapper
    .findAll('button[role="switch"]')
    .map(
      /** 从开关按钮回退到承载整行点击事件的父节点。 */ (button) =>
        button.element.parentElement,
    )
    .filter(
      /** 只保留文案匹配的开关行。 */ (element): element is HTMLElement =>
        element?.textContent?.trim() === label,
    );
  expect(rows).toHaveLength(1);
  if (rows[0]) {
    await new DOMWrapper(rows[0]).trigger('click');
  }
  await nextTick();
  await nextTick();
}

describe('标签栏配置偏好', /** 开关、数值与风格写回决定标签栏能否被正确配置。 */ () => {
  it('渲染全部标签栏配置项与真实中文文案', /** 配置项缺失会让用户改不了对应的标签栏行为。 */ async () => {
    const { wrapper } = mountTabsConfig();
    // reka-ui 的下拉在挂载后一拍才把选中项文案注册进触发器。
    await nextTick();
    const labels = [
      '启用标签栏',
      '持久化标签页',
      '访问历史记录',
      '最大标签数',
      '启动拖拽排序',
      '启用纵向滚轮响应',
      '点击鼠标中键关闭标签页',
      '显示标签栏图标',
      '显示更多按钮',
      '显示最大化按钮',
      '标签页风格',
    ];

    for (const label of labels) {
      expect(wrapper.text()).toContain(label);
    }
    expect(wrapper.findAll('button[role="switch"]')).toHaveLength(9);
    expect(wrapper.get('[role="combobox"]').text()).toContain('谷歌');
    // 带说明的配置项必须给出提示图标，否则用户看不到取值范围。
    expect(wrapper.find('.cursor-help').exists()).toBe(true);
  });

  it('逐个点击开关翻转对应偏好', /** 开关串位或写回断开会让用户开的标签行为与预期不符。 */ async () => {
    const { switches, wrapper } = mountTabsConfig();

    expect(
      switches.map(
        /** 收集开关行文案用于核对逐项覆盖。 */ (item) => item.label,
      ),
    ).toEqual(SWITCH_LABELS);
    for (const item of switches) {
      const before = item.value.value;
      await clickSwitchRow(wrapper, item.label);

      expect(item.value.value).toBe(!before);
    }
  });

  it('点击加号按步长写回最大标签数', /** 步进写回断开会让用户点加号却没有反应。 */ async () => {
    const { tabbarMaxCount, wrapper } = mountTabsConfig();
    // 步进按钮的指针监听在挂载后一拍才绑到真实按钮上，先等待挂载完成。
    await nextTick();
    const increment = wrapper.get('[data-slot="increment"]');

    await increment.trigger('pointerdown', { button: 0 });
    await increment.trigger('pointerup');
    await nextTick();

    expect(tabbarMaxCount.value).toBe(5);
  });

  it('展开风格下拉选中后写回标签页风格', /** 风格下拉断开会让标签页外观停在旧样式。 */ async () => {
    const { tabbarStyleType, wrapper } = mountTabsConfig();
    const trigger = wrapper.get('[role="combobox"]');

    await trigger.trigger('click');
    await trigger.trigger('keydown', { key: 'ArrowDown' });
    await vi.waitFor(
      /** 等待四种标签页风格真实渲染。 */ () => {
        expect(document.querySelectorAll('[role="option"]')).toHaveLength(4);
      },
      { timeout: 2000 },
    );

    const option = [
      ...document.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find(
      /** 按文案定位轻快风格。 */ (element) =>
        element.textContent?.includes('轻快'),
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
      /** 等待轻快风格真实写回。 */ () => {
        expect(tabbarStyleType.value).toBe('brisk');
      },
      { timeout: 2000 },
    );
    expect(trigger.text()).toContain('轻快');
  });

  it('关闭启用标签栏后其余配置项进入禁用态', /** 禁用失效会让用户继续改已关闭标签栏的配置。 */ async () => {
    const { tabbarEnable, wrapper } = mountTabsConfig();

    await clickSwitchRow(wrapper, '启用标签栏');

    expect(tabbarEnable.value).toBe(false);
    const rows = wrapper
      .findAll('button[role="switch"]')
      .map(
        /** 从开关按钮回退到承载整行点击事件的父节点。 */ (button) =>
          button.element.parentElement,
      )
      .filter(
        /** 只保留非标签栏启用开关本身的行。 */ (
          element,
        ): element is HTMLElement =>
          element?.textContent?.trim() !== '启用标签栏',
      );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.className).toContain('opacity-50');
    }
  });
});
