/**
 * 页签工具栏刷新按钮（tabs-ui 的 widgets/tool-refresh）渲染与点击分发回归。
 *
 * 刷新按钮是用户重新加载当前页签数据的唯一入口：图标缺失会让工具栏出现空白热区，点击未抛出
 * refresh 事件会让用户点了没反应、只能整页刷新。用例真实挂载按钮并派发真实点击事件，断言真实
 * DOM 与事件载荷。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import ToolRefresh from '../tool-refresh.vue';

describe('页签刷新按钮', /** 点击无反应会让用户无法重新加载当前页签内容。 */ () => {
  it('渲染刷新图标与可点击样式', /** 图标缺失会让工具栏出现无意义的空白热区。 */ () => {
    const wrapper = mount(ToolRefresh);

    expect(wrapper.find('svg.lucide-rotate-cw').exists()).toBe(true);
    expect(wrapper.classes()).toContain('cursor-pointer');
    expect(wrapper.classes()).toContain('border-l');
  });

  it('每次点击都抛出 refresh 事件', /** 不抛出会让父级无法重新加载页签内容。 */ async () => {
    const wrapper = mount(ToolRefresh);

    await wrapper.trigger('click');
    await wrapper.trigger('click');

    expect(wrapper.emitted('refresh')).toHaveLength(2);
    expect(wrapper.emitted('refresh')?.[0]).toEqual([]);
  });
});
