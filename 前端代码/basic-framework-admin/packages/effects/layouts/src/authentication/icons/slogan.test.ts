/**
 * 认证页标语插画（authentication/icons/slogan.vue）真实渲染回归。
 *
 * 该插画是登录、注册等认证页右侧唯一的品牌视觉：模板被破坏、根节点尺寸写错或图形被裁掉，
 * 认证页就会出现空白区域或变形。用例真实挂载组件并核对真实 DOM 中的 SVG 根节点、视图尺寸与
 * 图形内容，避免插画在构建或改版中静默丢失。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import Slogan from './slogan.vue';

describe('认证页标语插画', /** 插画缺失或尺寸错误会让登录页失去品牌标识并出现空白区域。 */ () => {
  it('渲染带视图尺寸的 SVG 根节点', /** 根节点不是 800x800 的 svg 会让插画被裁切或拉伸。 */ () => {
    const wrapper = mount(Slogan);
    const svg = wrapper.find('svg');

    expect(svg.exists()).toBe(true);
    expect(svg.attributes('viewBox')).toBe('0 0 800 800');
    expect(svg.attributes('xmlns')).toBe('http://www.w3.org/2000/svg');
    expect(wrapper.findAll('path').length).toBeGreaterThan(0);
    expect(wrapper.findAll('linearGradient').length).toBeGreaterThan(0);
  });
});
