/**
 * 偏好设置里的导航布局预览图标真实渲染回归。
 *
 * 这些图标是布局选项卡片上唯一的可视标识：图标缺失会让用户在“侧边导航/顶部导航/混合导航”
 * 之间无从选择，尺寸或 viewBox 写错会让预览图被裁切。用例真实挂载每个图标并核对 SVG 根节点、
 * 预览尺寸与填充色继承文本色。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import ContentCompact from '../content-compact.vue';
import HeaderMixedNav from '../header-mixed-nav.vue';
import HeaderNav from '../header-nav.vue';
import HeaderSidebarNav from '../header-sidebar-nav.vue';
import MixedNav from '../mixed-nav.vue';
import SidebarMixedNav from '../sidebar-mixed-nav.vue';
import SidebarNav from '../sidebar-nav.vue';

/** 布局预览图标清单：名称用于断言失败时定位，组件为真实 SFC。 */
const layouts = [
  { component: ContentCompact, name: '内容区紧凑' },
  { component: HeaderMixedNav, name: '顶部混合导航' },
  { component: HeaderNav, name: '顶部导航' },
  { component: HeaderSidebarNav, name: '顶部侧边导航' },
  { component: MixedNav, name: '混合导航' },
  { component: SidebarMixedNav, name: '侧边混合导航' },
  { component: SidebarNav, name: '侧边导航' },
];

describe('偏好导航图标', /** 缺图或尺寸错误会让布局选择卡片变成空白。 */ () => {
  it.each(layouts)(
    '渲染 $name 预览图',
    /** 根节点必须是带预览尺寸的 SVG，否则卡片高度会塌陷。 */ ({
      component,
    }) => {
      const wrapper = mount(component);
      const svg = wrapper.find('svg');

      expect(svg.exists()).toBe(true);
      expect(svg.attributes('height')).toBe('66');
      expect(svg.attributes('width')).toBe('104');
      expect(svg.attributes('xmlns')).toBe('http://www.w3.org/2000/svg');
      // 预览图用 currentColor 跟随主题；写死颜色会在暗色主题下看不清。
      expect(svg.attributes('fill')).toBe('none');
      expect(wrapper.find('.custom-radio-image').exists()).toBe(true);
      expect(wrapper.findAll('rect').length).toBeGreaterThan(0);
    },
  );
});
