/**
 * 服务异常插画（common-ui 的 ui/fallback/icons/icon-500）真实行为回归。
 *
 * 该组件是没有脚本的静态 SVG，被兜底页在 `status="500"` 时异步加载：根节点的
 * viewBox 与宽高决定插画在兜底页中的显示比例；`<title>` 是读屏软件唯一能读到的
 * 说明，缺失会让无障碍语义退化为"未命名图形"；主题色图元必须引用
 * `hsl(var(--primary))` 才能跟随偏好设置换色；机柜、指示灯与地面投影是"服务宕机"
 * 的语义符号，漏画会让用户读不出 500 含义。用例真实渲染组件并断言渲染出的 SVG
 * 结构，不做文本层面的模板比对。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import Icon500 from './icon-500.vue';

/** 插画声明的 viewBox，决定兜底页按原比例缩放。 */
const VIEW_BOX = '0 0 1119 699';

/** 插画中主题色图元的填充值，必须跟随偏好设置换色。 */
const PRIMARY_FILL = 'hsl(var(--primary))';

/** 机柜指示灯使用的强调色。 */
const INDICATOR_FILL = '#6c63ff';

/** 插画使用的全部填充色，缺少任一色值都说明图元被改动或丢失。 */
const FILL_USAGE = {
  '#2f2e41': 15,
  '#3f3d56': 8,
  '#a8a8a8': 1,
  '#f2f2f2': 4,
  '#fff': 2,
  none: 3,
  [INDICATOR_FILL]: 10,
  [PRIMARY_FILL]: 2,
};

/**
 * 按填充色统计图元数量。
 * @param wrapper 已挂载的插画包装器。
 * @param fill 图元声明的填充值。
 * @returns 使用该填充色的图元包装器数组。
 */
function shapesByFill(wrapper: ReturnType<typeof mount>, fill: string) {
  return wrapper.findAll(`[fill="${fill}"]`);
}

describe('服务异常插画结构', /** 根节点尺寸、说明文字与图元数量决定插画能否完整呈现宕机场景。 */ () => {
  it('渲染带固定视窗尺寸的根 svg', /** 缺少 viewBox 会让插画在兜底页里被拉伸出错。 */ () => {
    const wrapper = mount(Icon500);
    const svg = wrapper.find('svg');

    expect(svg.exists()).toBe(true);
    expect(svg.attributes('viewBox')).toBe(VIEW_BOX);
    expect(svg.attributes('width')).toBe('1119');
    expect(svg.attributes('height')).toBe('699');
    expect(svg.attributes('xmlns')).toBe('http://www.w3.org/2000/svg');
    // 模板声明的 xmlns:xlink 经 Vue 编译后属性名归一化为 xlink，取值保持不变。
    expect(svg.attributes('xlink')).toBe('http://www.w3.org/1999/xlink');
  });

  it('为读屏软件提供图形说明', /** 缺少 title 会让无障碍语义退化成"未命名图形"。 */ () => {
    const wrapper = mount(Icon500);
    const title = wrapper.find('title');

    expect(title.exists()).toBe(true);
    expect(title.text()).toBe('server down');
  });

  it('包含完整的图元分组与数量', /** 漏画图元会让宕机示意缺件，用户读不出服务异常的含义。 */ () => {
    const wrapper = mount(Icon500);

    expect(wrapper.findAll('path')).toHaveLength(16);
    expect(wrapper.findAll('circle')).toHaveLength(6);
    expect(wrapper.findAll('rect')).toHaveLength(17);
    expect(wrapper.findAll('polygon')).toHaveLength(2);
    expect(wrapper.findAll('ellipse')).toHaveLength(9);
    // 图元总数与分类计数必须自洽，避免新增图元后分类断言漏更新。
    expect(wrapper.findAll('svg > *')).toHaveLength(51);
  });

  it('每种填充色都覆盖到预期图元', /** 色值被写死或图元被删除都会让插画配色与语义缺件。 */ () => {
    const wrapper = mount(Icon500);

    for (const [fill, count] of Object.entries(FILL_USAGE)) {
      expect(shapesByFill(wrapper, fill)).toHaveLength(count);
    }
  });
});

describe('服务异常插画语义图形', /** 机柜、指示灯与投影是插画表达"服务宕机"的关键视觉契约。 */ () => {
  it('绘制深色机柜与外框圆角', /** 机柜缺失会让插画退化成抽象图形，读不出服务器场景。 */ () => {
    const wrapper = mount(Icon500);
    const rack = wrapper.find('rect[width="513.25314"]');

    expect(rack.exists()).toBe(true);
    expect(rack.attributes('height')).toBe('357.51989');
    expect(rack.attributes('rx')).toBe('18.04568');
    expect(rack.attributes('fill')).toBe('#2f2e41');
  });

  it('绘制三排共九颗强调色指示灯', /** 指示灯数量或尺寸写错会让机柜状态显示不完整。 */ () => {
    const wrapper = mount(Icon500);
    const indicators = wrapper.findAll(`rect[fill="${INDICATOR_FILL}"]`);

    expect(indicators).toHaveLength(9);
    for (const indicator of indicators) {
      expect(indicator.attributes('width')).toBe('16');
      expect(indicator.attributes('height')).toBe('16');
    }
  });

  it('主题色用于宕机示意图形', /** 写死颜色的图形在深色主题下会与背景冲突。 */ () => {
    const wrapper = mount(Icon500);
    const shapes = shapesByFill(wrapper, PRIMARY_FILL);

    expect(shapes).toHaveLength(2);
    for (const shape of shapes) {
      expect(shape.element.tagName).toBe('path');
    }
  });

  it('绘制地面投影表达设备落地', /** 缺少投影会让机柜悬空，视觉上失去"宕机落地"的落点。 */ () => {
    const wrapper = mount(Icon500);
    const ground = wrapper.find('ellipse[rx="283"]');

    expect(ground.exists()).toBe(true);
    expect(ground.attributes('fill')).toBe('#3f3d56');
    expect(ground.attributes('cx')).toBe('836.60911');
    expect(ground.attributes('ry')).toBe('38.5');
  });

  it('插画为纯静态图形，不渲染交互元素', /** 兜底插画里出现按钮或脚本会让无障碍与安全扫描产生误报。 */ () => {
    const wrapper = mount(Icon500);

    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.find('button').exists()).toBe(false);
    expect(wrapper.find('a').exists()).toBe(false);
  });
});
