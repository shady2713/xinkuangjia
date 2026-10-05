/**
 * 布局头部左侧扩展插槽（basic/header/header.vue 的 leftSlots）真实排序回归。
 *
 * 头部用插槽名末尾的序号与参考值 50 决定左侧扩展项排在哪里：比较器写错会让扩展入口顺序错乱，
 * 序号解析或过滤条件写错会让插槽整体消失，刷新入口与菜单对齐偏好写错会让用户无法刷新页面或看到
 * 错位的菜单。用例挂载真实头部、注入 header-left-1、header-left-2、header-left-70 具名插槽，
 * 用真实偏好状态与真实 DOM 的文档顺序断言渲染结果。
 */
import { mount } from '@vue/test-utils';

import { preferences, preferencesManager } from '@vben/preferences';

import { VbenIconButton } from '@vben-core/shadcn-ui';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import LayoutHeader from '../header.vue';

/** 刷新动作记录；真实 useRefresh 依赖 pinia 标签栏 Store，只替换这一处外部边界。 */
const refreshMock = vi.hoisted(
  /** 建立可断言调用次数的刷新动作替身。 */ () => vi.fn(),
);

vi.mock(
  '@vben/hooks',
  /** 真实刷新动作依赖标签栏 Store 与 pinia 上下文，本用例只验证头部是否把点击接到刷新入口。 */ () => ({
    /** 返回可断言的刷新入口。 */
    useRefresh: () => ({ refresh: refreshMock }),
  }),
);

vi.mock(
  '@vben/stores',
  /** 头部渲染全局搜索时会读取访问菜单，真实 Store 需要 pinia 上下文。 */ () => ({
    /** 返回空菜单列表的访问 Store 替身。 */
    useAccessStore: () => ({ accessMenus: [] }),
  }),
);

vi.mock(
  '../../../widgets',
  /** 头部右侧的小部件不是本用例的被测对象，替换为可定位替身，避免引入搜索与主题依赖。 */ () => ({
    /** 全局搜索替身，只提供可定位节点。 */
    GlobalSearch: { template: '<div data-test="global-search" />' },
    /** 偏好按钮替身，点击后抛出与真实组件同名的事件。 */
    PreferencesButton: {
      emits: ['clearPreferencesAndLogout'],
      template:
        '<button data-test="preferences" @click="$emit(\'clearPreferencesAndLogout\')" />',
    },
    /** 主题切换替身，只提供可定位节点。 */
    ThemeToggle: { template: '<div data-test="theme-toggle" />' },
  }),
);

/**
 * 挂载头部并注入本用例关注的左侧具名插槽。
 * @returns 已挂载的真实头部包装器。
 */
function mountHeader() {
  return mount(LayoutHeader, {
    slots: {
      'header-left-1': '<div data-test="left-1">DUMMY-左一</div>',
      'header-left-2': '<div data-test="left-2">DUMMY-左二</div>',
      'header-left-70': '<div data-test="left-70">DUMMY-左七十</div>',
    },
  });
}

/**
 * 判断前一个节点在真实文档顺序中是否排在后面那个节点之前。
 * @param earlier 期望先出现的元素。
 * @param later 期望后出现的元素。
 * @returns 前者确实排在后者之前时为 true。
 */
function isBefore(earlier: Element, later: Element) {
  return Boolean(
    earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

beforeEach(
  /** 建立确定性的真实偏好基线：只保留刷新入口，关闭需要浏览器能力或额外依赖的右侧小部件。 */ () => {
    preferencesManager.updatePreferences({
      header: { menuAlign: 'start' },
      widget: {
        fullscreen: false,
        globalSearch: false,
        notification: false,
        refresh: true,
        themeToggle: false,
      },
    });
  },
);

afterEach(
  /** 恢复被用例改写的真实偏好并清空刷新记录，避免影响后续用例。 */ () => {
    preferencesManager.resetPreferences();
    refreshMock.mockClear();
  },
);

describe('头部左侧扩展插槽排序', /** 扩展入口顺序错乱或消失会让用户找不到刷新与自定义入口。 */ () => {
  it('按序号把 50 以内的左插槽排在刷新按钮之后', /** 序号解析或比较器写错会让扩展入口跑到刷新之前甚至消失。 */ () => {
    const wrapper = mountHeader();
    const refreshButton = wrapper.getComponent(VbenIconButton);
    const leftOne = wrapper.get('[data-test="left-1"]').element;
    const leftTwo = wrapper.get('[data-test="left-2"]').element;

    expect(refreshMock).not.toHaveBeenCalled();
    // 参考值 50 以内的插槽属于前置扩展区，必须真实渲染且按序号升序排列。
    expect(isBefore(refreshButton.element, leftOne)).toBe(true);
    expect(isBefore(leftOne, leftTwo)).toBe(true);
  });

  it('序号大于参考值的左插槽渲染在菜单之前', /** 后置扩展区若被过滤掉，注入的右侧工具入口会静默丢失。 */ () => {
    const wrapper = mountHeader();
    const leftTwo = wrapper.get('[data-test="left-2"]').element;
    const leftSeventy = wrapper.get('[data-test="left-70"]').element;

    expect(isBefore(leftTwo, leftSeventy)).toBe(true);
    expect(
      isBefore(leftSeventy, wrapper.get('.flex.h-full.min-w-0.flex-1').element),
    ).toBe(true);
  });

  it('序号正好等于参考值的左插槽不参与渲染', /** 两个过滤条件都是开区间，落在参考值上的插槽会被静默吞掉，需要用例暴露命名错位。 */ () => {
    const wrapper = mount(LayoutHeader, {
      slots: { 'header-left-50': '<div data-test="left-50">DUMMY-边界</div>' },
    });

    expect(wrapper.find('[data-test="left-50"]').exists()).toBe(false);
  });

  it('点击刷新按钮调用真实刷新入口', /** 刷新按钮不接线会让用户无法重新加载当前页面。 */ async () => {
    const wrapper = mountHeader();

    await wrapper.getComponent(VbenIconButton).trigger('click');

    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('关闭刷新偏好后刷新入口消失但扩展插槽保留', /** 关闭刷新却残留按钮会让偏好设置失效，误伤扩展插槽则会让自定义入口消失。 */ async () => {
    preferencesManager.updatePreferences({ widget: { refresh: false } });
    const wrapper = mountHeader();

    expect(wrapper.findComponent(VbenIconButton).exists()).toBe(false);
    expect(wrapper.find('[data-test="left-1"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="left-2"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="left-70"]').exists()).toBe(true);
  });

  it('菜单对齐偏好实时反映到头部菜单容器', /** 对齐偏好未绑定会让菜单永远停在默认对齐方式上。 */ async () => {
    const wrapper = mountHeader();
    expect(wrapper.find('.menu-align-start').exists()).toBe(true);

    preferencesManager.updatePreferences({ header: { menuAlign: 'end' } });
    await wrapper.vm.$nextTick();

    expect(preferences.header.menuAlign).toBe('end');
    expect(wrapper.find('.menu-align-end').exists()).toBe(true);
    expect(wrapper.find('.menu-align-start').exists()).toBe(false);
  });

  it('偏好按钮抛出事件时头部原样转发退出事件', /** 退出动作由外层布局处理，头部漏转发会让清空缓存并退出登录失效。 */ async () => {
    const wrapper = mountHeader();

    await wrapper.get('[data-test="preferences"]').trigger('click');

    expect(wrapper.emitted('clearPreferencesAndLogout')).toHaveLength(1);
  });
});
