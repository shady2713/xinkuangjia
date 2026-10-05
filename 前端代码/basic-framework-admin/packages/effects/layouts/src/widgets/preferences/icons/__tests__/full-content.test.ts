/**
 * 全内容布局预览图（preferences/icons/full-content.vue）渲染回归。
 *
 * 该图标是“全内容”布局卡片的唯一可视标识：根节点尺寸或取色属性写错会让预览图被裁切或在暗色
 * 主题下看不清，装饰图形缺失会让卡片看起来是坏的。用例真实挂载图标并核对真实 SVG 属性。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import FullContent from '../full-content.vue';

describe('全内容布局预览图', /** 预览图决定用户能否识别“全内容”布局选项。 */ () => {
  it('渲染固定预览尺寸的根节点', /** 尺寸写错会让预览图在卡片里被裁切或撑破布局。 */ () => {
    const wrapper = mount(FullContent);
    const svg = wrapper.find('svg');

    expect(svg.exists()).toBe(true);
    expect(svg.attributes('height')).toBe('66');
    expect(svg.attributes('width')).toBe('104');
    expect(svg.attributes('fill')).toBe('none');
    expect(svg.attributes('xmlns')).toBe('http://www.w3.org/2000/svg');
    expect(wrapper.find('.custom-radio-image').exists()).toBe(true);
  });

  it('用 currentColor 绘制以保证跟随主题', /** 写死颜色会让预览图在暗色主题下看不清。 */ () => {
    const wrapper = mount(FullContent);
    const paths = wrapper.findAll('path');
    const rects = wrapper.findAll('rect');

    expect(paths).toHaveLength(2);
    expect(rects).toHaveLength(2);
    for (const shape of [...paths, ...rects]) {
      expect(shape.attributes('fill')).toBe('currentColor');
    }
  });

  it('渲染侧边栏与内容区的尺寸与圆角', /** 装饰图形属性缺失会让预览图与真实布局对不上。 */ () => {
    const wrapper = mount(FullContent);

    const contentRect = wrapper.find('#svg_13');
    expect(contentRect.attributes('height')).toBe('26.57155');
    expect(contentRect.attributes('width')).toBe('53.18333');
    expect(contentRect.attributes('rx')).toBe('2');
    expect(contentRect.attributes('fill-opacity')).toBe('0.08');

    const sidebarPath = wrapper.find('#svg_14');
    expect(sidebarPath.attributes('fill-opacity')).toBe('0.08');
    expect(sidebarPath.attributes('d')).toMatch(/^m4\.28142,5\.96169/);

    const bottomRect = wrapper.find('#svg_15');
    expect(bottomRect.attributes('width')).toBe('94.39371');
    expect(bottomRect.attributes('y')).toBe('34.92584');

    expect(wrapper.find('#svg_1').attributes('fill-opacity')).toBe('0.02');
  });
});
