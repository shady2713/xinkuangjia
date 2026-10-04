/**
 * 离线兜底插画（common-ui 的 ui/fallback/icons/icon-offline）真实行为回归。
 *
 * 该组件是没有脚本的静态 SVG，被兜底页在 `status="offline"` 时异步加载：根节点的
 * viewBox 与宽高决定插画在兜底页中的显示比例，缺一块图形会让断线示意不完整；
 * 主题色图形必须引用 `hsl(var(--primary))` 才能跟随偏好设置换色，写死颜色会在深色
 * 主题下突兀；白色箭头是"网络断开"的语义符号，漏画会让用户读不出离线含义。
 * 用例真实渲染组件并断言渲染出的 SVG 结构，不做文本层面的模板比对。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import IconOffline from './icon-offline.vue';

/** 插画声明的 viewBox，决定兜底页按原比例缩放。 */
const VIEW_BOX = '0 0 656 458.68642';

/** 插画中主题色图形的填充值，必须跟随偏好设置换色。 */
const PRIMARY_FILL = 'hsl(var(--primary))';

/**
 * 取出插画中所有使用了主题色的图形。
 * @param wrapper 已挂载的插画包装器。
 * @returns 主题色图形包装器数组。
 */
function primaryShapes(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll(`[fill="${PRIMARY_FILL}"]`);
}

describe('离线插画结构', /** 根节点尺寸与图形数量决定插画能否完整呈现断线场景。 */ () => {
  it('渲染带固定视窗尺寸的根 svg', /** 缺少 viewBox 会让插画在兜底页里被拉伸出错。 */ () => {
    const wrapper = mount(IconOffline);
    const svg = wrapper.find('svg');

    expect(svg.exists()).toBe(true);
    expect(svg.attributes('viewBox')).toBe(VIEW_BOX);
    expect(svg.attributes('width')).toBe('656');
    expect(svg.attributes('height')).toBe('458.68642');
    expect(svg.attributes('xmlns')).toBe('http://www.w3.org/2000/svg');
    // 模板声明的 xmlns:xlink 经 Vue 编译后属性名归一化为 xlink，取值保持不变。
    expect(svg.attributes('xlink')).toBe('http://www.w3.org/1999/xlink');
  });

  it('包含完整的图形分组与图元数量', /** 漏画图元会让离线示意缺件，用户看不出是断线场景。 */ () => {
    const wrapper = mount(IconOffline);

    expect(wrapper.findAll('path')).toHaveLength(16);
    expect(wrapper.findAll('polygon')).toHaveLength(3);
    expect(wrapper.findAll('rect')).toHaveLength(2);
    expect(wrapper.findAll('circle')).toHaveLength(2);
    expect(wrapper.findAll('g')).toHaveLength(4);
  });

  it('绘制贯穿全宽的地面基准线', /** 地面线缺失会让插画悬空，视觉上失去"掉线"落点。 */ () => {
    const wrapper = mount(IconOffline);
    const ground = wrapper.find('rect[width="656"]');

    expect(ground.exists()).toBe(true);
    expect(ground.attributes('height')).toBe('2');
    expect(ground.attributes('fill')).toBe('#3f3d56');
    expect(ground.attributes('y')).toBe('434.34322');
  });
});

describe('离线插画语义图形', /** 主题色与白色箭头是插画表达"网络断开"的关键视觉契约。 */ () => {
  it('断线徽标使用主题色与固定半径', /** 写死颜色的徽标在深色主题下会与背景冲突。 */ () => {
    const wrapper = mount(IconOffline);
    const badge = wrapper.find('circle[fill="hsl(var(--primary))"]');

    expect(badge.exists()).toBe(true);
    expect(badge.attributes('r')).toBe('85');
    expect(badge.attributes('cx')).toBe('333.2486');
    expect(badge.attributes('cy')).toBe('323.64455');
  });

  it('主题色图元同时覆盖徽标与箱体', /** 只改徽标不改箱体会让插画配色不统一。 */ () => {
    const wrapper = mount(IconOffline);
    const shapes = primaryShapes(wrapper);

    expect(shapes).toHaveLength(2);
    expect(
      shapes.some(
        /** 挑出主题色箱体多边形。 */ (item) =>
          item.element.tagName === 'polygon',
      ),
    ).toBe(true);
  });

  it('绘制两支白色箭头表达断线后重连', /** 箭头缺失会让插画退化成普通空状态图，表达不出离线含义。 */ () => {
    const wrapper = mount(IconOffline);
    const arrows = wrapper.findAll('path[fill="#fff"]');

    expect(arrows).toHaveLength(2);
    expect(arrows[0]?.attributes('d')).toMatch(/^M384\.17838,316\.82296/u);
    expect(arrows[1]?.attributes('d')).toMatch(/^M364\.34329,344\.7337/u);
  });

  it('插画为纯静态图形，不渲染交互元素', /** 兜底插画里出现按钮或脚本会让无障碍与安全扫描产生误报。 */ () => {
    const wrapper = mount(IconOffline);

    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.find('button').exists()).toBe(false);
    expect(wrapper.find('a').exists()).toBe(false);
  });
});
