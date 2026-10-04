/** 校验设置图标 SFC 的真实渲染结果，确保侧边栏偏好入口拿到可缩放的完整齿轮图标。 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import Setting from '../setting.vue';

describe('setting 偏好设置图标', /** 该图标是侧边栏偏好入口的唯一可视标识，属性缺失会让按钮塌陷或变形。 */ () => {
  it('渲染单色可缩放 SVG 根节点', /** 尺寸跟随字号且不写死像素，才能适配不同密度的导航栏。 */ () => {
    const wrapper = mount(Setting);
    const svg = wrapper.find('svg');
    expect(svg.exists()).toBe(true);
    expect(svg.attributes('height')).toBe('1em');
    expect(svg.attributes('width')).toBe('1em');
    expect(svg.attributes('viewBox')).toBe('0 0 24 24');
    expect(svg.attributes('xmlns')).toBe('http://www.w3.org/2000/svg');
  });

  it('包含唯一齿轮路径且使用当前颜色填充', /** 齿轮轮廓由单条 path 描述；填充色必须继承文本色才能跟随主题切换。 */ () => {
    const wrapper = mount(Setting);
    const paths = wrapper.findAll('path');
    expect(paths).toHaveLength(1);
    const [path] = paths;
    expect(path).toBeDefined();
    expect(path?.attributes('d')).toMatch(/^M19\.9 12\.66a1 1 0 0 1 0-1\.32/);
    // 未声明 fill 时浏览器按默认黑色填充，这里核对没有写出固定颜色。
    expect(path?.attributes('fill')).toBeUndefined();
  });
});
