/**
 * 页面不存在插画（common-ui 的 ui/fallback/icons/icon-404）真实行为回归。
 *
 * 该组件是没有脚本的静态 SVG，被兜底页在 `status="404"` 时异步加载：根节点的
 * viewBox 与宽高决定插画在兜底页中的显示比例，缺一块图元会让"迷路"示意不完整；
 * 主题色与前景色图元必须引用 CSS 变量才能跟随偏好设置换色，写死颜色会在深色主题
 * 下突兀；地面基准线与散落的定位点是"找不到路径"的语义符号，漏画会让用户读不出
 * 404 含义。用例真实渲染组件并断言渲染出的 SVG 结构，不做文本层面的模板比对。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import Icon404 from './icon-404.vue';

/** 插画声明的 viewBox，决定兜底页按原比例缩放。 */
const VIEW_BOX = '0 0 860 571';

/** 插画中主题色图元的填充值，必须跟随偏好设置换色。 */
const PRIMARY_FILL = 'hsl(var(--primary))';

/** 插画中前景色图元的填充值，必须跟随偏好设置换色。 */
const FOREGROUND_FILL = 'hsl(var(--foreground))';

/** 插画使用的全部填充色，缺少任一色值都说明图元被改动或丢失。 */
const FILL_USAGE = {
  '#cacaca': 1,
  '#ccc': 1,
  '#e4e4e4': 3,
  '#f0f0f0': 2,
  '#f2f2f2': 7,
  [FOREGROUND_FILL]: 18,
  [PRIMARY_FILL]: 3,
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

describe('页面不存在插画结构', /** 根节点尺寸与图元数量决定插画能否完整呈现迷路场景。 */ () => {
  it('渲染带固定视窗尺寸的根 svg', /** 缺少 viewBox 会让插画在兜底页里被拉伸出错。 */ () => {
    const wrapper = mount(Icon404);
    const svg = wrapper.find('svg');

    expect(svg.exists()).toBe(true);
    expect(svg.attributes('viewBox')).toBe(VIEW_BOX);
    expect(svg.attributes('width')).toBe('860');
    expect(svg.attributes('height')).toBe('571');
    expect(svg.attributes('xmlns')).toBe('http://www.w3.org/2000/svg');
    // 模板声明的 xmlns:xlink 经 Vue 编译后属性名归一化为 xlink，取值保持不变。
    expect(svg.attributes('xlink')).toBe('http://www.w3.org/1999/xlink');
  });

  it('包含完整的图元数量', /** 漏画图元会让迷路示意缺件，用户读不出页面不存在的含义。 */ () => {
    const wrapper = mount(Icon404);

    expect(wrapper.findAll('path')).toHaveLength(27);
    expect(wrapper.findAll('circle')).toHaveLength(9);
    // 图元总数与分类计数必须自洽，避免新增图元后分类断言漏更新。
    expect(wrapper.findAll('svg > *')).toHaveLength(36);
  });

  it('每种填充色都覆盖到预期图元', /** 色值被写死或图元被删除都会让插画配色与语义缺件。 */ () => {
    const wrapper = mount(Icon404);

    for (const [fill, count] of Object.entries(FILL_USAGE)) {
      expect(shapesByFill(wrapper, fill)).toHaveLength(count);
    }
  });
});

describe('页面不存在插画语义图形', /** 主题色圆牌、散落定位点与地面线是表达"找不到路径"的视觉契约。 */ () => {
  it('迷路圆牌使用主题色与固定半径', /** 写死颜色的圆牌在深色主题下会与背景冲突。 */ () => {
    const wrapper = mount(Icon404);
    const badge = wrapper.find(`circle[fill="${PRIMARY_FILL}"]`);

    expect(badge.exists()).toBe(true);
    expect(badge.attributes('cx')).toBe('649.24878');
    expect(badge.attributes('cy')).toBe('51');
    expect(badge.attributes('r')).toBe('51');
  });

  it('主题色同时用于圆牌与主体图形', /** 只改圆牌不改主体会让插画配色不统一。 */ () => {
    const wrapper = mount(Icon404);
    const shapes = shapesByFill(wrapper, PRIMARY_FILL);

    expect(shapes).toHaveLength(3);
    expect(
      shapes.filter(
        /** 挑出主体图形中的主题色路径，圆牌是 circle。 */ (item) =>
          item.element.tagName === 'path',
      ),
    ).toHaveLength(2);
  });

  it('绘制贯穿全宽的路径与散落定位点', /** 路径与定位点缺失会让插画退化成普通空状态图。 */ () => {
    const wrapper = mount(Icon404);
    const ground = wrapper.find('path[fill="#cacaca"]');
    const dots = wrapper.findAll('circle[fill="hsl(var(--foreground))"]');

    expect(ground.attributes('d')).toMatch(/^M1028\.875,735\.26666/u);
    // 定位点由 7 个小圆与 1 个大圆组成，任何一处缺失都会让"迷路"语义变弱。
    expect(dots).toHaveLength(8);
    expect(
      dots.filter(
        /** 挑出尺寸更大的终点定位点，其余是路径上的小点。 */ (item) =>
          item.attributes('r') === '16',
      ),
    ).toHaveLength(1);
  });

  it('插画为纯静态图形，不渲染交互元素', /** 兜底插画里出现按钮或脚本会让无障碍与安全扫描产生误报。 */ () => {
    const wrapper = mount(Icon404);

    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.find('button').exists()).toBe(false);
    expect(wrapper.find('a').exists()).toBe(false);
  });
});
