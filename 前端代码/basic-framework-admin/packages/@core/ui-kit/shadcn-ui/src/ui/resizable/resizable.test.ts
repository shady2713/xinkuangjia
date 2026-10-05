/**
 * 可拖拽分栏（shadcn-ui 的 ui/resizable）结构与拖拽手柄回归。
 *
 * 可拖拽分栏用于代码对比、详情并排这类布局：容器必须声明方向，拖拽手柄在开启把手时渲染
 * 抓取图标，否则用户不知道哪里可以拖动；纵向布局必须切换成列方向。用例真实挂载 reka-ui 的
 * 分栏根节点，读取真实方向属性与手柄结构。
 */
import { mount } from '@vue/test-utils';
import { h, nextTick } from 'vue';

import { describe, expect, it } from 'vitest';

import ResizableHandle from './ResizableHandle.vue';
import ResizablePanelGroup from './ResizablePanelGroup.vue';

/**
 * 挂载可拖拽分栏。
 * @param direction 分栏方向。
 * @param withHandle 是否渲染拖拽把手。
 * @returns 已挂载的分栏包装器。
 */
function mountPanels(
  direction: 'horizontal' | 'vertical',
  withHandle: boolean,
) {
  return mount(
    h(
      ResizablePanelGroup,
      { class: 'custom-group', direction },
      {
        /** 渲染两个面板与中间手柄。 */
        default: () => [
          h('div', { class: 'panel-a' }, '左侧'),
          h(ResizableHandle, { class: 'custom-handle', withHandle }),
          h('div', { class: 'panel-b' }, '右侧'),
        ],
      },
    ),
  );
}

describe('分栏方向与手柄结构', /** 方向与手柄决定用户能否按预期调整布局。 */ () => {
  it('横向分栏使用水平方向标记', /** 方向属性写错会让面板上下堆叠。 */ async () => {
    const wrapper = mountPanels('horizontal', false);
    await nextTick();

    const group = wrapper.find('.custom-group');
    expect(group.attributes('data-orientation')).toBe('horizontal');
    expect(group.attributes('data-panel-group')).toBe('');
    expect(group.classes()).toContain('flex');
    expect(group.classes()).toContain('custom-group');
    expect(wrapper.find('.panel-a').text()).toBe('左侧');
    expect(wrapper.find('.panel-b').text()).toBe('右侧');
  });

  it('纵向分栏标记为列方向', /** 纵向未切换列方向会让拖拽方向与视觉不符。 */ async () => {
    const wrapper = mountPanels('vertical', false);
    await nextTick();

    expect(wrapper.find('.custom-group').attributes('data-orientation')).toBe(
      'vertical',
    );
    expect(wrapper.find('.custom-group').classes()).toContain(
      'data-[panel-group-direction=vertical]:flex-col',
    );
  });

  it('未开启把手时不渲染抓取图标', /** 无把手仍渲染图标会让手柄出现多余装饰。 */ async () => {
    const wrapper = mountPanels('horizontal', false);
    await nextTick();

    const handle = wrapper.find('.custom-handle');
    expect(handle.classes()).toContain('custom-handle');
    expect(handle.classes()).toContain('bg-border');
    expect(handle.attributes('data-orientation')).toBe('horizontal');
    expect(handle.find('svg').exists()).toBe(false);
  });

  it('开启把手时渲染抓取图标', /** 缺少抓取图标会让用户不知道这里可以拖动。 */ async () => {
    const wrapper = mountPanels('horizontal', true);
    await nextTick();

    expect(wrapper.find('.custom-handle svg').exists()).toBe(true);
  });
});
